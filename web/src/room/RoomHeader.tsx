import { History, LogIn, Menu, Pencil } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useSignInHere } from "../auth/next";
import { SignOutButton } from "../auth/SignOutButton";
import { NetworkTag } from "../inspector/SyncInspector";
import { Badge } from "../ui/Badge";
import { LogoMark } from "../ui/Logo";
import { NameField } from "../ui/NameField";
import { PersonChip } from "../ui/PersonChip";
import { Sheet } from "../ui/Sheet";
import { HEADER_BUTTON } from "../ui/styles";
import { useIsPhone } from "../ui/useIsPhone";
import { STATUS } from "./connectionStatus";
import { MAX_NAME, nameProblem } from "./identity";
import { ShareButton } from "./ShareButton";
import type { ConnectionStatus, Person } from "./session";

interface Props {
  roomId: string;
  title?: string; // until it loads, the room's id stands in
  canShare: boolean; // only the owner makes share links
  replay?: string; // the replay page, for people who can edit
  viewOnly: boolean; // came in with a view link: can watch, not type
  status: ConnectionStatus;
  people: Person[];
  unsyncedEdits: boolean;
  isMember: boolean; // signed in; otherwise a guest who joined through the link
  onRename: (name: string) => void;
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

// me, as the others see me; the pencil renames me (for everyone, at once)
function MyChip({
  me,
  isMember,
  onRename,
}: {
  me: Person;
  isMember: boolean;
  onRename: (name: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  if (renaming) {
    return (
      <div className="w-44">
        <NameField
          initial={me.name}
          label="Your name"
          maxLength={MAX_NAME}
          problem={nameProblem}
          onSave={(name) => {
            onRename(name);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
          className="h-7 text-xs"
        />
      </div>
    );
  }
  return (
    <PersonChip {...me} testId="my-name">
      <span className="text-faint">you</span>
      {!isMember && (
        <span className="rounded-full bg-line px-1.5 text-[10px] font-medium text-fg/80">
          guest
        </span>
      )}
      <button
        type="button"
        aria-label="Change your name"
        title="Change your name"
        onClick={() => setRenaming(true)}
        className="-mr-1 grid h-5 w-5 place-items-center rounded-full text-faint transition hover:bg-line hover:text-fg"
      >
        <Pencil size={10} />
      </button>
    </PersonChip>
  );
}

// who's here: the others (with any bad network they're simulating), then me
function People({ people, isMember, onRename }: Pick<Props, "people" | "isMember" | "onRename">) {
  const me = people.find((p) => p.isMe);
  return (
    <>
      {people
        .filter((p) => !p.isMe)
        .map((person) => (
          <PersonChip key={person.id} {...person} testId="other-person">
            {person.network !== "normal" && <NetworkTag network={person.network} />}
          </PersonChip>
        ))}
      {me && <MyChip me={me} isMember={isMember} onRename={onRename} />}
    </>
  );
}

function Connection({ status, unsyncedEdits }: Pick<Props, "status" | "unsyncedEdits">) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS[status].dot}`} />
      <span data-testid="connection-status">{STATUS[status].label}</span>
      {unsyncedEdits && (status === "offline" || status === "reconnecting") && (
        <span data-testid="unsynced-hint" className="text-faint">
          · your edits will sync when you're back
        </span>
      )}
    </span>
  );
}

// replay, account and share: the room's ways onward
function Actions({
  roomId,
  title,
  canShare,
  replay,
  isMember,
}: Pick<Props, "roomId" | "title" | "canShare" | "replay" | "isMember">) {
  return (
    <>
      {replay && (
        <Link to={replay} className={HEADER_BUTTON}>
          <History size={14} />
          Replay
        </Link>
      )}
      <AccountButton isMember={isMember} />
      {canShare && <ShareButton roomId={roomId} title={title ?? roomId} />}
    </>
  );
}

// on a phone: the connection's dot, and everything else in a menu that slides in
function PhoneMenu(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-auto flex items-center gap-1">
      <span
        className={`h-2 w-2 rounded-full ${STATUS[props.status].dot}`}
        title={STATUS[props.status].label}
      />
      <button
        type="button"
        aria-label="Menu"
        onClick={() => setOpen(true)}
        className={HEADER_BUTTON}
      >
        <Menu size={16} />
      </button>
      <Sheet title="Menu" side="right" open={open} onOpenChange={setOpen}>
        <div className="flex flex-col gap-6 p-5">
          <section>
            <h2 className="text-xs font-medium text-faint">In this room</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <People {...props} />
            </div>
          </section>
          <Connection {...props} />
          <div className="flex flex-wrap items-center gap-2">
            <Actions {...props} />
          </div>
        </div>
      </Sheet>
    </div>
  );
}

export function RoomHeader(props: Props) {
  const { roomId, title, viewOnly, people, isMember } = props;
  const phone = useIsPhone();
  const alone = people.every((p) => p.isMe);
  const home = isMember ? "Your rooms" : "PairSpace";

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      {/* the way out: members back to their rooms, guests to the home page */}
      <Link
        to="/"
        aria-label={home}
        className="flex shrink-0 items-center gap-2 rounded-md text-sm font-semibold tracking-tight transition hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <LogoMark />
        <span className="hidden md:inline">{home}</span>
      </Link>
      <span className="text-faint">/</span>
      <span
        data-testid="room-title"
        className={`min-w-0 truncate ${title ? "text-sm font-medium" : "font-mono text-xs text-muted"}`}
      >
        {title ?? roomId}
      </span>
      {viewOnly && <Badge>View only</Badge>}

      {phone ? (
        <PhoneMenu {...props} />
      ) : (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {alone && (
            <span className="mr-1 hidden text-xs text-faint lg:inline">
              Only you here. Share the link to code together
            </span>
          )}
          <People {...props} />
          <span className="mx-1 h-5 w-px bg-line" />
          <Connection {...props} />
          <Actions {...props} />
        </div>
      )}
    </header>
  );
}
