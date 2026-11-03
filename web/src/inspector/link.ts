// The bad network a visitor can switch on in the sync inspector, for this browser only: a
// WebSocket that y-websocket uses in place of the browser's (its WebSocketPolyfill option), and
// holds messages back or drops the connection on purpose.
//
// Like a real connection (TCP), it delays but never loses or reorders what it delivers: each
// direction is one queue, and an open, message or close never overtakes the one ahead of it.
// Offline isn't done here: the room session disconnects, exactly as when wifi goes.

import { type MessageLog, messageLog } from "./messages";

export type Network = "normal" | "slow" | "very-slow" | "flaky" | "offline";

export const NETWORKS: readonly Network[] = ["normal", "slow", "very-slow", "flaky", "offline"];

export interface Shape {
  delayMs: number; // each way
  jitterMs: number; // up to this much more, at random: an uneven link
  dropsEveryMs?: [number, number]; // drops the connection after a random time in this range
}

export const SHAPES: Record<Network, Shape> = {
  normal: { delayMs: 0, jitterMs: 0 },
  slow: { delayMs: 500, jitterMs: 0 },
  "very-slow": { delayMs: 1500, jitterMs: 1000 },
  flaky: { delayMs: 50, jitterMs: 100, dropsEveryMs: [2000, 5000] },
  offline: { delayMs: 0, jitterMs: 0 },
};

const SIMULATED_DROP = 4000; // a close code y-websocket reconnects after (4000-4999 are ours)

export interface SimulatedLink {
  WebSocket: typeof WebSocket; // for y-websocket's WebSocketPolyfill
  network(): Network;
  set(network: Network): void;
  subscribe(listener: () => void): () => void; // a change of network
  messages(): MessageLog; // what crossed it, either way (sent when the app sent it, received when delivered)
  watchMessages(listener: () => void): () => void;
  stop(): void; // no more drops (a flaky link's timer would otherwise run on)
}

// one direction: each delivery waits for the delay, but never longer than the one ahead of it.
// Timed in fractions of a millisecond, like the round trips the probe measures
function lane(delay: () => number) {
  const now = () => performance.now();
  const queue: { at: number; deliver: () => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const release = () => {
    timer = undefined;
    try {
      while (queue.length > 0 && queue[0].at <= now()) queue.shift()?.deliver();
    } finally {
      if (queue.length > 0 && timer === undefined) {
        timer = setTimeout(release, queue[0].at - now());
      }
    }
  };

  return (deliver: () => void) => {
    const ms = delay();
    if (ms === 0 && queue.length === 0) return deliver(); // a normal link: no detour at all
    const at = Math.max(queue.at(-1)?.at ?? 0, now() + ms);
    queue.push({ at, deliver });
    if (timer === undefined) timer = setTimeout(release, at - now());
  };
}

export function simulatedLink({
  Base = globalThis.WebSocket,
  shapes = {},
}: {
  Base?: typeof WebSocket;
  shapes?: Partial<Record<Network, Shape>>; // tests use shorter ones
} = {}): SimulatedLink {
  let network: Network = "normal";
  const shape = () => shapes[network] ?? SHAPES[network];
  const delay = () => shape().delayMs + Math.random() * shape().jitterMs;
  const open = new Set<WebSocket>(); // the real sockets, to drop
  const listeners = new Set<() => void>();
  const log = messageLog();

  // while flaky, drop every open connection after a while, again and again
  let drops: ReturnType<typeof setTimeout> | undefined;
  function scheduleDrop() {
    clearTimeout(drops);
    const range = shape().dropsEveryMs;
    if (!range) return;
    const [min, max] = range;
    drops = setTimeout(
      () => {
        for (const socket of open) socket.close(SIMULATED_DROP, "simulated drop");
        scheduleDrop();
      },
      min + Math.random() * (max - min),
    );
  }

  class LinkSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    binaryType = "arraybuffer"; // always: the real socket is set to it
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    readonly #socket: WebSocket;
    readonly #out = lane(delay);

    constructor(url: string | URL, protocols?: string | string[]) {
      const socket = new Base(url, protocols);
      socket.binaryType = "arraybuffer";
      const arrive = lane(delay);
      socket.onopen = (event) => arrive(() => this.onopen?.(event));
      socket.onmessage = (event) =>
        arrive(() => {
          log.record("in", event.data);
          this.onmessage?.(event);
        });
      socket.onerror = (event) => arrive(() => this.onerror?.(event));
      socket.onclose = (event) => {
        open.delete(socket);
        arrive(() => this.onclose?.(event));
      };
      open.add(socket);
      this.#socket = socket;
    }

    get readyState() {
      return this.#socket.readyState;
    }

    send(data: Uint8Array<ArrayBuffer> | ArrayBuffer | string) {
      log.record("out", data);
      // a message still on its way when the connection drops is lost with it, as on a real one
      this.#out(() => this.#socket.readyState === this.OPEN && this.#socket.send(data));
    }

    close(code?: number, reason?: string) {
      this.#socket.close(code, reason);
    }
  }

  return {
    WebSocket: LinkSocket as unknown as typeof WebSocket,
    network: () => network,
    set: (next) => {
      network = next;
      scheduleDrop();
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    messages: log.snapshot,
    watchMessages: log.subscribe,
    stop: () => clearTimeout(drops),
  };
}
