import { useEffect, useState } from "react";
import { joinRoom, type RoomSession, type User } from "./session";

const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:8080";

// joins the room for as long as the component is mounted; null until the first sync arrives
export function useRoomSession(roomId: string, user: User): RoomSession | null {
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    const joined = joinRoom({ serverUrl: SYNC_URL, room: roomId, user });
    let active = true;
    joined.synced.then(() => {
      if (active) setSession(joined);
    });
    return () => {
      active = false;
      joined.leave();
      setSession(null);
    };
  }, [roomId, user]);

  return session;
}
