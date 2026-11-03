// A real sync server for each test, on a random port, and Yjs clients connected to it the way the
// browser connects (optionally through a simulated link). Everything is closed after each test.

import { createSyncServer, type SyncServer } from "pairspace-server";
import { afterEach, beforeEach } from "vitest";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { sleep, waitFor } from "./wait";

export interface Client {
  doc: Y.Doc;
  provider: WebsocketProvider;
}

export function useSyncServer({ heartbeatMs }: { heartbeatMs?: number } = {}) {
  let server: SyncServer;
  let cleanups: (() => void)[] = [];
  let admitMs = 0;

  beforeEach(async () => {
    admitMs = 0;
    // everyone gets in as a guest editor, after admitMs (in the app: checking who they are)
    server = await createSyncServer({
      port: 0,
      heartbeatMs,
      admit: async () => {
        if (admitMs > 0) await sleep(admitMs);
        return { member: null, role: "editor" };
      },
    });
    cleanups = [];
  });

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) cleanup();
    await server.close();
  });

  return {
    url: () => `ws://localhost:${server.port}`,
    // from now on, the server takes this long to let each new connection in
    letInAfter: (ms: number) => {
      admitMs = ms;
    },
    // runs after the test, before the server closes (last added, first run)
    later: (cleanup: () => void) => cleanups.push(cleanup),
    async connect({
      WebSocket,
    }: {
      WebSocket?: typeof globalThis.WebSocket;
    } = {}): Promise<Client> {
      const doc = new Y.Doc();
      const provider = new WebsocketProvider(`ws://localhost:${server.port}`, "room1", doc, {
        disableBc: true, // in one process, BroadcastChannel would sync clients past the server
        maxBackoffTime: 100,
        WebSocketPolyfill: WebSocket,
      });
      cleanups.push(() => provider.destroy());
      await waitFor(() => provider.synced, "the client to sync");
      return { doc, provider };
    },
  };
}
