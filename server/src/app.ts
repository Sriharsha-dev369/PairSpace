import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { fromNodeHeaders } from "better-auth/node";
import { Hono } from "hono";
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
  github?: GitHubApp;
  log?: (line: string) => void;
}

// the whole server on one port: the accounts API over HTTP, live rooms over WebSockets
export async function startApp({
  port,
  databaseUrl = DATABASE_URL,
  webOrigin = WEB_ORIGIN,
  github,
  log,
}: Options): Promise<App> {
  const { auth, close: closeAuth } = createAuth({ databaseUrl, webOrigin, github });
  const store = openRoomStore(databaseUrl);

  let sync: SyncServer | undefined; // attached once the HTTP server is listening
  const api = new Hono();
  api.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  // which sign-in buttons the page should show
  api.get("/api/sign-in-methods", (c) => c.json({ github: github !== undefined }));
  api.route(
    "/api/rooms",
    roomsApi({ auth, store, webOrigin, dropRoom: async (id) => sync?.dropRoom(id) }),
  );
  api.route("/api/links", linksApi(store));

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
      return { member, role: access.role };
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
