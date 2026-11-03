import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, History, Lock, Pause, Play, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError, api } from "../api";
import { useMember } from "../auth/useMember";
import { type Author, authorsOf, playbackDelay, runsOf } from "../replay/authors";
import { ReplayEditor } from "../replay/ReplayEditor";
import {
  createTimeline,
  parseHistory,
  type SavedStep,
  type Step,
  type Timeline,
} from "../replay/timeline";
import { FileBadge } from "../room/FileBadge";
import { listFiles } from "../room/files";
import { colorFor } from "../room/identity";
import { Loading } from "../ui/FullScreen";
import { LogoMark } from "../ui/Logo";
import { Notice } from "../ui/Notice";
import { PersonChip } from "../ui/PersonChip";

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

// a room's saved changes, one step at a time (for people who can edit it)
export function ReplayPage() {
  const { roomId = "" } = useParams();
  const link = useSearchParams()[0].get("link");
  const query = link ? `?link=${encodeURIComponent(link)}` : "";
  const member = useMember();
  const history = useQuery({
    queryKey: ["history", roomId, link],
    queryFn: async () =>
      parseHistory(await api<SavedStep[]>("GET", `/api/rooms/${roomId}/history${query}`)),
    retry: false,
  });
  const info = useQuery({
    queryKey: ["room", roomId, link],
    queryFn: () => api<{ title: string }>("GET", `/api/rooms/${roomId}${query}`),
  });
  const timeline = useMemo(() => history.data && createTimeline(history.data), [history.data]);
  const room = `/r/${roomId}${query}`;

  if (history.isError) {
    const viewOnly = history.error instanceof ApiError && history.error.status === 403;
    return viewOnly ? (
      <Notice
        icon={Lock}
        title="Replay is for people who can edit"
        body="Your link lets you watch the room as it is now. Replay also shows what was typed and then removed, so it's kept for people who can edit."
        isMember={member != null}
        way={{ to: room, label: "Back to the room" }}
      />
    ) : (
      <Notice
        icon={SearchX}
        title="This room doesn't exist"
        body="The link may be mistyped, or the room was deleted."
        isMember={member != null}
      />
    );
  }
  if (!timeline) return <Loading />;
  return <Replay timeline={timeline} title={info.data?.title ?? roomId} room={room} />;
}

const NOBODY = "#565b69"; // the room's own changes (its first file)

function Replay({ timeline, title, room }: { timeline: Timeline; title: string; room: string }) {
  const last = timeline.size - 1;
  const [step, setStep] = useState(last); // starts at the room as it is now
  const [playing, setPlaying] = useState(false);
  const doc = useMemo(() => (last >= 0 ? timeline.docAt(step) : null), [timeline, step, last]);
  useEffect(() => () => doc?.destroy(), [doc]);
  const authors = useMemo(() => authorsOf(timeline.steps), [timeline]);
  const files = doc ? listFiles(doc) : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const file = files.find((each) => each.id === chosen) ?? files[0] ?? null;
  const runs = useMemo(() => (file ? runsOf(file.content, authors) : []), [file, authors]);

  // Play: the next change after as long as it took then (long pauses cut short), to the end
  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      return;
    }
    const next = setTimeout(() => setStep(step + 1), playbackDelay(timeline.steps, step));
    return () => clearTimeout(next);
  }, [playing, step, last, timeline]);

  return (
    <div className="flex h-screen flex-col">
      <ReplayHeader title={title} room={room} people={peopleIn(authors)} />
      {last < 0 ? (
        <p className="grid flex-1 place-items-center text-sm text-faint">
          This room has no saved changes to replay.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside
            aria-label="Files at this step"
            className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-line bg-surface py-2 sm:w-60"
          >
            {files.map((each) => (
              <button
                key={each.id}
                type="button"
                onClick={() => setChosen(each.id)}
                className={`flex h-8 items-center gap-2 px-4 text-left text-[13px] ${each.id === file?.id ? "bg-raised text-fg" : "text-muted hover:bg-raised/50 hover:text-fg"}`}
              >
                <FileBadge name={each.name} />
                <span data-testid="file-name" className="truncate">
                  {each.name}
                </span>
              </button>
            ))}
          </aside>
          <main className="min-h-0 flex-1">
            <ReplayEditor name={file?.name ?? ""} runs={runs} />
          </main>
        </div>
      )}
      {last >= 0 && (
        <Controls
          step={step}
          last={last}
          change={timeline.steps[step]}
          playing={playing}
          onStep={(to) => {
            setPlaying(false);
            setStep(to);
          }}
          onPlay={() => {
            if (!playing && step === last) setStep(0); // from the start again
            setPlaying(!playing);
          }}
        />
      )}
    </div>
  );
}

// everyone who wrote in the room, once each, by their latest name
const peopleIn = (authors: Map<number, Author>) => [
  ...new Map([...authors.values()].map((author) => [author.key, author])).values(),
];

function ReplayHeader({ title, room, people }: { title: string; room: string; people: Author[] }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <Link
        to={room}
        className="flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight transition hover:text-accent"
      >
        <LogoMark />
        {title}
      </Link>
      <span className="text-faint">/</span>
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <History size={14} className="text-muted" />
        Replay
      </span>
      <ul aria-label="People in this replay" className="ml-auto hidden items-center gap-2 md:flex">
        {people.map((person) => (
          <li key={person.key}>
            <PersonChip name={person.name} color={person.color} />
          </li>
        ))}
      </ul>
      <Link
        to={room}
        className="ml-auto flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-fg md:ml-2"
      >
        Back to the room
      </Link>
    </header>
  );
}

const STEP_BUTTON =
  "grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-raised hover:text-fg disabled:opacity-30";

function Controls({
  step,
  last,
  change,
  playing,
  onStep,
  onPlay,
}: {
  step: number;
  last: number;
  change: Step;
  playing: boolean;
  onStep: (step: number) => void;
  onPlay: () => void;
}) {
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPlay}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-canvas transition hover:brightness-110"
        >
          {playing ? (
            <Pause size={12} fill="currentColor" />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          aria-label="Previous change"
          disabled={step === 0}
          onClick={() => onStep(step - 1)}
          className={STEP_BUTTON}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="Next change"
          disabled={step === last}
          onClick={() => onStep(step + 1)}
          className={STEP_BUTTON}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <input
        type="range"
        aria-label="Step"
        min={0}
        max={last}
        value={step}
        onChange={(event) => onStep(Number(event.target.value))}
        className="min-w-40 flex-1 accent-accent"
      />
      <p className="flex items-center gap-3 text-xs text-muted">
        <span className="tabular-nums">
          Change {step + 1} of {last + 1}
        </span>
        <span className="tabular-nums text-faint">{when.format(change.at)}</span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor: change.author ? colorFor(change.authorId ?? change.author) : NOBODY,
            }}
          />
          <span data-testid="step-author" className="font-medium text-fg">
            {change.author ?? "PairSpace"}
          </span>
        </span>
      </p>
    </footer>
  );
}
