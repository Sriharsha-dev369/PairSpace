import { useQuery } from "@tanstack/react-query";
import { Link2Off, Loader2, Lock, SearchX, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useBlocker, useParams, useSearchParams } from "react-router";
import { api, type Role } from "../api";
import { authClient } from "../auth/client";
import { type Member, useMember } from "../auth/useMember";
import { guestIdentity, hasChosenName, memberIdentity, nameGuest } from "../room/identity";
import { RoomHeader } from "../room/RoomHeader";
import { NO_ACCESS, ROOM_NOT_FOUND, type RoomSession } from "../room/session";
import { useRoomSession } from "../room/useRoomSession";
import { useRoomState } from "../room/useRoomState";
import { Welcome } from "../room/Welcome";
import { Workspace } from "../room/Workspace";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { FullScreen } from "../ui/FullScreen";
import { LogoMark } from "../ui/Logo";
import { Notice } from "../ui/Notice";
import { usePageTitle } from "../ui/usePageTitle";
import { warm } from "./load";

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
  // fixed for this visit: renaming changes the session in place, so it never rejoins
  const [user] = useState(() => (member ? memberIdentity(member) : guestIdentity()));
  // a guest's first invite: they watch from the name screen until they join
  const [hidden] = useState(() => member === null && !hasChosenName());
  const [naming, setNaming] = useState(hidden);
  const join = useRoomSession(roomId, user, link, hidden);

  if (join.state === "ready" && naming) {
    const { session } = join;
    return (
      <Invited
        roomId={roomId}
        link={link}
        session={session}
        onJoin={(name) => {
          nameGuest(name);
          session.rename(name);
          session.appear();
          setNaming(false);
        }}
      />
    );
  }
  if (join.state === "ready") {
    return <Room roomId={roomId} session={join.session} isMember={member !== null} link={link} />;
  }
  if (join.state === "refused") return <RefusedRoom code={join.code} isMember={member !== null} />;
  return <Joining roomId={roomId} />;
}

// joining normally takes well under a second; this long means the room server isn't answering
const SLOW_JOIN_MS = 8000;

function Joining({ roomId }: { roomId: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_JOIN_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <FullScreen>
      <LogoMark className="h-10 w-10" />
      <p className="mt-5 flex items-center gap-2 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" />
        Joining room
      </p>
      <p className="mt-1 font-mono text-xs text-faint">{roomId}</p>
      {slow && (
        <div role="status" className="mt-8 max-w-xs text-center">
          <p className="text-sm font-medium">Taking longer than usual</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            The room's server isn't answering yet. PairSpace keeps trying: check your connection, or
            reload the page.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 h-8 rounded-lg border border-line px-3 text-xs font-medium text-muted transition hover:bg-raised hover:text-fg"
          >
            Reload
          </button>
        </div>
      )}
    </FullScreen>
  );
}

// the room's title and owner, and my role in it ("Ada invited you")
function useRoomInfo(roomId: string, link?: string) {
  return useQuery({
    queryKey: ["room", roomId, link],
    queryFn: () =>
      api<{ title: string; owner: string | null; role: Role }>(
        "GET",
        `/api/rooms/${roomId}${link ? `?link=${encodeURIComponent(link)}` : ""}`,
      ),
  });
}

function Invited({
  roomId,
  link,
  session,
  onJoin,
}: {
  roomId: string;
  link?: string;
  session: RoomSession;
  onJoin: (name: string) => void;
}) {
  const info = useRoomInfo(roomId, link);
  return (
    <Welcome
      session={session}
      title={info.data?.title}
      owner={info.data?.owner}
      viewOnly={info.data?.role === "viewer"}
      onJoin={onJoin}
    />
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
  const { status, people, unsyncedEdits, files, trash } = useRoomState(session);
  const info = useRoomInfo(roomId, link); // its title, and whether I'm its owner (who shares it)
  const viewOnly = info.data?.role === "viewer";
  usePageTitle(info.data?.title ?? "Room");
  useEffect(() => warm("home", "dashboard", "replay"), []);

  // edits that haven't synced exist only in this tab, so closing it would lose them
  useEffect(() => {
    const askFirst = (event: BeforeUnloadEvent) => {
      if (session.unsyncedEdits() && session.status() !== "deleted") event.preventDefault();
    };
    window.addEventListener("beforeunload", askFirst);
    return () => window.removeEventListener("beforeunload", askFirst);
  }, [session]);

  // leaving inside the app is no page unload, so beforeunload can't ask: the router does
  const leaving = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname &&
      session.unsyncedEdits() &&
      session.status() !== "deleted" &&
      session.status() !== "revoked",
  );

  if (status === "revoked") {
    return (
      <Notice
        icon={Lock}
        title="Your access to this room was turned off"
        body="The room's owner turned off the link you came in with. Ask them for a new one."
        isMember={isMember}
      />
    );
  }

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
        replay={
          info.data && !viewOnly
            ? `/r/${roomId}/replay${link ? `?link=${encodeURIComponent(link)}` : ""}`
            : undefined
        }
        viewOnly={viewOnly}
        status={status}
        people={people}
        unsyncedEdits={unsyncedEdits}
        isMember={isMember}
        onRename={(name) => {
          session.rename(name);
          // a member's name is their account's; a guest's is kept by this browser
          if (isMember) void authClient.updateUser({ name });
          else nameGuest(name);
        }}
      />
      <Workspace
        session={session}
        files={files}
        trash={trash}
        people={people}
        viewOnly={viewOnly}
        status={status}
      />
      <ConfirmDialog
        open={leaving.state === "blocked"}
        onOpenChange={(open) => !open && leaving.state === "blocked" && leaving.reset()}
        title="Leave with edits that haven't synced?"
        description="You're not connected right now, so your latest edits exist only in this tab. Leave now and they're lost; stay, and they sync when you reconnect."
        cancelLabel="Stay"
        confirmLabel="Leave anyway"
        onConfirm={() => leaving.state === "blocked" && leaving.proceed()}
      />
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
