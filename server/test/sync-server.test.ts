// Spec for the sync server: read the test names top to bottom to see how it should behave.
// Every test starts its own server on a random free port, so tests never affect each other.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { createSyncServer, type SyncServer } from "../src/sync-server";

// ---------- test helpers ----------

interface RawClient {
  closed(): Promise<{ code: number; reason: string }>; // fails after 1s if the connection never closes
  close(): void;
}

interface YjsClient {
  doc: Y.Doc;
  provider: WebsocketProvider;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// poll until a condition is true (never sleep and hope)
async function waitFor(condition: () => boolean, what: string, timeoutMs = 1000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${what}`);
    await sleep(5);
  }
}

// deterministic random numbers, so a failing run can be replayed from its printed seed
function seededRandom(seed: number) {
  let state = seed % 2147483647 || 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

// To prove something did NOT happen we can't wait for it. Instead we wait for something we know
// will happen, then give the network a short extra moment, then check.
const SETTLE_MS = 50;

describe("sync server", () => {
  let server: SyncServer;
  let rawClients: RawClient[];
  let providers: WebsocketProvider[];

  beforeEach(async () => {
    server = await createSyncServer({ port: 0 });
    rawClients = [];
    providers = [];
  });

  afterEach(async () => {
    for (const c of rawClients) c.close();
    for (const p of providers) p.destroy();
    await server.close();
  });

  // a plain WebSocket, for connection-level behavior (validation, room lifecycle)
  async function connectRaw(room: string): Promise<RawClient> {
    const socket = new WebSocket(`ws://localhost:${server.port}/${room}`);
    const closeEvent = new Promise<{ code: number; reason: string }>((resolve) =>
      socket.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason })),
    );
    const client: RawClient = {
      // created on demand so a never-awaited rejection can't crash the run
      closed: () =>
        Promise.race([
          closeEvent,
          sleep(1000).then(() => {
            throw new Error("the connection was not closed within 1s");
          }),
        ]),
      close: () => socket.close(),
    };
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("could not connect")), {
        once: true,
      });
    });
    rawClients.push(client);
    return client;
  }

  // a real Yjs client, exactly as the browser uses it
  async function joinRoom(room: string): Promise<YjsClient> {
    const doc = new Y.Doc();
    // disableBc: in one process, BroadcastChannel would sync clients directly and bypass the server
    const provider = new WebsocketProvider(`ws://localhost:${server.port}`, room, doc, {
      disableBc: true,
    });
    providers.push(provider);
    await waitFor(() => provider.synced, `${room} to sync`);
    return { doc, provider };
  }

  const text = (client: YjsClient) => client.doc.getText("probe").toString();

  // ---------- syncing documents ----------

  describe("syncing documents", () => {
    it("delivers an edit from one client to another in the same room", async () => {
      const alice = await joinRoom("room1");
      const bob = await joinRoom("room1");

      alice.doc.getText("probe").insert(0, "hello");

      await waitFor(() => text(bob) === "hello", "bob to see alice's edit");
    });

    it("gives a late joiner everything written before they arrived", async () => {
      const alice = await joinRoom("room1");
      alice.doc.getText("probe").insert(0, "written earlier");
      await sleep(SETTLE_MS); // let the server receive it

      const bob = await joinRoom("room1");

      expect(text(bob)).toBe("written earlier");
    });

    it("converges when three people edit at the same time", async () => {
      const clients = await Promise.all([joinRoom("busy"), joinRoom("busy"), joinRoom("busy")]);
      const seed = Date.now();
      const random = seededRandom(seed);
      let inserted = 0;

      // all edits are made before any of them can arrive anywhere else, so they truly overlap
      for (let i = 0; i < 60; i++) {
        const t = clients[i % 3].doc.getText("probe");
        const chunk = `${i % 3}${"x".repeat(Math.floor(random() * 3))}`;
        t.insert(Math.floor(random() * (t.length + 1)), chunk);
        inserted += chunk.length;
      }

      const stateOf = (c: YjsClient) => Y.encodeStateVector(c.doc).toString();
      await waitFor(
        () => clients.every((c) => stateOf(c) === stateOf(clients[0])),
        `every client to receive every edit (seed ${seed})`,
      );
      expect(new Set(clients.map(text)).size, `seed ${seed}`).toBe(1);
      expect(text(clients[0]).length, `seed ${seed}`).toBe(inserted);
    });

    it("never mixes documents between rooms", async () => {
      const alice = await joinRoom("room1");
      const bob = await joinRoom("room1");
      const carol = await joinRoom("room2");

      alice.doc.getText("probe").insert(0, "only for room1");
      await waitFor(() => text(bob) === "only for room1", "bob to see alice's edit");
      await sleep(SETTLE_MS);

      expect(text(carol)).toBe("");
    });
  });

  // ---------- presence (names, colours, cursors: shared live, never saved) ----------

  describe("presence", () => {
    const sees = (viewer: YjsClient, name: string) =>
      [...viewer.provider.awareness.getStates().values()].some((s) => s.user?.name === name);

    it("shows each person's presence to the others in the room", async () => {
      const alice = await joinRoom("room1");
      const bob = await joinRoom("room1");

      alice.provider.awareness.setLocalStateField("user", { name: "Alice" });

      await waitFor(() => sees(bob, "Alice"), "bob to see alice's presence");
    });

    it("shows a newcomer the people who were already in the room", async () => {
      const alice = await joinRoom("room1");
      const carol = await joinRoom("room1");
      alice.provider.awareness.setLocalStateField("user", { name: "Alice" });
      await waitFor(() => sees(carol, "Alice"), "the server to know about alice");

      const bob = await joinRoom("room1");

      await waitFor(() => sees(bob, "Alice"), "bob to see alice, who was there first");
    });

    it("removes a person's presence when their connection drops without a goodbye", async () => {
      const alice = await joinRoom("room1");
      const bob = await joinRoom("room1");
      alice.provider.awareness.setLocalStateField("user", { name: "Alice" });
      await waitFor(() => sees(bob, "Alice"), "bob to see alice");

      // a crashed tab: the socket just closes, without the "I'm leaving" presence message
      // a graceful provider.destroy() would send
      alice.provider.shouldConnect = false;
      alice.provider.ws?.close();

      await waitFor(() => !sees(bob, "Alice"), "alice's presence to disappear for bob");
    });
  });

  // ---------- the room's files ----------

  describe("room files", () => {
    // if clients created the first file, two people opening a new room at the same moment
    // would each create one, and the shared map would silently keep only one of them
    it("starts a new room with exactly one file, even when two people join at once", async () => {
      const [alice, bob] = await Promise.all([joinRoom("fresh"), joinRoom("fresh")]);

      const filesOf = (c: YjsClient) => c.doc.getMap<Y.Map<unknown>>("files");
      expect(filesOf(alice).size).toBe(1);
      expect([...filesOf(bob).keys()]).toEqual([...filesOf(alice).keys()]);

      const [file] = filesOf(alice).values();
      expect(file.get("name")).toBe("main.js");
      expect(file.get("content")).toBeInstanceOf(Y.Text);
    });
  });

  // ---------- rooms ----------

  describe("room lifecycle", () => {
    it("creates a room when the first person joins", async () => {
      expect(server.roomCount()).toBe(0);
      await connectRaw("room1");
      expect(server.roomCount()).toBe(1);
    });

    it("reuses the same room for later joiners", async () => {
      await connectRaw("room1");
      await connectRaw("room1");
      expect(server.roomCount()).toBe(1);
    });

    it("removes a room when its last person leaves (no memory leak)", async () => {
      const alice = await connectRaw("room1");
      const bob = await connectRaw("room1");

      alice.close();
      await alice.closed();
      await sleep(SETTLE_MS); // give the server time to process the leave
      expect(server.roomCount(), "room stays while bob is still in it").toBe(1);

      bob.close();
      await waitFor(() => server.roomCount() === 0, "room to be removed");
    });

    it("handles many clients joining and leaving", async () => {
      const crowd = await Promise.all(Array.from({ length: 30 }, () => connectRaw("busy")));
      expect(server.roomCount()).toBe(1);

      for (const c of crowd) c.close();
      await waitFor(() => server.roomCount() === 0, "all 30 to leave and the room to be removed");
    });
  });

  // ---------- room name validation ----------

  describe("room name validation", () => {
    const badNames: [string, string][] = [
      ["empty name", ""],
      ["spaces", "has%20space"],
      ["dots", "a.b"],
      ["nested path", "a/b"],
      ["non-ASCII characters", "caf%C3%A9"],
      ["65 characters (one over the limit)", "x".repeat(65)],
    ];

    for (const [label, name] of badNames) {
      it(`rejects ${label} with close code 4400`, async () => {
        const client = await connectRaw(name);
        const { code } = await client.closed();
        expect(code).toBe(4400);
      });
    }

    it("tells a rejected client not to keep retrying", async () => {
      const provider = new WebsocketProvider(`ws://localhost:${server.port}`, "a.b", new Y.Doc(), {
        disableBc: true,
      });
      providers.push(provider);
      let closes = 0;
      provider.on("connection-close", () => closes++);

      await waitFor(() => closes >= 1, "the first rejection");
      await sleep(600); // longer than the provider's first reconnect delay (200ms)

      expect(closes).toBe(1);
    });

    it("accepts a 64 character name (the limit itself)", async () => {
      await connectRaw("x".repeat(64));
      await sleep(SETTLE_MS);
      expect(server.roomCount()).toBe(1);
    });

    it("accepts letters, digits, dash and underscore", async () => {
      await connectRaw("Room_42-b");
      expect(server.roomCount()).toBe(1);
    });

    it("does not create a room for a rejected client", async () => {
      const client = await connectRaw("bad%20name");
      await client.closed();
      expect(server.roomCount()).toBe(0);
    });
  });

  // ---------- known gaps: not built yet, tracked here so we don't forget ----------

  describe("not built yet", () => {
    it.todo("detects a client whose connection died silently (heartbeat)");
    it.todo("rejects messages above a maximum size");
    it.todo("lets a disconnected client catch up on what it missed");
  });
});
