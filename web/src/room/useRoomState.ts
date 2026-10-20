import { useEffect, useState } from "react";
import type { ConnectionStatus, Person, RoomSession } from "./session";

interface RoomState {
  status: ConnectionStatus;
  people: Person[];
}

const read = (session: RoomSession): RoomState => ({
  status: session.status(),
  people: session.people(),
});

// re-renders whenever the session reports a change in connection or presence
export function useRoomState(session: RoomSession): RoomState {
  const [state, setState] = useState(() => read(session));

  useEffect(() => {
    setState(read(session));
    return session.subscribe(() => setState(read(session)));
  }, [session]);

  return state;
}
