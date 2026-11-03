import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useSignInHere } from "../auth/next";
import { Badge } from "../ui/Badge";
import { Card, FullScreen } from "../ui/FullScreen";
import { LogoMark } from "../ui/Logo";
import { PersonChip } from "../ui/PersonChip";
import { usePageTitle } from "../ui/usePageTitle";
import { MAX_NAME, nameProblem } from "./identity";
import type { RoomSession } from "./session";
import { useRoomState } from "./useRoomState";

interface Props {
  session: RoomSession; // joined hidden: it sees who's here, nobody sees it yet
  title?: string;
  owner?: string | null;
  viewOnly: boolean;
  onJoin: (name: string) => void; // trimmed, and without a problem
}

// a guest's first invite: whose room it is, who's in it right now, and the name others will see
export function Welcome({ session, title, owner, viewOnly, onJoin }: Props) {
  const { people } = useRoomState(session);
  const [name, setName] = useState(session.me.name);
  const [problem, setProblem] = useState<string | null>(null);
  const signIn = useSignInHere();
  usePageTitle(title ? `Join ${title}` : "Join a room");

  function join(event: FormEvent) {
    event.preventDefault();
    const wrong = nameProblem(name);
    if (wrong) setProblem(wrong);
    else onJoin(name.trim());
  }

  return (
    <FullScreen>
      <Card>
        <LogoMark className="h-9 w-9" />
        <p className="mt-6 text-sm text-muted">
          {owner ? `${owner} invited you to` : "You're invited to"}
        </p>
        <h1 className="mt-1 font-display text-2xl leading-tight font-semibold tracking-[-0.02em] break-words">
          {title ?? "a room"}
        </h1>
        {viewOnly && (
          <p className="mt-2 flex items-center gap-2 text-xs text-muted">
            <Badge>View only</Badge> You can watch, not type.
          </p>
        )}
        <div data-testid="here-now" className="mt-5 flex flex-wrap items-center gap-1.5">
          {people.length === 0 ? (
            <span className="text-xs text-faint">Nobody's in the room right now.</span>
          ) : (
            <>
              {people.map((person) => (
                <PersonChip key={person.id} {...person} />
              ))}
              <span className="text-xs text-faint">here now</span>
            </>
          )}
        </div>
        <form onSubmit={join} className="mt-7">
          <label htmlFor="your-name" className="text-xs font-medium text-muted">
            Your name
          </label>
          <input
            id="your-name"
            value={name}
            maxLength={MAX_NAME * 2}
            onFocus={(event) => event.target.select()}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
            aria-invalid={problem !== null}
            aria-describedby="your-name-note"
            className={`mt-1.5 h-10 w-full rounded-lg border bg-raised px-3 text-sm outline-none transition focus:ring-2 ${problem ? "border-red-400/60 ring-red-400/20" : "border-line focus:border-accent/50 focus:ring-accent/20"}`}
          />
          <p id="your-name-note" className="mt-1.5 text-[11px] text-faint">
            {problem ? (
              <span role="alert" className="text-red-300">
                {problem}
              </span>
            ) : (
              "Everyone in the room sees it next to your cursor."
            )}
          </p>
          <button
            type="submit"
            className="mt-5 h-10 w-full rounded-lg bg-accent text-sm font-semibold text-canvas transition hover:brightness-110"
          >
            Join room
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-faint">
          Have an account?{" "}
          <Link to={signIn} className="text-muted underline-offset-2 hover:text-fg hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </FullScreen>
  );
}
