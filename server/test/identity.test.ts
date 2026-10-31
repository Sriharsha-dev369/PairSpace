// Spec for who's who on the room server: members by their session cookie, everyone else a guest.
// Runs the real app (Better Auth + Postgres); members are real sign-ups, rooms are fresh per test.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { type App, startApp } from "../src/app";
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

// a Yjs client as the browser runs it, showing `displayName`; members also send their cookie
async function join(displayName: string, member?: Member) {
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
  });
  provider.awareness.setLocalStateField("user", { name: displayName });
  providers.push(provider);
  await waitFor(() => provider.synced, `${displayName} to sync`);
  return { doc, probe: doc.getText("probe") };
}

// how the server closes a plain connection to the room (with a member's cookie, if given)
function closeCode(member?: Member): Promise<number> {
  const socket = new WebSocket(`ws://localhost:${app.port}/${room}`, {
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
  it("lets a member create a room", async () => {
    const alice = await signUp("Alice");

    await join("Alice", alice);

    expect(await store.load(room)).not.toBeNull();
  });

  it("turns away a guest who opens a room that doesn't exist, and creates nothing", async () => {
    expect(await closeCode()).toBe(4404); // 44xx: clients don't retry
    expect(await store.load(room)).toBeNull();
  });

  it("lets a guest join a room that exists", async () => {
    const alice = await join("Alice", await signUp("Alice"));
    alice.probe.insert(0, "made by a member");

    const guest = await join("Gus");

    await waitFor(() => guest.probe.toString() === "made by a member", "the guest to see it");
  });

  it("saves a member's changes under their account, whatever name their browser shows", async () => {
    const alice = await signUp("Alice Account");
    const browser = await join("Not Alice", alice);

    browser.probe.insert(0, "by alice");

    const change = await savedChange((c) => c.authorId !== null);
    expect(change).toEqual(
      expect.objectContaining({ authorId: alice.id, author: "Alice Account" }),
    );
  });

  it("saves a guest's changes under the name they show", async () => {
    await join("Alice", await signUp("Alice"));
    const guest = await join("Guest Gus");

    guest.probe.insert(0, "by a guest");

    const change = await savedChange((c) => c.author === "Guest Gus");
    expect(change?.authorId).toBeNull();
  });

  it("keeps at most 64 characters of a guest's name", async () => {
    await join("Alice", await signUp("Alice"));
    const guest = await join("x".repeat(100));

    guest.probe.insert(0, "by a long name");

    const change = await savedChange((c) => c.author?.startsWith("xxx") ?? false);
    expect(change?.author).toBe("x".repeat(64));
  });

  it("treats a signed-out session as a guest", async () => {
    const alice = await signUp("Alice");
    await fetch(`http://localhost:${app.port}/api/auth/sign-out`, {
      method: "POST",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: alice.cookie },
      body: "{}",
    });

    expect(await closeCode(alice)).toBe(4404);
  });

  it("puts two members who open a new room at the same moment in the same room", async () => {
    const [alice, bob] = await Promise.all([signUp("Alice"), signUp("Bob")]);

    const [hers, his] = await Promise.all([join("Alice", alice), join("Bob", bob)]);

    const fileIds = (person: { doc: Y.Doc }) => [...person.doc.getMap("files").keys()];
    expect(fileIds(hers)).toHaveLength(1);
    expect(fileIds(his)).toEqual(fileIds(hers));
    hers.probe.insert(0, "same room");
    await waitFor(() => his.probe.toString() === "same room", "bob to see alice's change");
  });
});
