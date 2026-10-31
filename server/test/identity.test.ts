// Spec for who's who on the room server: members by their session cookie, everyone else a guest.
// Runs the real app (Better Auth + Postgres); members are real sign-ups, rooms are fresh per test.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { type App, startApp } from "../src/app";
import { newRoomDocument } from "../src/room-document";
import { openRoomStore } from "../src/room-store";
import { TEST_DATABASE_URL } from "./database";
import { waitFor } from "./wait";

const WEB_ORIGIN = "http://localhost:5173";
const store = openRoomStore(TEST_DATABASE_URL);
let app: App;
let providers: WebsocketProvider[] = [];
let room: string;

beforeAll(async () => {
  app = await startApp({ port: 0, databaseUrl: TEST_DATABASE_URL, webOrigin: WEB_ORIGIN });
});
beforeEach(() => {
  room = `room-${crypto.randomUUID()}`;
});
afterEach(() => {
  for (const provider of providers) provider.destroy();
  providers = [];
});
afterAll(async () => {
  await app.close();
  await store.close();
});

interface Member {
  id: string;
  cookie: string; // what the browser sends back to us after signing in
}

async function signUp(name: string): Promise<Member> {
  const response = await fetch(`http://localhost:${app.port}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      name,
      email: `${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  const { user } = await response.json();
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { id: user.id, cookie };
}

// a Yjs client as the browser runs it, showing `displayName`; members also send their cookie,
// and anyone opening a share link sends its code
async function join(displayName: string, member?: Member, link?: string) {
  // browsers send cookies with the WebSocket request by themselves; in Node we add them
  class BrowserWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: member ? { cookie: member.cookie } : {} });
    }
  }
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://localhost:${app.port}`, room, doc, {
    disableBc: true,
    maxBackoffTime: 100,
    WebSocketPolyfill: BrowserWebSocket as unknown as typeof globalThis.WebSocket,
    params: link ? { link } : {},
  });
  provider.awareness.setLocalStateField("user", { name: displayName });
  providers.push(provider);
  await waitFor(() => provider.synced, `${displayName} to sync`);
  return { doc, probe: doc.getText("probe") };
}

// the test's room, created as the dashboard does (owned by `owner`, if given)
function createRoom(owner?: Member) {
  return store.createRoom(room, {
    ownerId: owner?.id ?? null,
    title: "Test room",
    state: newRoomDocument(),
  });
}

// how the server closes a plain connection to the room (with a member's cookie and a link code)
function closeCode(member?: Member, link?: string): Promise<number> {
  const query = link ? `?link=${encodeURIComponent(link)}` : "";
  const socket = new WebSocket(`ws://localhost:${app.port}/${room}${query}`, {
    headers: member ? { cookie: member.cookie } : {},
  });
  return new Promise((resolve) => socket.on("close", (code) => resolve(code)));
}

// the saved changes, once they include one matching `which` (writes wait up to half a second)
async function savedChange(
  which: (change: { author: string | null; authorId: string | null }) => boolean,
) {
  let found: { author: string | null; authorId: string | null } | undefined;
  await waitFor(
    async () => {
      found = (await store.history(room)).find(which);
      return found !== undefined;
    },
    "the change to be saved",
    2000,
  );
  return found;
}

describe("who connects", () => {
  it("never creates a room when someone opens a new address, even a member", async () => {
    const alice = await signUp("Alice");

    expect(await closeCode(alice)).toBe(4404); // rooms are created from the dashboard
    expect(await store.load(room)).toBeNull();
  });

  it("turns away a guest who opens a room that doesn't exist, and creates nothing", async () => {
    expect(await closeCode()).toBe(4404); // 44xx: clients don't retry
    expect(await store.load(room)).toBeNull();
  });

  it("lets the owner in, and turns away anyone without access: a member or a guest", async () => {
    const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
    await createRoom(alice);

    await join("Alice", alice);

    expect(await closeCode(bob)).toBe(4403); // 44xx: clients don't retry
    expect(await closeCode()).toBe(4403);
  });

  it("lets a guest with a share link in, to edit", async () => {
    const alice = await signUp("Alice");
    await createRoom(alice);
    const link = (await store.shareLink(room, alice.id, "editor")) ?? "";
    const owner = await join("Alice", alice);

    const guest = await join("Gus", undefined, link);
    guest.probe.insert(0, "from the guest");

    await waitFor(() => owner.probe.toString() === "from the guest", "alice to see it");
  });

  it("remembers a signed-in person who joined by link: the address alone works next time", async () => {
    const [alice, bob] = [await signUp("Alice"), await signUp("Bob")];
    await createRoom(alice);
    const link = (await store.shareLink(room, alice.id, "editor")) ?? "";
    await join("Bob", bob, link);

    await join("Bob", bob); // no link this time
  });

  it("refuses a made-up link, and a link to another room", async () => {
    const alice = await signUp("Alice");
    const otherRoom = `room-${crypto.randomUUID()}`;
    await store.createRoom(otherRoom, {
      ownerId: alice.id,
      title: "Other",
      state: newRoomDocument(),
    });
    await createRoom(alice);
    const otherLink = (await store.shareLink(otherRoom, alice.id, "editor")) ?? "";

    expect(await closeCode(undefined, "made-up-code")).toBe(4403);
    expect(await closeCode(undefined, otherLink)).toBe(4403);
  });

  it("saves a member's changes under their account, whatever name their browser shows", async () => {
    const alice = await signUp("Alice Account");
    await createRoom(alice);
    const browser = await join("Not Alice", alice);

    browser.probe.insert(0, "by alice");

    const change = await savedChange((c) => c.authorId !== null);
    expect(change).toEqual(
      expect.objectContaining({ authorId: alice.id, author: "Alice Account" }),
    );
  });

  it("saves a guest's changes under the name they show", async () => {
    await createRoom();
    const guest = await join("Guest Gus");

    guest.probe.insert(0, "by a guest");

    const change = await savedChange((c) => c.author === "Guest Gus");
    expect(change?.authorId).toBeNull();
  });

  it("keeps at most 64 characters of a guest's name", async () => {
    await createRoom();
    const guest = await join("x".repeat(100));

    guest.probe.insert(0, "by a long name");

    const change = await savedChange((c) => c.author?.startsWith("xxx") ?? false);
    expect(change?.author).toBe("x".repeat(64));
  });

  it("treats a signed-out session as a guest", async () => {
    const alice = await signUp("Alice Account");
    await createRoom(); // from before owners: open to anyone, so the guest gets in
    await fetch(`http://localhost:${app.port}/api/auth/sign-out`, {
      method: "POST",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: alice.cookie },
      body: "{}",
    });
    const browser = await join("Alice Shown", alice); // the old cookie no longer works

    browser.probe.insert(0, "after signing out");

    const change = await savedChange((c) => c.author === "Alice Shown");
    expect(change?.authorId).toBeNull();
  });

  // two loads of one room at once would make two copies of it, splitting the people in it
  it("puts two members who open a room at the same moment in the same room", async () => {
    const [alice, bob] = await Promise.all([signUp("Alice"), signUp("Bob")]);
    await createRoom(); // open to both

    const [hers, his] = await Promise.all([join("Alice", alice), join("Bob", bob)]);

    const fileIds = (person: { doc: Y.Doc }) => [...person.doc.getMap("files").keys()];
    expect(fileIds(hers)).toHaveLength(1);
    expect(fileIds(his)).toEqual(fileIds(hers));
    hers.probe.insert(0, "same room");
    await waitFor(() => his.probe.toString() === "same room", "bob to see alice's change");
  });
});
