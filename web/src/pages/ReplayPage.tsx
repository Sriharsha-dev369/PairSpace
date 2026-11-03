import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, History, Lock, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError, api } from "../api";
import { useMember } from "../auth/useMember";
import { ReplayEditor } from "../replay/ReplayEditor";
import { createTimeline, parseHistory, type SavedStep, type Timeline } from "../replay/timeline";
import { FileBadge } from "../room/FileBadge";
import { listFiles } from "../room/files";
import { Loading } from "../ui/FullScreen";
import { LogoMark } from "../ui/Logo";
import { Notice } from "../ui/Notice";

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

function Replay({ timeline, title, room }: { timeline: Timeline; title: string; room: string }) {
  const last = timeline.size - 1;
  const [step, setStep] = useState(last); // starts at the room as it is now
  const doc = useMemo(() => (last >= 0 ? timeline.docAt(step) : null), [timeline, step, last]);
  useEffect(() => () => doc?.destroy(), [doc]);
  const files = doc ? listFiles(doc) : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const file = files.find((each) => each.id === chosen) ?? files[0] ?? null;
  const change = timeline.steps[step];

  return (
    <div className="flex h-screen flex-col">
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
        <Link
          to={room}
          className="ml-auto flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-fg"
        >
          Back to the room
        </Link>
      </header>

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
            <ReplayEditor name={file?.name ?? ""} text={file?.content.toString() ?? ""} />
          </main>
        </div>
      )}

      {change && (
        <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous change"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-raised hover:text-fg disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="Next change"
              disabled={step === last}
              onClick={() => setStep(step + 1)}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-raised hover:text-fg disabled:opacity-30"
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
            onChange={(event) => setStep(Number(event.target.value))}
            className="min-w-40 flex-1 accent-accent"
          />
          <p className="flex items-center gap-3 text-xs text-muted">
            <span className="tabular-nums">
              Change {step + 1} of {last + 1}
            </span>
            <span className="tabular-nums text-faint">{when.format(change.at)}</span>
            <span data-testid="step-author" className="font-medium text-fg">
              {change.author ?? "PairSpace"}
            </span>
          </p>
        </footer>
      )}
    </div>
  );
}
