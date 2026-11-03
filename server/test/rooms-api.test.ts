// Spec for the rooms API behind the dashboard: members create, list, rename and delete their
// rooms. Runs the real app against the test database; members are real sign-ups.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { type App, startApp } from "../src/app";
import { openRoomStore } from "../src/room-store";
import { connect, signUp as signUpTo, WEB_ORIGIN } from "./browser";
import { TEST_DATABASE_URL } from "./database";

const store = openRoomStore(TEST_DATABASE_URL);
let app: App;

beforeAll(async () => {
  app = await startApp({ port: 0, databaseUrl: TEST_DATABASE_URL, webOrigin: WEB_ORIGIN });
});
afterAll(async () => {
  await app.close();
  await store.close();
});

// a new member's session cookie
const signUp = async (name?: string) => (await signUpTo(app, name)).cookie;

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

  it("refuses a body that isn't a JSON object, instead of failing", async () => {
    const alice = await signUp();
    const { id } = await createRoom(alice);

    for (const [method, path] of [
      ["POST", ""],
      ["PATCH", `/${id}`],
      ["POST", `/${id}/links`],
    ]) {
      for (const body of ["null", "[]", "42", "not json"]) {
        const response = await fetch(`http://localhost:${app.port}/api/rooms${path}`, {
          method,
          headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: alice },
          body,
        });
        expect(response.status, `${method} ${path} ${body}`).toBe(400);
      }
    }
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
    const inside = connect(app, id, { cookie: alice }); // the owner, in the room
    await inside.admitted;

    await api("DELETE", `/${id}`, { cookie: alice });

    expect(await inside.closed).toBe(4410); // "room deleted"; clients don't retry 44xx
    expect(await connect(app, id, { cookie: alice }).closed).toBe(4404);
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

describe("sharing API", () => {
  const shareLink = async (cookie: string, id: string) =>
    api("POST", `/${id}/links`, { cookie, body: { role: "editor" } });

  // a signed-in browser opening a share link joins the room (the server records it then)
  async function openLink(cookie: string, room: string, code: string) {
    const { socket, admitted } = connect(app, room, { cookie, link: code });
    await admitted;
    socket.close();
  }

  it("gives the owner a share link, the same each time, and nobody else", async () => {
    const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
    const { id } = await createRoom(alice);

    const first = await (await shareLink(alice, id)).json();
    const again = await (await shareLink(alice, id)).json();

    expect(first).toEqual({ code: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), role: "editor" });
    expect(again.code).toBe(first.code);
    expect((await shareLink(bob, id)).status).toBe(404);
  });

  it("tells anyone which room a link opens, and 404 for a made-up one", async () => {
    const alice = await signUp();
    const { id } = await createRoom(alice, "Pairing");
    const { code } = await (await shareLink(alice, id)).json();
    const lookUp = (link: string) => fetch(`http://localhost:${app.port}/api/links/${link}`);

    expect(await (await lookUp(code)).json()).toEqual({
      roomId: id,
      title: "Pairing",
      role: "editor",
    });
    expect((await lookUp("made-up-code")).status).toBe(404);
  });

  it("tells people with access a room's title and their role, and nobody else", async () => {
    const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
    const { id } = await createRoom(alice, "Pairing");
    const { code } = await (await shareLink(alice, id)).json();

    expect(await (await api("GET", `/${id}`, { cookie: alice })).json()).toEqual({
      id,
      title: "Pairing",
      role: "owner",
    });
    expect((await (await api("GET", `/${id}?link=${code}`)).json()).role).toBe("editor"); // a guest
    expect((await api("GET", `/${id}`, { cookie: bob })).status).toBe(404);
    expect((await api("GET", `/${id}`)).status).toBe(404);
  });

  // replay (M8) shows text that was later deleted, so it's for people who can edit
  it("gives the room's history to people who can edit, oldest first, with who and when", async () => {
    const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
    const { id } = await createRoom(alice);
    const edit = (await (await shareLink(alice, id)).json()).code;
    const view = (
      await (await api("POST", `/${id}/links`, { cookie: alice, body: { role: "viewer" } })).json()
    ).code;
    const typed = new Y.Doc();
    typed.getText("probe").insert(0, "hello");
    const change = Y.encodeStateAsUpdate(typed);
    await store.append(id, [{ update: change, author: "Alice", authorId: null }]);

    const response = await api("GET", `/${id}/history`, { cookie: alice });

    expect(response.status).toBe(200);
    const history = await response.json();
    expect(history.map((step: { author: string | null }) => step.author)).toEqual([null, "Alice"]);
    expect(new Date(history[1].at).getTime()).toBeGreaterThanOrEqual(
      new Date(history[0].at).getTime(),
    );
    expect(Buffer.from(history[1].update, "base64")).toEqual(Buffer.from(change));
    expect((await api("GET", `/${id}/history?link=${edit}`)).status).toBe(200); // a guest who edits
    expect((await api("GET", `/${id}/history?link=${view}`)).status).toBe(403); // view only
    expect((await api("GET", `/${id}/history`, { cookie: bob })).status).toBe(404); // no access
  });

  it("lists rooms shared with me, which I can't rename or delete", async () => {
    const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
    const { id } = await createRoom(alice, "Alice's room");
    const { code } = await (await shareLink(alice, id)).json();
    await openLink(bob, id, code);

    expect(await listRooms(bob)).toEqual([expect.objectContaining({ id, role: "editor" })]);
    expect((await api("PATCH", `/${id}`, { cookie: bob, body: { title: "Mine" } })).status).toBe(
      404,
    );
    expect((await api("DELETE", `/${id}`, { cookie: bob })).status).toBe(404);
  });
});
