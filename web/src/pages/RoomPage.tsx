import { useQuery } from "@tanstack/react-query";
import { Link2Off, Loader2, Lock, SearchX, Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { type Member, useMember } from "../auth/useMember";
import { Editor } from "../room/Editor";
import { FileTabs } from "../room/FileTabs";
import { guestIdentity, memberIdentity } from "../room/identity";
import { RoomHeader } from "../room/RoomHeader";
import { StatusBar } from "../room/StatusBar";
import { NO_ACCESS, ROOM_NOT_FOUND, type RoomSession } from "../room/session";
import { useRoomSession } from "../room/useRoomSession";
import { useRoomState } from "../room/useRoomState";
import { FullScreen } from "../ui/FullScreen";
import { LogoMark } from "../ui/Logo";
import { Notice } from "../ui/Notice";

export function RoomPage() {
  const { roomId = "" } = useParams();
  const link = useSearchParams()[0].get("link") ?? undefined; // a share link's code, if opened by one
  const member = useMember();
  if (member === undefined) return <Joining roomId={roomId} />;
  // keyed by account: signing in or out rejoins the room under the new identity
  return <JoinRoom key={member?.id ?? "guest"} roomId={roomId} member={member} link={link} />;
}

function JoinRoom({
  roomId,
  member,
  link,
}: {
  roomId: string;
  member: Member | null;
  link?: string;
}) {
  const user = useMemo(() => (member ? memberIdentity(member) : guestIdentity()), [member]);
  const join = useRoomSession(roomId, user, link);

  if (join.state === "ready") {
    return <Room roomId={roomId} session={join.session} isMember={member !== null} link={link} />;
  }
  if (join.state === "refused") return <RefusedRoom code={join.code} isMember={member !== null} />;
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
  link,
}: {
  roomId: string;
  session: RoomSession;
  isMember: boolean;
  link?: string;
}) {
  const { status, people, unsyncedEdits } = useRoomState(session);
  // its title, and whether I'm its owner (who shares it)
  const info = useQuery({
    queryKey: ["room", roomId, link],
    queryFn: () =>
      api<{ title: string; role: string }>(
        "GET",
        `/api/rooms/${roomId}${link ? `?link=${encodeURIComponent(link)}` : ""}`,
      ),
  });
  const [file] = session.files();

  // edits that haven't synced exist only in this tab, so closing it would lose them
  useEffect(() => {
    const askFirst = (event: BeforeUnloadEvent) => {
      if (session.unsyncedEdits() && session.status() !== "deleted") event.preventDefault();
    };
    window.addEventListener("beforeunload", askFirst);
    return () => window.removeEventListener("beforeunload", askFirst);
  }, [session]);

  if (status === "deleted") {
    return (
      <Notice
        icon={Trash2}
        title="This room was deleted"
        body="Its owner deleted it, with its whole history."
        isMember={isMember}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <RoomHeader
        roomId={roomId}
        title={info.data?.title}
        canShare={info.data?.role === "owner"}
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

function RefusedRoom({ code, isMember }: { code: number; isMember: boolean }) {
  if (code === ROOM_NOT_FOUND) {
    return (
      <Notice
        icon={SearchX}
        title="This room doesn't exist"
        body="The link may be mistyped, or the room was deleted."
        isMember={isMember}
      />
    );
  }
  if (code === NO_ACCESS) {
    return (
      <Notice
        icon={Lock}
        title="You don't have access to this room"
        body="Ask its owner for a share link. If you joined it before, sign in with that account."
        isMember={isMember}
      />
    );
  }
  return (
    <Notice
      icon={Link2Off}
      title="This room link isn't valid"
      body="Check the link you were sent, or ask its owner for a new one."
      isMember={isMember}
    />
  );
}
