import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Auth } from "./auth";
import { newRoomDocument } from "./room-document";
import { newRoomId } from "./room-id";
import type { PostgresRoomStore } from "./room-store";

const MAX_TITLE = 80;

// a title from the browser: text, trimmed, 1 to 80 characters; null if it isn't one
function readTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title.length > 0 && title.length <= MAX_TITLE ? title : null;
}

type Variables = { memberId: string | null }; // null: not signed in

// who's asking, and that the request comes from our own app
function checkRequest(auth: Auth, webOrigin: string) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    // another site can make a signed-in browser send requests here; its origin gives it away
    if (c.req.method !== "GET" && c.req.header("origin") !== webOrigin) {
      return c.json({ error: "requests must come from the PairSpace app" }, 403);
    }
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set("memberId", session?.user.id ?? null);
    await next();
  });
}

const signInFirst = { error: "sign in first" };

interface Options {
  auth: Auth;
  store: PostgresRoomStore;
  webOrigin: string;
  dropRoom(id: string): Promise<void>; // disconnect everyone in a deleted room
}

// the dashboard's API, at /api/rooms: a member's own rooms and the ones shared with them
export function roomsApi({ auth, store, webOrigin, dropRoom }: Options) {
  const api = new Hono<{ Variables: Variables }>();
  api.use("*", checkRequest(auth, webOrigin));

  api.get("/", async (c) => {
    const me = c.get("memberId");
    if (!me) return c.json(signInFirst, 401);
    return c.json(await store.listRooms(me));
  });

  // a room's title and my role, for anyone who may enter it (guests show their link)
  api.get("/:id", async (c) => {
    const id = c.req.param("id");
    const access = await store.access(id, {
      userId: c.get("memberId"),
      linkCode: c.req.query("link") ?? null,
    });
    if (access === "no-room" || access === "no-access") return c.notFound();
    return c.json({ id, title: access.title, role: access.role });
  });

  // the room's share link for editors (the same each time), for its owner
  api.post("/:id/links", async (c) => {
    const me = c.get("memberId");
    if (!me) return c.json(signInFirst, 401);
    const body = await c.req.json().catch(() => ({}));
    if (body.role !== "editor") return c.json({ error: "role must be editor" }, 400);
    const code = await store.shareLink(c.req.param("id"), me, "editor");
    return code ? c.json({ code, role: "editor" }) : c.notFound();
  });

  api.post("/", async (c) => {
    const me = c.get("memberId");
    if (!me) return c.json(signInFirst, 401);
    const body = await c.req.json().catch(() => ({}));
    const title = body.title === undefined ? "Untitled room" : readTitle(body.title);
    if (title === null) return c.json({ error: `a name is 1 to ${MAX_TITLE} characters` }, 400);
    const id = newRoomId();
    await store.createRoom(id, { ownerId: me, title, state: newRoomDocument() });
    return c.json({ id, title }, 201);
  });

  // someone else's room answers like a missing one, so ids can't be probed
  api.patch("/:id", async (c) => {
    const me = c.get("memberId");
    if (!me) return c.json(signInFirst, 401);
    const body = await c.req.json().catch(() => ({}));
    const title = readTitle(body.title);
    if (title === null) return c.json({ error: `a name is 1 to ${MAX_TITLE} characters` }, 400);
    const id = c.req.param("id");
    if (!(await store.renameRoom(id, me, title))) return c.notFound();
    return c.json({ id, title });
  });

  api.delete("/:id", async (c) => {
    const me = c.get("memberId");
    if (!me) return c.json(signInFirst, 401);
    const id = c.req.param("id");
    if (!(await store.deleteRoom(id, me))) return c.notFound();
    await dropRoom(id); // after the delete: a write still in flight now fails instead of recreating it
    return c.body(null, 204);
  });

  return api;
}

// what a share link opens, at /api/links/:code: public, since the code itself is the secret
export function linksApi(store: PostgresRoomStore) {
  const api = new Hono();
  api.get("/:code", async (c) => {
    const link = await store.findLink(c.req.param("code"));
    return link ? c.json(link) : c.notFound();
  });
  return api;
}
