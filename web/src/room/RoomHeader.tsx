import { LogIn } from "lucide-react";
import { Link } from "react-router";
import { useSignInHere } from "../auth/next";
import { SignOutButton } from "../auth/SignOutButton";
import { Badge } from "../ui/Badge";
import { LogoMark } from "../ui/Logo";
import { PersonChip } from "../ui/PersonChip";
import { HEADER_BUTTON } from "../ui/styles";
import { ShareButton } from "./ShareButton";
import type { ConnectionStatus, Person } from "./session";

const STATUS: Record<ConnectionStatus, { label: string; dot: string }> = {
  connected: { label: "Connected", dot: "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" },
  connecting: { label: "Connecting…", dot: "bg-amber-400 animate-pulse" },
  reconnecting: { label: "Reconnecting…", dot: "bg-amber-400 animate-pulse" },
  offline: { label: "Offline", dot: "bg-red-400" },
  "too-large": { label: "Change too large to sync", dot: "bg-red-400" },
  deleted: { label: "Room deleted", dot: "bg-red-400" },
  revoked: { label: "Access turned off", dot: "bg-red-400" },
};

interface Props {
  roomId: string;
  title?: string; // until it loads, the room's id stands in
  canShare: boolean; // only the owner makes share links
  viewOnly: boolean; // came in with a view link: can watch, not type
  status: ConnectionStatus;
  people: Person[];
  unsyncedEdits: boolean;
  isMember: boolean; // signed in; otherwise a guest who joined through the link
}

// members sign out here; guests sign in and come straight back to this room
function AccountButton({ isMember }: { isMember: boolean }) {
  const signIn = useSignInHere();
  if (isMember) return <SignOutButton />;
  return (
    <Link to={signIn} className={HEADER_BUTTON}>
      <LogIn size={14} />
      Sign in
    </Link>
  );
}

export function RoomHeader({
  roomId,
  title,
  canShare,
  viewOnly,
  status,
  people,
  unsyncedEdits,
  isMember,
}: Props) {
  const me = people.find((p) => p.isMe);
  const others = people.filter((p) => !p.isMe);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      {/* the way out: members back to their rooms, guests to the home page */}
      <Link
        to="/"
        className="flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight transition hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <LogoMark />
        {isMember ? "Your rooms" : "PairSpace"}
      </Link>
      <span className="text-faint">/</span>
      <span
        data-testid="room-title"
        className={title ? "truncate text-sm font-medium" : "font-mono text-xs text-muted"}
      >
        {title ?? roomId}
      </span>
      {viewOnly && <Badge>View only</Badge>}

      <div className="ml-auto flex items-center gap-2">
        {others.length === 0 && (
          <span className="mr-1 hidden text-xs text-faint md:inline">
            Only you here. Share the link to code together
          </span>
        )}
        {others.map((person) => (
          <PersonChip key={person.id} {...person} testId="other-person" />
        ))}
        {me && (
          <PersonChip {...me} testId="my-name">
            <span className="text-faint">you</span>
            {!isMember && (
              <span className="rounded-full bg-line px-1.5 text-[10px] font-medium text-muted">
                guest
              </span>
            )}
          </PersonChip>
        )}

        <span className="mx-1 h-5 w-px bg-line" />
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className={`h-2 w-2 rounded-full ${STATUS[status].dot}`} />
          <span data-testid="connection-status">{STATUS[status].label}</span>
          {unsyncedEdits && (status === "offline" || status === "reconnecting") && (
            <span data-testid="unsynced-hint" className="text-faint">
              · your edits will sync when you're back
            </span>
          )}
        </span>
        <AccountButton isMember={isMember} />
        {canShare && <ShareButton roomId={roomId} title={title ?? roomId} />}
      </div>
    </header>
  );
}
