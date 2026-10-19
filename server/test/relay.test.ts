// Spec for the relay server: read the test names top to bottom to see how it should behave.
// Every test starts its own server on a random free port, so tests never affect each other.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRelayServer, type RelayServer } from "../src/relay.ts";

// ---------- test helpers ----------

interface TestClient {
  messages: string[]; // everything this client has received, in order
  closed(): Promise<{ code: number; reason: string }>; // fails after 1s if the connection never closes
  send(text: string): void;
  close(): void;
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

// To prove a message did NOT arrive we can't wait for it. Instead we wait for a message we know
// will arrive, then give the network a short extra moment, then check the other client got nothing.
const SETTLE_MS = 50;

describe("relay server", () => {
  let server: RelayServer;
  let clients: TestClient[];

  beforeEach(async () => {
    server = await createRelayServer({ port: 0 });
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  async function connect(room: string): Promise<TestClient> {
    const socket = new WebSocket(`ws://localhost:${server.port}/${room}`);
    const closeEvent = new Promise<{ code: number; reason: string }>((resolve) =>
      socket.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason })),
    );
    const client: TestClient = {
      messages: [],
      // created on demand so a never-awaited rejection can't crash the run
      closed: () =>
        Promise.race([
          closeEvent,
          sleep(1000).then(() => {
            throw new Error("the connection was not closed within 1s");
          }),
        ]),
      send: (text) => socket.send(text),
      close: () => socket.close(),
    };
    socket.addEventListener("message", (e) => client.messages.push(String(e.data)));
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("could not connect")), { once: true });
    });
    clients.push(client);
    return client;
  }

  const gotMessages = (client: TestClient, count: number) =>
    waitFor(() => client.messages.length >= count, `${count} message(s)`);

  // ---------- happy path ----------

  describe("relaying messages", () => {
    it("delivers a message to the other client in the same room", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");

      alice.send("hello");
      await gotMessages(bob, 1);

      assert.deepEqual(bob.messages, ["hello"]);
    });

    it("does not echo a message back to its sender", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");

      alice.send("hello");
      await gotMessages(bob, 1);
      await sleep(SETTLE_MS);

      assert.deepEqual(alice.messages, []);
    });

    it("delivers to every other client in the room, not only one", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");
      const carol = await connect("room1");

      alice.send("hello all");
      await gotMessages(bob, 1);
      await gotMessages(carol, 1);

      assert.deepEqual(bob.messages, ["hello all"]);
      assert.deepEqual(carol.messages, ["hello all"]);
    });

    it("works in both directions", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");

      alice.send("ping");
      bob.send("pong");
      await gotMessages(alice, 1);
      await gotMessages(bob, 1);

      assert.deepEqual(bob.messages, ["ping"]);
      assert.deepEqual(alice.messages, ["pong"]);
    });

    it("keeps messages from one sender in the order they were sent", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");
      const sent = Array.from({ length: 50 }, (_, i) => `msg-${i}`);

      for (const text of sent) alice.send(text);
      await gotMessages(bob, sent.length);

      assert.deepEqual(bob.messages, sent);
    });
  });

  // ---------- rooms ----------

  describe("rooms", () => {
    it("never delivers messages across different rooms", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");
      const carol = await connect("room2");

      alice.send("only for room1");
      await gotMessages(bob, 1); // proof the server has handled it
      await sleep(SETTLE_MS);

      assert.deepEqual(carol.messages, []);
    });

    it("lets several rooms talk at the same time without mixing", async () => {
      const a1 = await connect("room1");
      const a2 = await connect("room1");
      const b1 = await connect("room2");
      const b2 = await connect("room2");

      a1.send("from room1");
      b1.send("from room2");
      await gotMessages(a2, 1);
      await gotMessages(b2, 1);

      assert.deepEqual(a2.messages, ["from room1"]);
      assert.deepEqual(b2.messages, ["from room2"]);
    });

    it("creates a room when the first person joins", async () => {
      assert.equal(server.roomCount(), 0);
      await connect("room1");
      assert.equal(server.roomCount(), 1);
    });

    it("reuses the same room for later joiners", async () => {
      await connect("room1");
      await connect("room1");
      assert.equal(server.roomCount(), 1);
    });

    it("removes a room when its last person leaves (no memory leak)", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");

      alice.close();
      await alice.closed();
      await sleep(SETTLE_MS); // give the server time to process the leave
      assert.equal(server.roomCount(), 1, "room stays while bob is still in it");

      bob.close();
      await waitFor(() => server.roomCount() === 0, "room to be removed");
    });

    it("lets people rejoin a room after it was removed", async () => {
      const alice = await connect("room1");
      alice.close();
      await waitFor(() => server.roomCount() === 0, "room to be removed");

      const bob = await connect("room1");
      const carol = await connect("room1");
      bob.send("back again");
      await gotMessages(carol, 1);

      assert.deepEqual(carol.messages, ["back again"]);
    });
  });

  // ---------- edge cases ----------

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
      it(`rejects ${label} with close code 1008`, async () => {
        const client = await connect(name);
        const { code } = await client.closed();
        assert.equal(code, 1008);
      });
    }

    it("accepts a 64 character name (the limit itself)", async () => {
      const client = await connect("x".repeat(64));
      await sleep(SETTLE_MS);
      assert.equal(server.roomCount(), 1);
      client.close();
    });

    it("accepts letters, digits, dash and underscore", async () => {
      await connect("Room_42-b");
      assert.equal(server.roomCount(), 1);
    });

    it("does not create a room for a rejected client", async () => {
      const client = await connect("bad%20name");
      await client.closed();
      assert.equal(server.roomCount(), 0);
    });

    it("rejected clients do not receive messages from valid rooms", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");
      const intruder = await connect("bad%20name");
      await intruder.closed();

      alice.send("secret");
      await gotMessages(bob, 1);

      assert.deepEqual(intruder.messages, []);
    });
  });

  describe("unusual traffic and disconnects", () => {
    it("relays an empty message", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");

      alice.send("");
      await gotMessages(bob, 1);

      assert.deepEqual(bob.messages, [""]);
    });

    it("relays a large message (1 MB) unchanged", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");
      const big = "a".repeat(1_000_000);

      alice.send(big);
      await gotMessages(bob, 1);

      assert.equal(bob.messages[0], big);
    });

    it("keeps working for the others after one client leaves", async () => {
      const alice = await connect("room1");
      const bob = await connect("room1");
      const carol = await connect("room1");

      alice.close();
      await alice.closed();
      bob.send("still here");
      await gotMessages(carol, 1);

      assert.deepEqual(carol.messages, ["still here"]);
    });

    it("lets a client alone in a room send without errors", async () => {
      const alice = await connect("room1");
      alice.send("anyone there?");
      await sleep(SETTLE_MS);

      assert.deepEqual(alice.messages, []);
      assert.equal(server.roomCount(), 1);
    });

    it("handles many clients joining and leaving", async () => {
      const crowd = await Promise.all(Array.from({ length: 30 }, () => connect("busy")));
      assert.equal(server.roomCount(), 1);

      for (const c of crowd) c.close();
      await waitFor(() => server.roomCount() === 0, "all 30 to leave and the room to be removed");
    });
  });

  // ---------- known gaps: not built yet, tracked here so we don't forget ----------

  describe("not built yet", () => {
    it("detects a client whose connection died silently (heartbeat)", { todo: true });
    it("rejects messages above a maximum size", { todo: true });
    it("tells others when someone joins or leaves (presence)", { todo: true });
    it("lets a disconnected client catch up on what it missed", { todo: true });
  });
});
