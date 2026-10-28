// A TCP proxy between one client and the sync server that misbehaves on command, to test what
// real networks do. TCP never loses, repeats or reorders bytes within a connection, so the
// realistic faults are delay, and whole connections dropping, going offline or freezing.

import net from "node:net";

export interface FaultyNetwork {
  url: string; // connect here instead of to the server
  delay(ms: number, jitterMs?: number): void; // each way; order is kept, as TCP keeps it
  cut(): void; // reset every open connection, like wifi dying
  offline(): void; // cut, and reset new connections until online()
  online(): void;
  freeze(): void; // deliver nothing more, not even a close, like a laptop gone to sleep
  close(): Promise<void>;
}

export function createFaultyNetwork(targetPort: number): Promise<FaultyNetwork> {
  const open = new Set<net.Socket>();
  let isOffline = false;
  let delayMs = 0;
  let jitterMs = 0;
  let frozen = false;

  // copy bytes one way, each held for the delay but never released before the one ahead of it;
  // a close travels the same way (null), after the data sent before it
  function relay(from: net.Socket, to: net.Socket) {
    const queue: { at: number; chunk: Buffer | null }[] = [];
    let timer: NodeJS.Timeout | undefined;

    const release = () => {
      timer = undefined;
      if (frozen) return;
      while (queue.length > 0 && queue[0].at <= Date.now()) {
        const { chunk } = queue.shift() as (typeof queue)[number];
        if (chunk === null) to.end();
        else if (!to.destroyed) to.write(chunk);
      }
      if (queue.length > 0) timer = setTimeout(release, queue[0].at - Date.now());
    };
    const send = (chunk: Buffer | null) => {
      if (frozen) return;
      const at = Math.max(queue.at(-1)?.at ?? 0, Date.now() + delayMs + Math.random() * jitterMs);
      queue.push({ at, chunk });
      if (timer === undefined) timer = setTimeout(release, at - Date.now());
    };

    open.add(from);
    from.on("error", () => {}); // resets are what this is for, not failures
    from.on("data", send);
    from.on("close", () => {
      open.delete(from);
      send(null);
    });
  }

  const proxy = net.createServer((client) => {
    if (isOffline) {
      client.resetAndDestroy();
      return;
    }
    const upstream = net.connect(targetPort, "localhost");
    relay(client, upstream);
    relay(upstream, client);
  });

  const cut = () => {
    for (const socket of open) if (!socket.destroyed) socket.resetAndDestroy();
  };

  return new Promise((resolve) => {
    proxy.listen(0, () => {
      const { port } = proxy.address() as net.AddressInfo;
      resolve({
        url: `ws://localhost:${port}`,
        delay: (ms, jitter = 0) => {
          delayMs = ms;
          jitterMs = jitter;
        },
        cut,
        offline: () => {
          isOffline = true;
          cut();
        },
        online: () => {
          isOffline = false;
        },
        freeze: () => {
          frozen = true;
        },
        close: () =>
          new Promise((done) => {
            cut();
            proxy.close(() => done());
          }),
      });
    });
  });
}
