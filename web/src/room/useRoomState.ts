import { useEffect, useState } from "react";
import type { RoomFile, TrashedFile } from "./files";
import type { ConnectionStatus, Person, RoomSession } from "./session";

interface RoomState {
  status: ConnectionStatus;
  people: Person[];
  unsyncedEdits: boolean;
  files: RoomFile[];
  trash: TrashedFile[];
}

const read = (session: RoomSession): RoomState => ({
  status: session.status(),
  people: session.people(),
  unsyncedEdits: session.unsyncedEdits(),
  files: session.files(),
  trash: session.trash(),
});

// re-renders whenever the session reports a change in connection, presence or files (or trash)
export function useRoomState(session: RoomSession): RoomState {
  const [state, setState] = useState(() => read(session));

  useEffect(() => {
    setState(read(session));
    return session.subscribe(() => setState(read(session)));
  }, [session]);

  return state;
}
