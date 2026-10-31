// Spec for saving rooms: what survives a server restart, and what gets recorded.
// Runs the sync server against the real test database; every test uses a fresh room name.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
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
  async function startServer(
    options: { port?: number; store?: RoomStore; saveDelayMs?: number } = {},
  ) {
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
    };
    await server.close();
    await startServer({ store: flaky });
    const alice = await join("Alice"); // the room and its first file are saved
    failWrites = 1;

    type(alice, "saved on the retry");

    await waitFor(async () => (await authors()).includes("Alice"), "the retry to save it");
    const saved = new Y.Doc();
    Y.applyUpdate(saved, (await store.load(room)) ?? new Uint8Array());
    expect(saved.getText("probe").toString()).toBe("saved on the retry");
  });
});
