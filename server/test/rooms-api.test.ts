// Spec for the rooms API behind the dashboard: members create, list, rename and delete their
// rooms. Runs the real app against the test database; members are real sign-ups.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { type App, startApp } from "../src/app";
import { openRoomStore } from "../src/room-store";
import { TEST_DATABASE_URL } from "./database";

const WEB_ORIGIN = "http://localhost:5173";
const store = openRoomStore(TEST_DATABASE_URL);
let app: App;

beforeAll(async () => {
  app = await startApp({ port: 0, databaseUrl: TEST_DATABASE_URL, webOrigin: WEB_ORIGIN });
});
afterAll(async () => {
  await app.close();
  await store.close();
});

async function signUp(name = "Alice") {
  const response = await fetch(`http://localhost:${app.port}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      name,
      email: `${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

// a request as the dashboard makes it: from the web app's origin, with the member's cookie
function api(
  method: string,
  path: string,
  { cookie, body, origin = WEB_ORIGIN }: { cookie?: string; body?: object; origin?: string } = {},
) {
  return fetch(`http://localhost:${app.port}/api/rooms${path}`, {
    method,
    headers: { origin, "content-type": "application/json", ...(cookie && { cookie }) },
    body: body && JSON.stringify(body),
  });
}

async function createRoom(cookie: string, title?: string): Promise<{ id: string; title: string }> {
  const response = await api("POST", "", { cookie, body: title === undefined ? {} : { title } });
  expect(response.status).toBe(201);
  return response.json();
}

const listRooms = async (cookie: string): Promise<{ id: string; title: string }[]> =>
  (await api("GET", "", { cookie })).json();

// how the server ends a connection to a room (or never does, within a second)
function connectTo(room: string) {
  const socket = new WebSocket(`ws://localhost:${app.port}/${room}`);
  const opened = new Promise((resolve) => socket.on("open", resolve));
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
  return { opened, closed };
}

describe("rooms API", () => {
  it("creates a room for a member, with one file, named or 'Untitled room'", async () => {
    const alice = await signUp();

    const untitled = await createRoom(alice);
    const named = await createRoom(alice, "  Interview prep  ");

    expect(untitled.title).toBe("Untitled room");
    expect(named.title).toBe("Interview prep");
    const saved = await store.load(named.id);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, saved?.state ?? new Uint8Array());
    expect(doc.getMap("files").size).toBe(1);
  });

  it("refuses a room name that's empty, too long or not text", async () => {
    const alice = await signUp();

    for (const title of ["", "   ", "x".repeat(81), 42]) {
      const response = await api("POST", "", { cookie: alice, body: { title } });
      expect(response.status, JSON.stringify(title)).toBe(400);
    }
    expect(await listRooms(alice)).toEqual([]);
  });

  it("lists only my rooms", async () => {
    const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
    const mine = [await createRoom(alice, "One"), await createRoom(alice, "Two")];
    await createRoom(bob, "Bob's");

    const listed = await listRooms(alice);

    expect(listed.map((room) => room.id).sort()).toEqual(mine.map((room) => room.id).sort());
  });

  it("renames my room, but not someone else's", async () => {
    const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
    const { id } = await createRoom(alice, "Before");

    expect(
      (await api("PATCH", `/${id}`, { cookie: bob, body: { title: "Bob's now" } })).status,
    ).toBe(
      404, // someone else's room looks exactly like a missing one
    );
    expect((await api("PATCH", `/${id}`, { cookie: alice, body: { title: "After" } })).status).toBe(
      200,
    );
    expect((await listRooms(alice))[0].title).toBe("After");
  });

  it("deletes my room with its history, but not someone else's", async () => {
    const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
    const { id } = await createRoom(alice);

    expect((await api("DELETE", `/${id}`, { cookie: bob })).status).toBe(404);
    expect(await store.load(id)).not.toBeNull();
    expect((await api("DELETE", `/${id}`, { cookie: alice })).status).toBe(204);
    expect(await store.load(id)).toBeNull();
    expect(await store.history(id)).toEqual([]);
  });

  it("disconnects everyone in a deleted room, and its address stops working", async () => {
    const alice = await signUp();
    const { id } = await createRoom(alice);
    const inside = connectTo(id);
    await inside.opened;

    await api("DELETE", `/${id}`, { cookie: alice });

    expect(await inside.closed).toBe(4410); // "room deleted"; clients don't retry 44xx
    expect(await connectTo(id).closed).toBe(4404);
  });

  it("is only for members", async () => {
    expect((await api("GET", "")).status).toBe(401);
    expect((await api("POST", "", { body: {} })).status).toBe(401);
  });

  // another website can make a signed-in browser send requests here; its origin gives it away
  it("refuses changes from another website", async () => {
    const alice = await signUp();

    const forged = await api("POST", "", {
      cookie: alice,
      body: {},
      origin: "http://evil.example",
    });

    expect(forged.status).toBe(403);
    expect(await listRooms(alice)).toEqual([]);
  });
});
