import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fromNodeHeaders } from "better-auth/node";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createAuth, type GitHubApp } from "./auth";
import { DATABASE_URL } from "./db";
import { openRoomStore } from "./room-store";
import { linksApi, roomsApi } from "./rooms-api";
import { createSyncServer, type SyncServer } from "./sync-server";

// where the web app runs in development (Vite); deployments set WEB_ORIGIN
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

export interface App {
  port: number;
  close(): Promise<void>;
}

interface Options {
  port: number; // 0 = let the OS pick a free port (used by tests)
  databaseUrl?: string;
  webOrigin?: string;
  webDir?: string; // the built web app (production); without it, Vite serves the app
  github?: GitHubApp;
  log?: (line: string) => void;
}

// files named by their content (Vite's assets/index-a1B2c3D4.js): a new version is a new name
const FOREVER = "public, max-age=31536000, immutable";

// the built web app on this server's own origin: its files, and its page for every address the
// app's router handles. Never for /api, nor for a missing file (an old deploy's bundle)
function serveWebApp(api: Hono, webDir: string) {
  const root = resolve(webDir);
  const cache = (path: string) => (path.includes("/assets/") ? FOREVER : "no-cache");
  api.use("*", serveStatic({ root, onFound: (path, c) => c.header("Cache-Control", cache(path)) }));
  api.get("*", async (c, next) => {
    const { pathname } = new URL(c.req.url);
    if (pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(pathname)) return next();
    return serveStatic({
      root,
      path: "index.html",
      onFound: (_path, c) => c.header("Cache-Control", "no-cache"),
    })(c, next);
  });
}

// the whole server on one port: the accounts API over HTTP, live rooms over WebSockets
export async function startApp({
  port,
  databaseUrl = DATABASE_URL,
  webOrigin = WEB_ORIGIN,
  webDir,
  github,
  log,
}: Options): Promise<App> {
  const { auth, close: closeAuth } = createAuth({ databaseUrl, webOrigin, github });
  const store = openRoomStore(databaseUrl);

  let sync: SyncServer | undefined; // attached once the HTTP server is listening
  const api = new Hono();
  // the standard set, but not Cross-Origin-Resource-Policy: Run's sandbox page has an opaque
  // origin (another site, to the browser), and it must still load its script from us
  api.use("*", secureHeaders({ crossOriginResourcePolicy: false }));
  // for the host's health checks: up only if the database answers
  api.get("/api/health", async (c) => {
    try {
      await store.ping();
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });
  api.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  // which sign-in buttons the page should show
  api.get("/api/sign-in-methods", (c) => c.json({ github: github !== undefined }));
  api.route(
    "/api/rooms",
    roomsApi({
      auth,
      store,
      webOrigin,
      dropRoom: async (id) => sync?.dropRoom(id),
      revokeAccess: (id, code) => sync?.revokeAccess(id, code),
    }),
  );
  api.route("/api/links", linksApi(store));
  if (webDir) serveWebApp(api, webDir);

  const http = await new Promise<Server>((resolve) => {
    const server = serve({ fetch: api.fetch, port }, () => resolve(server as Server));
  });
  // WebSocket upgrade requests arrive on the same server, carrying the session cookie
  sync = await createSyncServer({
    server: http,
    store,
    log,
    // who's connecting (session cookie), and through which share link (?link=) if any
    admit: async (request, room) => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      const member = session && { id: session.user.id, name: session.user.name };
      const linkCode = new URL(request.url ?? "/", "http://localhost").searchParams.get("link");
      const access = await store.access(room, { userId: member?.id ?? null, linkCode });
      if (access === "no-room" || access === "no-access") return { refused: access };
      // a signed-in person who came in by link is remembered: next time the address is enough
      if (member && linkCode && access.role !== "owner") {
        const link = await store.findLink(linkCode);
        if (link?.roomId === room) await store.addMember(room, member.id, link.role, linkCode);
      }
      return { member, role: access.role, via: access.via };
    },
  });

  return {
    port: (http.address() as AddressInfo).port,
    close: async () => {
      await sync.close(); // writes everything rooms still hold
      http.closeAllConnections();
      await new Promise((done) => http.close(done));
      await store.close();
      await closeAuth();
    },
  };
}
