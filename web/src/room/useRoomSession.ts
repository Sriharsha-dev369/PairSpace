import { useEffect, useState } from "react";
import { joinRoom, type RoomSession, type User } from "./session";

const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:8080";

export type RoomJoin =
  | { state: "connecting" }
  | { state: "ready"; session: RoomSession }
  | { state: "refused" }; // the server won't accept this room (e.g. a bad link)

// joins the room for as long as the component is mounted
export function useRoomSession(roomId: string, user: User): RoomJoin {
  const [join, setJoin] = useState<RoomJoin>({ state: "connecting" });

  useEffect(() => {
    const joined = joinRoom({ serverUrl: SYNC_URL, room: roomId, user });
    let active = true;
    joined.synced.then(
      () => active && setJoin({ state: "ready", session: joined }),
      () => active && setJoin({ state: "refused" }),
    );
    return () => {
      active = false;
      joined.leave();
      setJoin({ state: "connecting" });
    };
  }, [roomId, user]);

  return join;
}
