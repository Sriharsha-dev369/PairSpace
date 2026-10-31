import { Link2Off, Loader2, SearchX } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router";
import { type Member, useMember } from "../auth/useMember";
import { Editor } from "../room/Editor";
import { FileTabs } from "../room/FileTabs";
import { guestIdentity, memberIdentity } from "../room/identity";
import { RoomHeader } from "../room/RoomHeader";
import { StatusBar } from "../room/StatusBar";
import { ROOM_NOT_FOUND, type RoomSession } from "../room/session";
import { useRoomSession } from "../room/useRoomSession";
import { useRoomState } from "../room/useRoomState";
import { Card, FullScreen } from "../ui/FullScreen";
import { LogoMark } from "../ui/Logo";

export function RoomPage() {
  const { roomId = "" } = useParams();
  const member = useMember();
  if (member === undefined) return <Joining roomId={roomId} />;
  // keyed by account: signing in or out rejoins the room under the new identity
  return <JoinRoom key={member?.id ?? "guest"} roomId={roomId} member={member} />;
}

function JoinRoom({ roomId, member }: { roomId: string; member: Member | null }) {
  const user = useMemo(() => (member ? memberIdentity(member) : guestIdentity()), [member]);
  const join = useRoomSession(roomId, user);

  if (join.state === "ready") {
    return <Room roomId={roomId} session={join.session} isMember={member !== null} />;
  }
  if (join.state === "refused") {
    return <RefusedRoom missing={join.code === ROOM_NOT_FOUND} isMember={member !== null} />;
  }
  return <Joining roomId={roomId} />;
}

function Joining({ roomId }: { roomId: string }) {
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

function Room({
  roomId,
  session,
  isMember,
}: {
  roomId: string;
  session: RoomSession;
  isMember: boolean;
}) {
  const { status, people, unsyncedEdits } = useRoomState(session);
  const [file] = session.files();

  // edits that haven't synced exist only in this tab, so closing it would lose them
  useEffect(() => {
    const askFirst = (event: BeforeUnloadEvent) => {
      if (session.unsyncedEdits()) event.preventDefault();
    };
    window.addEventListener("beforeunload", askFirst);
    return () => window.removeEventListener("beforeunload", askFirst);
  }, [session]);

  return (
    <div className="flex h-screen flex-col">
      <RoomHeader
        roomId={roomId}
        status={status}
        people={people}
        unsyncedEdits={unsyncedEdits}
        isMember={isMember}
      />
      <FileTabs fileName={file.name} />
      <main className="min-h-0 flex-1">
        <Editor file={file} awareness={session.awareness} />
      </main>
      <StatusBar peopleCount={people.length} />
    </div>
  );
}

// only members start rooms: a guest is offered to sign in first
function RefusedRoom({ missing, isMember }: { missing: boolean; isMember: boolean }) {
  const Icon = missing ? SearchX : Link2Off;
  return (
    <FullScreen>
      <Card>
        <div className="text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-red-400/10 text-red-300">
            <Icon size={20} />
          </span>
          <h1 className="mt-5 text-base font-semibold">
            {missing ? "This room doesn't exist" : "This room link isn't valid"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {missing
              ? "The link may be mistyped, or the room was never created."
              : "Check the link you were sent, or start a fresh room and invite people to it."}
          </p>
          <Link
            to={isMember ? "/" : "/sign-in"}
            className="mt-6 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-canvas transition hover:brightness-110"
          >
            {isMember ? "Start a new room" : "Sign in to start a room"}
          </Link>
        </div>
      </Card>
    </FullScreen>
  );
}
