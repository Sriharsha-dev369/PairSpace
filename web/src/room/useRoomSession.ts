import { useEffect, useState } from "react";
import { joinRoom, RoomRefused, type RoomSession, type User } from "./session";

// the room server: in development its own port; built, the server that serves this page (one
// origin: its cookie goes along, and https pages get wss)
const SYNC_URL: string =
  import.meta.env.VITE_SYNC_URL ??
  (import.meta.env.DEV
    ? "ws://localhost:8080"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

type RoomJoin =
  | { state: "connecting" }
  | { state: "ready"; session: RoomSession }
  | { state: "refused"; code: number }; // the server won't let us in (see RoomRefused)

// joins the room for as long as the component is mounted; hidden: watching, until appear()
export function useRoomSession(
  roomId: string,
  user: User,
  link?: string,
  hidden = false,
): RoomJoin {
  const [join, setJoin] = useState<RoomJoin>({ state: "connecting" });

  useEffect(() => {
    const joined = joinRoom({ serverUrl: SYNC_URL, room: roomId, user, link, hidden });
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
  }, [roomId, user, link, hidden]);

  return join;
}
