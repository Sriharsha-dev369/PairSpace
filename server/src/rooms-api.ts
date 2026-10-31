import { Hono } from "hono";
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

interface Options {
  auth: Auth;
  store: PostgresRoomStore;
  webOrigin: string;
  dropRoom(id: string): Promise<void>; // disconnect everyone in a deleted room
}

// the dashboard's API: a member's own rooms, at /api/rooms
export function roomsApi({ auth, store, webOrigin, dropRoom }: Options) {
  const api = new Hono<{ Variables: { memberId: string } }>();

  api.use("*", async (c, next) => {
    // another site can make a signed-in browser send requests here; its origin gives it away
    if (c.req.method !== "GET" && c.req.header("origin") !== webOrigin) {
      return c.json({ error: "requests must come from the PairSpace app" }, 403);
    }
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "sign in first" }, 401);
    c.set("memberId", session.user.id);
    await next();
  });

  api.get("/", async (c) => c.json(await store.listRooms(c.get("memberId"))));

  api.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const title = body.title === undefined ? "Untitled room" : readTitle(body.title);
    if (title === null) return c.json({ error: `a name is 1 to ${MAX_TITLE} characters` }, 400);
    const id = newRoomId();
    await store.createRoom(id, { ownerId: c.get("memberId"), title, state: newRoomDocument() });
    return c.json({ id, title }, 201);
  });

  // someone else's room answers like a missing one, so ids can't be probed
  api.patch("/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const title = readTitle(body.title);
    if (title === null) return c.json({ error: `a name is 1 to ${MAX_TITLE} characters` }, 400);
    const id = c.req.param("id");
    if (!(await store.renameRoom(id, c.get("memberId"), title))) return c.notFound();
    return c.json({ id, title });
  });

  api.delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await store.deleteRoom(id, c.get("memberId")))) return c.notFound();
    await dropRoom(id); // after the delete: a write still in flight now fails instead of recreating it
    return c.body(null, 204);
  });

  return api;
}
