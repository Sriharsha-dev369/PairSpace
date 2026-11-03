import { useEffect, useState } from "react";
import type { SessionSync } from "../room/session";
import type { Network } from "./link";
import type { SyncStats } from "./probe";

const read = (sync: SessionSync) => ({ ...sync.stats(), network: sync.network() });

// re-renders after each own change, each answer from the server, and a change of network
export function useSync(sync: SessionSync): SyncStats & { network: Network } {
  const [state, setState] = useState(() => read(sync));

  useEffect(() => {
    setState(read(sync));
    return sync.subscribe(() => setState(read(sync)));
  }, [sync]);

  return state;
}

// the time, every second: "3 s ago" has to keep counting while nothing else changes
export function useNow(): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  return now;
}
