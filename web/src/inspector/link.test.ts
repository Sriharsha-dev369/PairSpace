// Spec for the simulated link: the bad network a visitor can switch on in the sync inspector, to
// watch the copies still converge. Real Yjs clients, real sync server.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { type Client, useSyncServer } from "../testing/syncServer";
import { sleep, waitFor } from "../testing/wait";
import { simulatedLink } from "./link";
import { watchSync } from "./probe";

describe("simulated link", () => {
  const { connect, later, url, letInAfter } = useSyncServer();

  function watch(client: Client) {
    const probe = watchSync(client.provider, { pingEveryMs: 20, afterChangeMs: 5 });
    later(() => probe.stop());
    return probe;
  }

  const type = (client: Client, text: string) => client.doc.getText("t").insert(0, text);
  const text = (client: Client) => client.doc.getText("t").toString();
  const converged = (a: Client, b: Client) =>
    Y.encodeStateVector(a.doc).toString() === Y.encodeStateVector(b.doc).toString();

  it("holds every message for the delay, each way, and never lets one overtake another", async () => {
    const link = simulatedLink({ shapes: { slow: { delayMs: 100, jitterMs: 100 } } });
    link.set("slow");
    const socket = new link.WebSocket(`${url()}/room1`);
    later(() => socket.close());
    socket.binaryType = "arraybuffer";
    const pongs: number[] = [];
    let firstPongAt = 0;
    socket.onmessage = (event) => {
      const [type, n] = new Uint8Array(event.data as ArrayBuffer);
      if (type !== 101) return;
      pongs.push(n);
      firstPongAt ||= Date.now();
    };
    await new Promise((open) => {
      socket.onopen = open;
    });

    const sentAt = Date.now();
    for (let n = 1; n <= 20; n++) socket.send(new Uint8Array([100, n])); // pings 1 to 20

    await waitFor(() => pongs.length === 20, "every pong", 3000);
    expect(pongs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(firstPongAt - sentAt).toBeGreaterThanOrEqual(200); // 100 there, 100 back
  });

  it("on a slow link, a change waits for the whole round trip before it's confirmed", async () => {
    const link = simulatedLink({ shapes: { slow: { delayMs: 100, jitterMs: 0 } } });
    const alice = await connect({ WebSocket: link.WebSocket });
    const probe = watch(alice);
    link.set("slow");

    const typedAt = Date.now();
    type(alice, "a");
    await waitFor(() => probe.stats().waiting === 0, "the change to be confirmed");

    expect(Date.now() - typedAt).toBeGreaterThanOrEqual(200);
    expect(probe.stats().roundTrips.at(-1)?.ms).toBeGreaterThanOrEqual(200);
  });

  // after a reconnect, our changes leave in the reply to the server's sync step 1. A ping sent
  // before that, while the server is still letting us in, would be answered right after step 1,
  // ahead of those changes: it would claim changes the server doesn't have yet
  it("confirms changes made offline only once the server has them, even when it's slow to let us in", async () => {
    const link = simulatedLink({ shapes: { slow: { delayMs: 100, jitterMs: 0 } } });
    const alice = await connect({ WebSocket: link.WebSocket });
    const probe = watch(alice);
    const bob = await connect(); // straight to the server: he gets what it gets, at once
    link.set("slow");
    letInAfter(150); // in the app: checking who's connecting, maybe loading the room

    alice.provider.disconnect();
    type(alice, "offline");
    alice.provider.connect();
    await waitFor(() => probe.stats().waiting === 0, "alice's change to be confirmed", 2000);

    expect(text(bob)).toBe("offline");
  });

  it("a flaky link drops the connection again and again, and the copies still converge", async () => {
    const link = simulatedLink({
      shapes: { flaky: { delayMs: 5, jitterMs: 10, dropsEveryMs: [40, 80] } },
    });
    const alice = await connect({ WebSocket: link.WebSocket });
    const probe = watch(alice);
    const bob = await connect();
    let drops = 0;
    alice.provider.on("connection-close", () => drops++);

    link.set("flaky");
    let typed = "";
    for (let i = 0; i < 30; i++) {
      type(alice, `a${i}`);
      type(bob, `b${i}`);
      typed += `a${i}b${i}`;
      await sleep(10);
    }
    await waitFor(() => drops >= 2, "the link to drop twice");
    link.set("normal");

    await waitFor(
      () => converged(alice, bob) && probe.stats().waiting === 0,
      "both copies to converge",
      3000,
    );
    expect(text(alice)).toBe(text(bob));
    expect(text(alice)).toHaveLength(typed.length); // nothing lost

    // and back to normal, it stops dropping
    const dropped = drops;
    const answered = probe.stats().roundTrips.length;
    await waitFor(() => probe.stats().roundTrips.length >= answered + 8, "eight more round trips");
    expect(drops).toBe(dropped);
  });
});
