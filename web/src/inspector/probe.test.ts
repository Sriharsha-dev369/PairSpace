// Spec for the sync probe: what the sync inspector (and later, benchmarks) learn about a
// connection. Runs real Yjs clients against the real sync server on a random port.

import { describe, expect, it } from "vitest";
import { type Client, useSyncServer } from "../testing/syncServer";
import { waitFor } from "../testing/wait";
import { type SyncProbe, watchSync } from "./probe";

describe("sync probe", () => {
  const { connect, later } = useSyncServer();

  // pings often, so tests needn't wait the 2s a browser does
  function watch(client: Client, options: Parameters<typeof watchSync>[1] = {}): SyncProbe {
    const probe = watchSync(client.provider, { pingEveryMs: 20, afterChangeMs: 5, ...options });
    later(() => probe.stop());
    return probe;
  }

  const type = (client: Client, text: string) => client.doc.getText("t").insert(0, text);
  const text = (client: Client) => client.doc.getText("t").toString();

  it("counts each change as waiting until the server confirms it has it", async () => {
    const alice = await connect();
    const probe = watch(alice);

    type(alice, "a");
    type(alice, "b");
    expect(probe.stats().waiting).toBe(2);

    await waitFor(() => probe.stats().waiting === 0, "the server to confirm both changes");
    const bob = await connect();
    expect(text(bob)).toBe("ba");
  });

  it("keeps changes made while disconnected waiting until it's back, then confirms them at once", async () => {
    const alice = await connect();
    const probe = watch(alice, { pingEveryMs: 60_000 }); // only the ping on reconnect is in time
    const bob = await connect();
    const clock = watch(bob); // bob's pings keep being answered: proof that time passed

    alice.provider.disconnect();
    type(alice, "offline");
    const answered = clock.stats().roundTrips.length;
    await waitFor(() => clock.stats().roundTrips.length >= answered + 3, "a few of bob's pings");
    expect(probe.stats().waiting).toBe(1);

    alice.provider.connect();
    await waitFor(() => probe.stats().waiting === 0, "alice's change to be confirmed");
    const carol = await connect();
    expect(text(carol)).toBe("offline");
  });

  it("measures the round trip of each ping, and when the server last answered", async () => {
    const alice = await connect();
    const started = Date.now();
    const probe = watch(alice);

    await waitFor(() => probe.stats().roundTrips.length >= 3, "three round trips");

    const { roundTrips, lastConfirmedAt } = probe.stats();
    for (const trip of roundTrips) {
      expect(trip.ms).toBeGreaterThan(0);
      expect(trip.ms).toBeLessThan(500); // on one machine
      expect(trip.at).toBeGreaterThanOrEqual(started);
    }
    expect(lastConfirmedAt).toBe(roundTrips.at(-1)?.at);
  });

  it("keeps only the last minute of round trips", async () => {
    const alice = await connect();
    let later = 0;
    const probe = watch(alice, { now: () => Date.now() + later });
    await waitFor(() => probe.stats().roundTrips.length >= 2, "two round trips");

    later = 61_000;
    await waitFor(
      () => probe.stats().roundTrips.some((trip) => trip.at > Date.now() + 60_000),
      "a round trip a minute later",
    );

    expect(probe.stats().roundTrips.every((trip) => trip.at > Date.now() + 1000)).toBe(true);
  });
});
