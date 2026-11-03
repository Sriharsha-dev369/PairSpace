// Spec for who may do what in a room (M5's done-when): the owner, an editor, a viewer, and
// anyone whose link was turned off. Runs the real app against the test database.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import type { WebsocketProvider } from "y-websocket";
import { type App, startApp } from "../src/app";
import { openRoomStore } from "../src/room-store";
import { connect, openRoom, signUp as signUpTo, WEB_ORIGIN } from "./browser";
import { TEST_DATABASE_URL } from "./database";
import { SETTLE_MS, sleep, waitFor } from "./wait";

const store = openRoomStore(TEST_DATABASE_URL);
let app: App;
let providers: WebsocketProvider[] = [];
let sockets: WebSocket[] = [];

beforeAll(async () => {
  app = await startApp({ port: 0, databaseUrl: TEST_DATABASE_URL, webOrigin: WEB_ORIGIN });
});
afterEach(() => {
  for (const provider of providers) provider.destroy();
  for (const socket of sockets) socket.close();
  providers = [];
  sockets = [];
});
afterAll(async () => {
  await app.close();
  await store.close();
});

// a new member's session cookie
const signUp = async (name: string) => (await signUpTo(app, name)).cookie;

function api(method: string, path: string, cookie: string, body?: object) {
  return fetch(`http://localhost:${app.port}/api/rooms${path}`, {
    method,
    headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie },
    body: body && JSON.stringify(body),
  });
}

// a Yjs client in the room, as a member (cookie) and/or through a share link
async function join(room: string, who: { cookie?: string; link?: string }) {
  const provider = openRoom(app, room, who);
  providers.push(provider);
  await waitFor(() => provider.synced, "to sync");
  return provider.doc.getText("probe");
}

// a plain connection, closed after the test
function connectTo(room: string, who: { cookie?: string; link?: string }) {
  const connection = connect(app, room, who);
  sockets.push(connection.socket);
  return connection;
}

// the owner's room, with an edit link and a view link
let owner: string;
let room: string;
let editLink: string;
let viewLink: string;
beforeEach(async () => {
  owner = await signUp("Owner");
  room = (await (await api("POST", "", owner, { title: "Shared" })).json()).id;
  editLink = (await (await api("POST", `/${room}/links`, owner, { role: "editor" })).json()).code;
  viewLink = (await (await api("POST", `/${room}/links`, owner, { role: "viewer" })).json()).code;
});

// what someone may do with the room through the API: 404 means "not yours to change"
async function manages(cookie: string) {
  const statuses = [
    (await api("PATCH", `/${room}`, cookie, { title: "Renamed" })).status,
    (await api("POST", `/${room}/links`, cookie, { role: "editor" })).status,
    (await api("GET", `/${room}/links`, cookie)).status,
  ];
  return statuses.every((status) => status === 200);
}

describe("permissions", () => {
  it("the owner edits, and manages the room", async () => {
    const text = await join(room, { cookie: owner });

    text.insert(0, "by the owner");

    await waitFor(
      async () => (await store.history(room)).some((c) => c.author === "Owner"),
      "the owner's change to be saved",
      2000,
    );
    expect(await manages(owner)).toBe(true);
  });

  it("an editor edits, but can't rename, share or delete", async () => {
    const editor = await signUp("Editor");
    const ownerText = await join(room, { cookie: owner });
    const editorText = await join(room, { cookie: editor, link: editLink });

    editorText.insert(0, "by the editor");

    await waitFor(() => ownerText.toString() === "by the editor", "the owner to see it");
    expect(await manages(editor)).toBe(false);
    expect((await api("DELETE", `/${room}`, editor)).status).toBe(404);
  });

  it("a viewer sees every edit but can't make one, or rename, share or delete", async () => {
    const viewer = await signUp("Viewer");
    const ownerText = await join(room, { cookie: owner });
    const viewerText = await join(room, { cookie: viewer, link: viewLink });

    viewerText.insert(0, "by the viewer "); // the browser's editor won't allow it; a client could
    ownerText.insert(ownerText.length, "by the owner");

    await waitFor(() => viewerText.toString().includes("by the owner"), "the viewer to see it");
    await sleep(SETTLE_MS);
    expect(ownerText.toString()).toBe("by the owner");
    expect((await store.history(room)).some((c) => c.author === "Viewer")).toBe(false);
    expect(await manages(viewer)).toBe(false);
    expect((await api("DELETE", `/${room}`, viewer)).status).toBe(404);
  });

  it("a turned-off link cuts off everyone who came through it, and keeps them out", async () => {
    const member = await signUp("Member");
    await (await connectTo(room, { cookie: member, link: editLink })).admitted; // now a member
    const guest = connectTo(room, { link: editLink });
    const memberAgain = connectTo(room, { cookie: member }); // in by membership, no link
    const ownerInside = connectTo(room, { cookie: owner });
    await Promise.all([guest.admitted, memberAgain.admitted, ownerInside.admitted]);

    expect((await api("DELETE", `/${room}/links/${editLink}`, owner)).status).toBe(204);

    expect(await guest.closed).toBe(4403);
    expect(await memberAgain.closed).toBe(4403);
    expect(await connectTo(room, { link: editLink }).closed).toBe(4403);
    expect(await connectTo(room, { cookie: member }).closed).toBe(4403);
    expect(
      (await api("GET", "", member)).ok && (await (await api("GET", "", member)).json()),
    ).toEqual([]);
  });
});
