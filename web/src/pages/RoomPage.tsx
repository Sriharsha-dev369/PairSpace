import { useMemo } from "react";
import { useParams } from "react-router";
import { Editor } from "../room/Editor";
import { guestIdentity } from "../room/guest";
import { useRoomSession } from "../room/useRoomSession";

export function RoomPage() {
  const { roomId = "" } = useParams();
  const user = useMemo(guestIdentity, []);
  const session = useRoomSession(roomId, user);

  if (!session) {
    return (
      <div className="grid h-screen place-items-center bg-gray-950 text-gray-400">Connecting…</div>
    );
  }

  const [file] = session.files();
  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      <header className="flex items-center gap-3 border-b border-gray-800 px-4 py-2">
        <span className="font-semibold tracking-tight">PairSpace</span>
        <span className="text-sm text-gray-500">{file.name}</span>
      </header>
      <main className="min-h-0 flex-1">
        <Editor file={file} awareness={session.awareness} />
      </main>
    </div>
  );
}
