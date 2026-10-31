import { LogIn } from "lucide-react";
import { Link, useLocation } from "react-router";
import { SignOutButton } from "../auth/SignOutButton";
import { Logo } from "../ui/Logo";
import { ShareButton } from "./ShareButton";
import type { ConnectionStatus, Person } from "./session";

const STATUS: Record<ConnectionStatus, { label: string; dot: string }> = {
  connected: { label: "Connected", dot: "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" },
  connecting: { label: "Connecting…", dot: "bg-amber-400 animate-pulse" },
  reconnecting: { label: "Reconnecting…", dot: "bg-amber-400 animate-pulse" },
  offline: { label: "Offline", dot: "bg-red-400" },
  "too-large": { label: "Change too large to sync", dot: "bg-red-400" },
  deleted: { label: "Room deleted", dot: "bg-red-400" },
};

interface Props {
  roomId: string;
  status: ConnectionStatus;
  people: Person[];
  unsyncedEdits: boolean;
  isMember: boolean; // signed in; otherwise a guest who joined through the link
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2);

function PersonChip({
  person,
  testId,
  isGuest = false,
}: {
  person: Person;
  testId: string;
  isGuest?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line bg-raised py-0.5 pr-2.5 pl-0.5 text-xs">
      <span
        className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-canvas"
        style={{ backgroundColor: person.color }}
        aria-hidden="true"
      >
        {initials(person.name)}
      </span>
      <span data-testid={testId} className="font-medium">
        {person.name}
      </span>
      {person.isMe && <span className="text-faint">you</span>}
      {isGuest && (
        <span className="rounded-full bg-line px-1.5 text-[10px] font-medium text-muted">
          guest
        </span>
      )}
    </span>
  );
}

const ACCOUNT_BUTTON =
  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-fg";

// members sign out here; guests sign in and come straight back to this room
function AccountButton({ isMember }: { isMember: boolean }) {
  const { pathname } = useLocation();
  if (!isMember) {
    return (
      <Link to={`/sign-in?next=${encodeURIComponent(pathname)}`} className={ACCOUNT_BUTTON}>
        <LogIn size={14} />
        Sign in
      </Link>
    );
  }
  return <SignOutButton className={ACCOUNT_BUTTON} />;
}

export function RoomHeader({ roomId, status, people, unsyncedEdits, isMember }: Props) {
  const me = people.find((p) => p.isMe);
  const others = people.filter((p) => !p.isMe);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <Logo />
      <span className="text-faint">/</span>
      <span className="font-mono text-xs text-muted">{roomId}</span>

      <div className="ml-auto flex items-center gap-2">
        {others.length === 0 && (
          <span className="mr-1 hidden text-xs text-faint md:inline">
            Only you here. Share the link to code together
          </span>
        )}
        {others.map((person) => (
          <PersonChip key={person.id} person={person} testId="other-person" />
        ))}
        {me && <PersonChip person={me} testId="my-name" isGuest={!isMember} />}

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
        <ShareButton />
      </div>
    </header>
  );
}
