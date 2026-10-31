// Spec for a room session: what the UI gets when it joins a room.
// Runs against the real sync server on a random port.

import { createSyncServer, type SyncServer } from "pairspace-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { joinRoom, type RoomSession, type User } from "./session";

const alice: User = { id: "alice", name: "Alice", color: "#f472b6" };
const bob: User = { id: "bob", name: "Bob", color: "#60a5fa" };

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
  let logged: string[];
  const logCount = (word: string) => logged.filter((line) => line.includes(word)).length;

  beforeEach(async () => {
    logged = [];
    server = await createSyncServer({ port: 0, log: (line) => logged.push(line) });
    sessions = [];
  });

  afterEach(async () => {
    for (const s of sessions) s.leave();
    await server.close();
  });

  // network: stands in for the browser's window, which fires "online" and "offline"
  function join(room = "room1", user = alice, network = new EventTarget()): RoomSession {
    const session = joinRoom({
      serverUrl: `ws://localhost:${server.port}`,
      room,
      user,
      networkEvents: network,
    });
    sessions.push(session);
    return session;
  }

  it("connects and lists the room's files once synced", async () => {
    const session = join();

    await session.synced;

    expect(session.status()).toBe("connected");
    expect(session.files().map((f) => f.name)).toEqual(["main.js"]);
  });

  it("says why the server refused the room", async () => {
    await expect(join("not.a.valid.room").synced).rejects.toMatchObject({ code: 4400 });

    await server.close();
    // a server whose store has no rooms: opening an address never creates one
    const noRooms = {
      load: async () => null,
      append: async () => 0,
      snapshot: async () => {},
    };
    server = await createSyncServer({ port: 0, store: noRooms });
    await expect(join("never-created").synced).rejects.toMatchObject({ code: 4404 });
  });

  it("says it's reconnecting when the connection drops, and keeps saying so while it retries", async () => {
    const session = join();
    await session.synced;
    const seen: string[] = []; // what the UI would show after each notification
    session.subscribe(() => seen.push(session.status()));

    await server.close();

    // one notification for the drop, then one per retry
    await waitFor(() => seen.length >= 3, "the drop and two retries", 2000);
    expect([...new Set(seen)]).toEqual(["reconnecting"]);
  });

  it("goes offline at once when the browser loses its network, and doesn't retry until it's back", async () => {
    const network = new EventTarget();
    const session = join("room1", alice, network);
    await session.synced;
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.status()));

    network.dispatchEvent(new Event("offline"));

    expect(seen.at(-1)).toBe("offline"); // at once, not after y-websocket's 30s silence rule
    await waitFor(() => logCount("left") === 1, "the server to see the connection close");
    await sleep(600); // longer than the provider's first reconnect delay (200ms)
    expect(logCount("joined")).toBe(1);
  });

  it("reconnects as soon as the browser is back online", async () => {
    const network = new EventTarget();
    const session = join("room1", alice, network);
    await session.synced;
    network.dispatchEvent(new Event("offline"));
    await waitFor(() => logCount("left") === 1, "the server to see the connection close");

    network.dispatchEvent(new Event("online"));

    await waitFor(() => session.status() === "connected", "the session to reconnect");
    expect(logCount("joined")).toBe(2);
  });

  it("stops listening for the network once it has left the room", async () => {
    const network = new EventTarget();
    const session = join("room1", alice, network);
    await session.synced;
    session.leave();
    await waitFor(() => logCount("left") === 1, "the server to see it leave");

    network.dispatchEvent(new Event("online"));

    await join("room1", bob).synced; // arrives after any reconnect the event would have caused
    await sleep(50);
    expect(logCount("joined")).toBe(2); // alice once, bob once
  });

  it("counts only edits made while disconnected as unsynced, until they've synced", async () => {
    const network = new EventTarget();
    const mine = join("room1", alice, network);
    const theirs = join("room1", bob);
    await Promise.all([mine.synced, theirs.synced]);
    const text = mine.files()[0].content;
    const seen: boolean[] = []; // what the UI would show after each notification
    mine.subscribe(() => seen.push(mine.unsyncedEdits()));

    text.insert(0, "online ");
    expect(mine.unsyncedEdits()).toBe(false);

    network.dispatchEvent(new Event("offline"));
    text.insert(text.length, "offline");
    expect(seen.at(-1)).toBe(true);

    network.dispatchEvent(new Event("online"));
    await waitFor(() => seen.at(-1) === false, "the UI to be told the edits synced");
    await waitFor(
      () => theirs.files()[0].content.toString() === "online offline",
      "bob to get the offline edit",
    );
  });

  it("says so when the room is deleted while you're in it, and stops reconnecting", async () => {
    const session = join();
    await session.synced;
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.status()));

    await server.dropRoom("room1");

    await waitFor(() => seen.at(-1) === "deleted", "the UI to be told the room was deleted");
    await sleep(600); // longer than the provider's first reconnect delay (200ms)
    expect(logCount("joined")).toBe(1);
  });

  it("stops reconnecting and says so when a change is too large to sync", async () => {
    await server.close();
    let joins = 0;
    server = await createSyncServer({
      port: 0,
      maxMessageBytes: 1000,
      log: (line) => {
        if (line.includes("joined")) joins++;
      },
    });
    const session = join();
    await session.synced;
    const seen: string[] = []; // what the UI would show after each notification
    session.subscribe(() => seen.push(session.status()));

    session.files()[0].content.insert(0, "x".repeat(2000));

    await waitFor(() => seen.at(-1) === "too-large", "the UI to be told the change is too large");
    await sleep(600); // longer than the provider's first reconnect delay (200ms)
    expect(joins).toBe(1);
  });

  it("tells the UI when someone joins", async () => {
    const mine = join("room1", alice);
    await mine.synced;
    let notified = 0;
    mine.subscribe(() => notified++);

    join("room1", bob);

    await waitFor(() => mine.people().length === 2, "alice to see bob");
    expect(notified).toBeGreaterThan(0);
  });

  it("lists everyone in the room with their name and colour", async () => {
    const mine = join("room1", alice);
    const theirs = join("room1", bob);
    await Promise.all([mine.synced, theirs.synced]);

    await waitFor(() => theirs.people().length === 2, "bob to see two people");

    expect(theirs.people()).toEqual(
      expect.arrayContaining([
        { id: "alice", name: "Alice", color: alice.color, isMe: false },
        { id: "bob", name: "Bob", color: bob.color, isMe: true },
      ]),
    );
  });

  it("shows each person once, however many tabs they have open", async () => {
    const tab = join("room1", alice);
    const otherTab = join("room1", alice); // same browser: same person
    const theirs = join("room1", bob);
    await Promise.all([tab.synced, otherTab.synced, theirs.synced]);

    // every tab's presence has arrived everywhere
    for (const session of [tab, theirs]) {
      await waitFor(() => session.awareness.getStates().size === 3, "all three tabs' presence");
    }

    expect(
      theirs
        .people()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["Alice", "Bob"]);
    expect(tab.people()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Alice", isMe: true }),
        expect.objectContaining({ name: "Bob", isMe: false }),
      ]),
    );
    expect(tab.people()).toHaveLength(2);
  });
});
