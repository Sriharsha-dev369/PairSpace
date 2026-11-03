import { useEffect, useState } from "react";
import type { SyncProbe, SyncStats } from "./probe";

// re-renders after each own change and each answer from the server
export function useSyncStats(sync: Pick<SyncProbe, "stats" | "subscribe">): SyncStats {
  const [stats, setStats] = useState(() => sync.stats());

  useEffect(() => {
    setStats(sync.stats());
    return sync.subscribe(() => setStats(sync.stats()));
  }, [sync]);

  return stats;
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
