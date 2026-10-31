import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createAuth } from "./auth";
import { DATABASE_URL } from "./db";
import { openRoomStore } from "./room-store";
import { createSyncServer } from "./sync-server";

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
  log?: (line: string) => void;
}

// the whole server on one port: the accounts API over HTTP, live rooms over WebSockets
export async function startApp({
  port,
  databaseUrl = DATABASE_URL,
  webOrigin = WEB_ORIGIN,
  log,
}: Options): Promise<App> {
  const { auth, close: closeAuth } = createAuth({ databaseUrl, webOrigin });
  const store = openRoomStore(databaseUrl);

  const api = new Hono();
  api.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  const http = await new Promise<Server>((resolve) => {
    const server = serve({ fetch: api.fetch, port }, () => resolve(server as Server));
  });
  // WebSocket upgrade requests arrive on the same server, carrying the session cookie
  const sync = await createSyncServer({ server: http, store, log });

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
