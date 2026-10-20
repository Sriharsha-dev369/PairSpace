// Spec for a room session: what the UI gets when it joins a room.
// Runs against the real sync server on a random port.

import { createSyncServer, type SyncServer } from "pairspace-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { joinRoom, type RoomSession, type User } from "./session";

const alice: User = { name: "Alice", color: "#f472b6" };

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
});
