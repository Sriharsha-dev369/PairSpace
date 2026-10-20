// Spec for a room session: what the UI gets when it joins a room.
// Runs against the real sync server on a random port.

import { createSyncServer, type SyncServer } from "pairspace-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { joinRoom, type RoomSession, type User } from "./session";

const alice: User = { name: "Alice", color: "#f472b6" };
const bob: User = { name: "Bob", color: "#60a5fa" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// poll until a condition is true (never sleep and hope)
async function waitFor(condition: () => boolean, what: string, timeoutMs = 1000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${what}`);
    await sleep(5);
  }
}

describe("room session", () => {
  let server: SyncServer;
  let sessions: RoomSession[];

  beforeEach(async () => {
    server = await createSyncServer({ port: 0 });
    sessions = [];
  });

  afterEach(async () => {
    for (const s of sessions) s.leave();
    await server.close();
  });

  function join(room = "room1", user = alice): RoomSession {
    const session = joinRoom({ serverUrl: `ws://localhost:${server.port}`, room, user });
    sessions.push(session);
    return session;
  }

  it("connects and lists the room's files once synced", async () => {
    const session = join();

    await session.synced;

    expect(session.status()).toBe("connected");
    expect(session.files().map((f) => f.name)).toEqual(["main.js"]);
  });

  it("tells the UI when the connection drops", async () => {
    const session = join();
    await session.synced;
    let notified = 0;
    session.subscribe(() => notified++);

    await server.close();

    await waitFor(() => session.status() === "disconnected", "status to become disconnected");
    expect(notified).toBeGreaterThan(0);
  });

  it("lists everyone in the room with their name and colour", async () => {
    const mine = join("room1", alice);
    const theirs = join("room1", bob);
    await Promise.all([mine.synced, theirs.synced]);

    await waitFor(() => theirs.people().length === 2, "bob to see two people");

    expect(theirs.people()).toEqual(
      expect.arrayContaining([
        { name: "Alice", color: alice.color, isMe: false },
        { name: "Bob", color: bob.color, isMe: true },
      ]),
    );
  });
});
