// What a client can learn about its sync connection: the round trip to the server, and which of
// its own changes the server has confirmed. Plain TypeScript on a y-websocket provider (no DOM, no
// React), so benchmarks can watch many clients in Node with the same code.
//
// How: a numbered ping, which our sync server answers at once with a pong carrying the number. The
// time between them is the round trip. A connection keeps order, so a pong also confirms every
// change sent before its ping (the way TCP acknowledges bytes).

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import type { WebsocketProvider } from "y-websocket";

// message types the sync server knows (server/src/sync-server.ts); y-protocols uses 0-3
const MESSAGE_PING = 100;
const MESSAGE_PONG = 101;

const MINUTE = 60_000;

export interface RoundTrip {
  at: number; // when the answer came (ms since 1970)
  ms: number;
}

export interface SyncStats {
  roundTrips: RoundTrip[]; // the last minute's, oldest first
  waiting: number; // own changes the server hasn't confirmed yet
  lastConfirmedAt: number | null; // when the server last answered a ping
}

export interface SyncProbe {
  stats(): SyncStats;
  subscribe(listener: () => void): () => void; // called after each change and each answer
  stop(): void;
}

interface Options {
  pingEveryMs?: number; // keeps the round trip current while nothing changes
  afterChangeMs?: number; // a ping this long after a change (one for a burst of typing)
  now?: () => number;
}

export function watchSync(
  provider: WebsocketProvider,
  {
    pingEveryMs = 2000,
    afterChangeMs = 200,
    now = () => performance.timeOrigin + performance.now(), // like Date.now(), but never jumps
  }: Options = {},
): SyncProbe {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  let made = 0; // own changes so far
  let confirmed = 0; // how many of them the server has
  let next = 1;
  const unanswered = new Map<number, { sentAt: number; made: number }>();
  let roundTrips: RoundTrip[] = [];
  let lastConfirmedAt: number | null = null;

  // only once synced: before that, changes made offline haven't been sent yet (they go out in
  // our reply to the server's sync step 1, which comes before `synced`)
  function ping() {
    const socket = provider.ws;
    if (!provider.synced || !socket || socket.readyState !== socket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_PING);
    encoding.writeVarUint(encoder, next);
    unanswered.set(next++, { sentAt: now(), made });
    socket.send(encoding.toUint8Array(encoder));
  }

  provider.messageHandlers[MESSAGE_PONG] = (_reply, decoder) => {
    const number = decoding.readVarUint(decoder);
    const ping = unanswered.get(number);
    if (!ping) return;
    // earlier ones were lost with a dropped connection, or answered already
    for (const earlier of unanswered.keys()) if (earlier <= number) unanswered.delete(earlier);
    const at = now();
    confirmed = Math.max(confirmed, ping.made);
    roundTrips = [
      ...roundTrips.filter((trip) => trip.at > at - MINUTE),
      { at, ms: at - ping.sentAt },
    ];
    lastConfirmedAt = at;
    notify();
  };

  let soon: ReturnType<typeof setTimeout> | undefined;
  const onChange = (_update: Uint8Array, origin: unknown) => {
    if (origin === provider) return; // someone else's, from the server
    made++;
    notify();
    if (soon === undefined) {
      soon = setTimeout(() => {
        soon = undefined;
        ping();
      }, afterChangeMs);
    }
  };
  const onSync = (synced: boolean) => synced && ping();
  provider.doc.on("update", onChange);
  provider.on("sync", onSync);
  const every = setInterval(ping, pingEveryMs);

  return {
    stats: () => ({ roundTrips, waiting: made - confirmed, lastConfirmedAt }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => {
      clearInterval(every);
      clearTimeout(soon);
      provider.doc.off("update", onChange);
      provider.off("sync", onSync);
      delete provider.messageHandlers[MESSAGE_PONG];
    },
  };
}
