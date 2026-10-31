// Spec for saving rooms: what survives a server restart, and what gets recorded.
// Runs the sync server against the real test database; every test uses a fresh room name.

import { afterAll, afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { WebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { newRoomDocument } from "../src/room-document";
import { openRoomStore } from "../src/room-store";
import { createSyncServer, type RoomStore, type SyncServer } from "../src/sync-server";
import { TEST_DATABASE_URL } from "./database";
import { SETTLE_MS, sleep, waitFor } from "./wait";

const store = openRoomStore(TEST_DATABASE_URL);
afterAll(() => store.close());

interface Person {
  doc: Y.Doc;
  provider: WebsocketProvider;
}

const text = (person: Person) => person.doc.getText("probe").toString();
const fileIds = (person: Person) => [...person.doc.getMap("files").keys()];

// type one character at a time, each its own change, as a person typing does
function type(person: Person, chars: string) {
  const probe = person.doc.getText("probe");
  for (const char of chars) probe.insert(probe.length, char);
}

describe("persistence", () => {
  let server: SyncServer;
  let people: Person[];
  let room: string;

  // port: reuse the old server's, so people still connected find the new one
  // saveDelayMs: how long changes may wait to be written (50ms here, to keep tests fast)
  async function startServer(options: Partial<Parameters<typeof createSyncServer>[0]> = {}) {
    server = await createSyncServer({ port: 0, store, saveDelayMs: 50, ...options });
  }

  async function restartServer() {
    const { port } = server;
    await server.close();
    await startServer({ port });
  }

  beforeEach(async () => {
    people = [];
    room = `room-${crypto.randomUUID()}`;
    // created as the dashboard does: rooms exist before anyone opens them
    await store.createRoom(room, { ownerId: null, title: "Test room", state: newRoomDocument() });
    await startServer();
  });

  afterEach(async () => {
    for (const person of people) person.provider.destroy();
    await server.close();
  });

  // a real Yjs client with a display name, as the browser uses it
  async function join(name: string): Promise<Person> {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://localhost:${server.port}`, room, doc, {
      disableBc: true, // in one process, BroadcastChannel would bypass the server
      maxBackoffTime: 100, // reconnect within 100ms, to keep tests fast
    });
    provider.awareness.setLocalStateField("user", { name });
    const person = { doc, provider };
    people.push(person);
    await waitFor(() => provider.synced, `${name} to sync`);
    return person;
  }

  function leave(person: Person) {
    person.provider.destroy();
    people = people.filter((p) => p !== person);
  }

  it("keeps a room's document through a server restart", async () => {
    const alice = await join("Alice");
    const bob = await join("Bob"); // a witness: if bob has it, so does the server
    alice.doc.getText("probe").insert(0, "written before the restart");
    await waitFor(() => text(bob) === "written before the restart", "the server to receive it");
    leave(alice);
    leave(bob); // nobody holds a copy now but the database

    await restartServer();

    const carol = await join("Carol");
    expect(text(carol)).toBe("written before the restart");
  });

  it("a restart while people are connected leaves the room with one file", async () => {
    const alice = await join("Alice");
    const filesBefore = fileIds(alice);

    await restartServer();

    await waitFor(() => !alice.provider.wsconnected, "alice to notice the restart");
    await waitFor(() => alice.provider.synced, "alice to reconnect and resync");
    const bob = await join("Bob");
    expect(fileIds(bob)).toEqual(filesBefore);
    expect(fileIds(alice)).toEqual(filesBefore);
  });

  it("records who made each change", async () => {
    const alice = await join("Alice");
    const bob = await join("Bob");
    alice.doc.getText("probe").insert(0, "from alice");
    await waitFor(() => text(bob) === "from alice", "bob to see alice's change");
    bob.doc.getText("probe").insert(0, "from bob, ");

    await waitFor(
      async () => (await store.history(room)).length === 3,
      "the server's first file and both changes to be saved",
    );
    const authors = (await store.history(room)).map((change) => change.author);
    expect(authors).toEqual([null, "Alice", "Bob"]); // null: the first file, made by the server
  });

  it("turns a client away to retry when its room can't be loaded", async () => {
    let failures = 1;
    const flaky: RoomStore = {
      load: (name) =>
        failures-- > 0 ? Promise.reject(new Error("database down")) : store.load(name),
      append: (name, changes) => store.append(name, changes),
      snapshot: (name, state, upTo) => store.snapshot(name, state, upTo),
    };
    await server.close();
    await startServer({ store: flaky });
    const first = new WebSocket(`ws://localhost:${server.port}/${room}`);

    const code = await new Promise<number>((resolve) => first.on("close", resolve));

    expect(code).toBe(1011); // "server error": y-websocket clients retry it
    await join("Alice"); // the retry loads the room
  });

  // ---------- batched writes ----------

  const authors = async () => (await store.history(room)).map((change) => change.author);

  // the room's text as it would load from the database right now
  async function savedText() {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await store.load(room))?.state ?? new Uint8Array());
    return doc.getText("probe").toString();
  }

  it("saves a burst of typing as one change per person", async () => {
    await server.close();
    await startServer({ saveDelayMs: 300 });
    const alice = await join("Alice");

    // at a person's pace, so each key arrives on its own rather than in one network read
    for (const char of "hello") {
      type(alice, char);
      await sleep(20);
    }

    await waitFor(async () => (await authors()).includes("Alice"), "alice's typing to be saved");
    await sleep(300 + SETTLE_MS); // one more save delay: room for any extra row to appear
    expect(await authors()).toEqual([null, "Alice"]); // null: the first file
  });

  it("keeps each person's changes in their own row", async () => {
    const alice = await join("Alice");
    const bob = await join("Bob");

    type(alice, "abc");
    type(bob, "xyz");

    await waitFor(async () => (await authors()).length >= 3, "both people's typing to be saved");
    await sleep(100 + SETTLE_MS);
    expect((await authors()).sort()).toEqual(["Alice", "Bob", null]);
  });

  it("saves changes still waiting when the server shuts down", async () => {
    await server.close();
    await startServer({ saveDelayMs: 60_000 }); // nothing would be written for a minute
    const alice = await join("Alice");
    const bob = await join("Bob"); // a witness: if bob has it, so does the server
    type(alice, "not yet written");
    await waitFor(() => text(bob) === "not yet written", "the server to receive it");
    leave(alice);
    leave(bob);

    await restartServer();

    const carol = await join("Carol");
    expect(text(carol)).toBe("not yet written");
  });

  it("keeps changes it couldn't save, and saves them on the next try", async () => {
    let failWrites = 0;
    const flaky: RoomStore = {
      load: (name) => store.load(name),
      append: (name, changes) =>
        failWrites-- > 0 ? Promise.reject(new Error("database down")) : store.append(name, changes),
      snapshot: (name, state, upTo) => store.snapshot(name, state, upTo),
    };
    await server.close();
    await startServer({ store: flaky });
    const alice = await join("Alice"); // the room and its first file are saved
    failWrites = 1;

    type(alice, "saved on the retry");

    await waitFor(async () => (await authors()).includes("Alice"), "the retry to save it");
    expect(await savedText()).toBe("saved on the retry");
  });

  // ---------- snapshots ----------

  it("snapshots a busy room, so loading it replays only recent changes", async () => {
    await server.close();
    await startServer({ snapshotEvery: 3 });
    const alice = await join("Alice");

    for (const char of "abcde") {
      const saved = (await store.history(room)).length;
      type(alice, char);
      await waitFor(
        async () => (await store.history(room)).length > saved,
        `"${char}" to be saved`,
      );
    }

    // six changes in all (the first file, then five letters): the snapshots cover them
    await waitFor(
      async () => ((await store.load(room))?.replayed ?? 6) < 3,
      "loading to start from a recent snapshot",
    );
    expect(await savedText()).toBe("abcde");
  });

  it("a failed snapshot neither holds up nor repeats saving", async () => {
    const noSnapshots: RoomStore = {
      load: (name) => store.load(name),
      append: (name, changes) => store.append(name, changes),
      snapshot: () => Promise.reject(new Error("disk full")),
    };
    await server.close();
    await startServer({ store: noSnapshots, snapshotEvery: 1 });
    const alice = await join("Alice");

    type(alice, "saved anyway");

    await waitFor(async () => (await authors()).includes("Alice"), "alice's typing to be saved");
    await sleep(100 + SETTLE_MS); // two more save delays: room for a repeated write to appear
    expect(await authors()).toEqual([null, "Alice"]);
    expect(await savedText()).toBe("saved anyway");
  });

  // ---------- unloading empty rooms ----------

  it("unloads an empty room once everything in it is saved", async () => {
    await server.close();
    await startServer({ unloadAfterMs: 50, saveDelayMs: 60_000 }); // only unloading writes
    const alice = await join("Alice");
    const bob = await join("Bob"); // a witness: if bob has it, so does the server
    type(alice, "saved on the way out");
    await waitFor(() => text(bob) === "saved on the way out", "the server to receive it");

    leave(alice);
    leave(bob);

    await waitFor(() => server.roomCount() === 0, "the empty room to be unloaded");
    expect(await savedText()).toBe("saved on the way out");
  });

  it("reopens an unloaded room with its content and its one file", async () => {
    await server.close();
    await startServer({ unloadAfterMs: 50 });
    const alice = await join("Alice");
    const bob = await join("Bob");
    const files = fileIds(alice);
    type(alice, "still here");
    await waitFor(() => text(bob) === "still here", "the server to receive it");
    leave(alice);
    leave(bob);
    await waitFor(() => server.roomCount() === 0, "the empty room to be unloaded");

    const carol = await join("Carol");

    expect(text(carol)).toBe("still here");
    expect(fileIds(carol)).toEqual(files);
  });

  it("keeps a room loaded while anyone is still in it", async () => {
    await server.close();
    let left = 0;
    await startServer({
      unloadAfterMs: 50,
      log: (line) => (left += Number(line.includes("left"))),
    });
    const alice = await join("Alice");
    await join("Bob");

    leave(alice);

    await waitFor(() => left === 1, "the server to see alice leave");
    await sleep(50 + 100); // past the unload delay, with room to spare
    expect(server.roomCount()).toBe(1);
  });

  it("keeps a room that someone joins while it's being saved to unload", async () => {
    let holdWrites = false;
    let held = false;
    let release = () => {};
    const slow: RoomStore = {
      load: (name) => store.load(name),
      append: async (name, changes) => {
        if (holdWrites) {
          held = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return store.append(name, changes);
      },
      snapshot: (name, state, upTo) => store.snapshot(name, state, upTo),
    };
    onTestFinished(() => {
      holdWrites = false;
      release(); // even if the test fails, so shutting the server down doesn't wait forever
    });
    await server.close();
    await startServer({ store: slow, unloadAfterMs: 50, saveDelayMs: 60_000 });
    const alice = await join("Alice"); // the room and its first file are saved
    const witness = await join("Witness");
    holdWrites = true;
    type(alice, "alice's ");
    await waitFor(() => text(witness) === "alice's ", "the server to receive alice's change");
    leave(alice);
    leave(witness);
    await waitFor(() => held, "the unload's write to start");

    const bob = await join("Bob"); // arrives while that write is still in flight
    holdWrites = false;
    release();
    await waitFor(async () => (await savedText()) === "alice's ", "the unload's write to finish");
    type(bob, "bob's");

    const carol = await join("Carol"); // must find bob's room, not a copy reloaded without him
    await waitFor(() => text(carol) === "alice's bob's", "carol to see bob's change");
    expect(server.roomCount()).toBe(1);
  });

  it("keeps empty rooms loaded when there's nowhere to save them", async () => {
    await server.close();
    let left = 0;
    await startServer({
      store: undefined,
      unloadAfterMs: 50,
      log: (line) => (left += Number(line.includes("left"))),
    });
    const alice = await join("Alice");

    leave(alice);

    await waitFor(() => left === 1, "the server to see alice leave");
    await sleep(50 + 100); // past the unload delay, with room to spare
    expect(server.roomCount()).toBe(1);
  });
});
