import { useEffect, useState } from "react";
import { joinRoom, RoomRefused, type RoomSession, type User } from "./session";

const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:8080";

export type RoomJoin =
  | { state: "connecting" }
  | { state: "ready"; session: RoomSession }
  | { state: "refused"; code: number }; // the server won't let us in (see RoomRefused)

// joins the room for as long as the component is mounted
export function useRoomSession(roomId: string, user: User, link?: string): RoomJoin {
  const [join, setJoin] = useState<RoomJoin>({ state: "connecting" });

  useEffect(() => {
    const joined = joinRoom({ serverUrl: SYNC_URL, room: roomId, user, link });
    let active = true;
    joined.synced.then(
      () => active && setJoin({ state: "ready", session: joined }),
      (err) =>
        active && setJoin({ state: "refused", code: err instanceof RoomRefused ? err.code : 0 }),
    );
    return () => {
      active = false;
      joined.leave();
      setJoin({ state: "connecting" });
    };
  }, [roomId, user, link]);

  return join;
}
