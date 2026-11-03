import { type Context, Hono } from "hono";
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

const BAD_TITLE = { error: `a name is 1 to ${MAX_TITLE} characters` };

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

// for members only: `me` is their user id
const membersOnly = createMiddleware<{ Variables: Variables & { me: string } }>(async (c, next) => {
  const me = c.get("memberId");
  if (!me) return c.json({ error: "sign in first" }, 401);
  c.set("me", me);
  await next();
});

// the request's JSON body, which must be an object; its fields are checked by each route
const jsonObject = createMiddleware<{ Variables: { body: Record<string, unknown> } }>(
  async (c, next) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "send a JSON object" }, 400);
    }
    c.set("body", body as Record<string, unknown>);
    await next();
  },
);

interface Options {
  auth: Auth;
  store: PostgresRoomStore;
  webOrigin: string;
  dropRoom(id: string): Promise<void>; // disconnect everyone in a deleted room
  revokeAccess(id: string, code: string): void; // cut off everyone who came in through a link
}

// the dashboard's API, at /api/rooms: a member's own rooms and the ones shared with them
export function roomsApi({ auth, store, webOrigin, dropRoom, revokeAccess }: Options) {
  const api = new Hono<{ Variables: Variables }>();
  api.use("*", checkRequest(auth, webOrigin));

  api.get("/", membersOnly, async (c) => c.json(await store.listRooms(c.get("me"))));

  // what the person asking may do in the room: as a member, or through the link they show (guests)
  const accessOf = (c: Context<{ Variables: Variables }>, id: string) =>
    store.access(id, { userId: c.get("memberId"), linkCode: c.req.query("link") ?? null });

  // a room's title and my role, for anyone who may enter it
  api.get("/:id", async (c) => {
    const id = c.req.param("id");
    const access = await accessOf(c, id);
    if (access === "no-room" || access === "no-access") return c.notFound();
    return c.json({ id, title: access.title, role: access.role });
  });

  // every saved change, oldest first, for replay: only for people who can edit, since it shows
  // text that was later deleted
  api.get("/:id/history", async (c) => {
    const id = c.req.param("id");
    const access = await accessOf(c, id);
    if (access === "no-room" || access === "no-access") return c.notFound();
    if (access.role === "viewer")
      return c.json({ error: "replay is for people who can edit" }, 403);
    const history = await store.history(id);
    return c.json(
      history.map(({ update, author, authorId, at }) => ({
        at,
        author,
        authorId,
        update: Buffer.from(update).toString("base64"),
      })),
    );
  });

  // the room's share link for a role (the same each time until it's turned off), for its owner
  api.post("/:id/links", membersOnly, jsonObject, async (c) => {
    const { role } = c.get("body");
    if (role !== "editor" && role !== "viewer") {
      return c.json({ error: "role must be editor or viewer" }, 400);
    }
    const code = await store.shareLink(c.req.param("id"), c.get("me"), role);
    return code ? c.json({ code, role }) : c.notFound();
  });

  api.get("/:id/links", membersOnly, async (c) => {
    const links = await store.listLinks(c.req.param("id"), c.get("me"));
    return links ? c.json(links) : c.notFound();
  });

  // turning a link off cuts off everyone who came in through it, at once
  api.delete("/:id/links/:code", membersOnly, async (c) => {
    const { id, code } = c.req.param();
    if (!(await store.revokeLink(id, c.get("me"), code))) return c.notFound();
    revokeAccess(id, code);
    return c.body(null, 204);
  });

  api.post("/", membersOnly, jsonObject, async (c) => {
    const body = c.get("body");
    const title = body.title === undefined ? "Untitled room" : readTitle(body.title);
    if (title === null) return c.json(BAD_TITLE, 400);
    const id = newRoomId();
    await store.createRoom(id, { ownerId: c.get("me"), title, state: newRoomDocument() });
    return c.json({ id, title }, 201);
  });

  // someone else's room answers like a missing one, so ids can't be probed
  api.patch("/:id", membersOnly, jsonObject, async (c) => {
    const title = readTitle(c.get("body").title);
    if (title === null) return c.json(BAD_TITLE, 400);
    const id = c.req.param("id");
    if (!(await store.renameRoom(id, c.get("me"), title))) return c.notFound();
    return c.json({ id, title });
  });

  api.delete("/:id", membersOnly, async (c) => {
    const id = c.req.param("id");
    if (!(await store.deleteRoom(id, c.get("me")))) return c.notFound();
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
