import { useEffect, useMemo, useState } from "react";
import type { RoomSession } from "../room/session";
import { createRunner } from "./runner";
import { currentRun, type RunView } from "./runState";

// how long a program may run; e2e tests set a shorter limit
const TIME_LIMIT_MS = Number(import.meta.env.VITE_RUN_TIME_LIMIT_MS ?? 10_000);

// this browser's runner for the room; a program it's running stops when the room page closes
export function useRunner(session: RoomSession) {
  const runner = useMemo(
    () =>
      createRunner({
        doc: session.doc,
        me: { name: session.me.name, color: session.me.color },
        clientId: session.awareness.clientID,
        present: () => new Set(session.awareness.getStates().keys()),
        timeLimitMs: TIME_LIMIT_MS,
      }),
    [session],
  );
  useEffect(() => () => runner.dispose(), [runner]);
  return runner;
}

// the room's run, kept current as it changes; only what shows the run re-renders as output arrives
export function useCurrentRun(session: RoomSession): RunView | null {
  const [run, setRun] = useState(() => currentRun(session.doc));
  useEffect(() => {
    const runs = session.doc.getMap("run");
    const update = () => setRun(currentRun(session.doc));
    update();
    runs.observeDeep(update);
    return () => runs.unobserveDeep(update);
  }, [session]);
  return run;
}
