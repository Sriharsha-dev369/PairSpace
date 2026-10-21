import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Editor } from "../room/Editor";
import { guestIdentity } from "../room/guest";
import { RoomHeader } from "../room/RoomHeader";
import type { RoomSession } from "../room/session";
import { useRoomSession } from "../room/useRoomSession";
import { useRoomState } from "../room/useRoomState";

export function RoomPage() {
  const { roomId = "" } = useParams();
  const user = useMemo(guestIdentity, []);
  const join = useRoomSession(roomId, user);

  if (join.state === "ready") return <Room session={join.session} />;
  return (
    <div className="grid h-screen place-items-center bg-gray-950 text-gray-400">
      {join.state === "refused" ? (
        <div className="flex flex-col items-center gap-3">
          <p>This room link isn't valid.</p>
          <Link to="/" className="text-sm text-emerald-400 hover:underline">
            Start a new room
          </Link>
        </div>
      ) : (
        "Connecting…"
      )}
    </div>
  );
}

function Room({ session }: { session: RoomSession }) {
  const { status, people } = useRoomState(session);
  const [file] = session.files();

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      <RoomHeader fileName={file.name} status={status} people={people} />
      <main className="min-h-0 flex-1">
        <Editor file={file} awareness={session.awareness} />
      </main>
    </div>
  );
}
