import { Link2Off, Loader2, Plus } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Link, useParams } from "react-router";
import { Editor } from "../room/Editor";
import { FileTabs } from "../room/FileTabs";
import { guestIdentity } from "../room/guest";
import { RoomHeader } from "../room/RoomHeader";
import { StatusBar } from "../room/StatusBar";
import type { RoomSession } from "../room/session";
import { useRoomSession } from "../room/useRoomSession";
import { useRoomState } from "../room/useRoomState";
import { LogoMark } from "../ui/Logo";

export function RoomPage() {
  const { roomId = "" } = useParams();
  const user = useMemo(guestIdentity, []);
  const join = useRoomSession(roomId, user);

  if (join.state === "ready") return <Room roomId={roomId} session={join.session} />;
  if (join.state === "refused") return <RefusedRoom />;
  return (
    <FullScreen>
      <LogoMark className="h-10 w-10" />
      <p className="mt-5 flex items-center gap-2 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" />
        Joining room
      </p>
      <p className="mt-1 font-mono text-xs text-faint">{roomId}</p>
    </FullScreen>
  );
}

function Room({ roomId, session }: { roomId: string; session: RoomSession }) {
  const { status, people } = useRoomState(session);
  const [file] = session.files();

  return (
    <div className="flex h-screen flex-col">
      <RoomHeader roomId={roomId} status={status} people={people} />
      <FileTabs fileName={file.name} />
      <main className="min-h-0 flex-1">
        <Editor file={file} awareness={session.awareness} />
      </main>
      <StatusBar peopleCount={people.length} />
    </div>
  );
}

function RefusedRoom() {
  return (
    <FullScreen>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center shadow-2xl shadow-black/40">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-red-400/10 text-red-300">
          <Link2Off size={20} />
        </span>
        <h1 className="mt-5 text-base font-semibold">This room link isn't valid</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Check the link you were sent, or start a fresh room and invite people to it.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-canvas transition hover:brightness-110"
        >
          <Plus size={16} strokeWidth={2.5} />
          Start a new room
        </Link>
      </div>
    </FullScreen>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-screen place-items-center bg-[radial-gradient(ellipse_at_top,rgb(139_140_255/0.10),transparent_60%)] px-4">
      <div className="flex flex-col items-center">{children}</div>
    </div>
  );
}
