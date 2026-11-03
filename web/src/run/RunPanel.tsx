import { Loader2, Play, Square, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { duration } from "../duration";
import { isTrashed, type RoomFile } from "../room/files";
import { runnableAs } from "./runner";
import { MAX_OUTPUT_CHARS, MAX_OUTPUT_LINES, type RunStatus, type RunView } from "./runState";

type Shown = RunStatus | "interrupted";

// how long it ran: "12 ms", "3.4 s"
const seconds = (run: RunView) => duration((run.endedAt ?? run.startedAt) - run.startedAt);

// one line about the run: who ran what, and how it ended
function describe(run: RunView, status: Shown): string {
  const { by, file } = run;
  switch (status) {
    case "running":
      return run.starting
        ? `${by.name} is starting Python to run ${file}`
        : `${by.name} is running ${file}`;
    case "done":
      return `${by.name} ran ${file} in ${seconds(run)}`;
    case "failed":
      return `${by.name} ran ${file}: it ended with an error`;
    case "stopped":
      return `${by.name} ran ${file}. Stopped by ${run.stopRequestedBy ?? `${by.name} leaving`}`;
    case "timed-out":
      return `${by.name} ran ${file}. Stopped at the time limit, after ${seconds(run)}`;
    case "interrupted":
      return `${by.name} ran ${file}. Interrupted: ${by.name} left while it was running`;
  }
}

// Run for the open file, or Stop while the room's run is going (one run at a time)
export function RunControl({
  file,
  busy,
  onRun,
  onStop,
}: {
  file: RoomFile | null;
  busy: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  if (busy) {
    return (
      <button
        type="button"
        onClick={onStop}
        className="flex h-7 items-center gap-1.5 rounded-md border border-red-400/40 px-2.5 text-xs font-semibold text-red-300 transition hover:bg-red-400/10"
      >
        <Square size={10} fill="currentColor" />
        Stop
      </button>
    );
  }
  const runnable = file !== null && !isTrashed(file) && runnableAs(file.name) !== null;
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={!runnable}
      title={runnable ? `Run ${file.name} for everyone here` : "Open a .js or .py file to run it"}
      className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-semibold text-canvas transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Play size={11} fill="currentColor" />
      Run
    </button>
  );
}

// the room's last run, as everyone sees it: who ran what, how it ended, and what it printed
export function RunPanel({
  run,
  status,
  onHide,
}: {
  run: RunView;
  status: Shown;
  onHide: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const printed = run.output.length;
  // new output scrolls into view, as in a terminal
  useEffect(() => {
    if (printed >= 0) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [printed]);

  const ended = status !== "running";
  return (
    <section
      aria-label="Output"
      className="flex h-56 shrink-0 flex-col border-t border-line bg-surface"
    >
      <div className="flex h-9 shrink-0 items-center gap-2.5 border-b border-line pr-2 pl-4 text-xs">
        <span className="font-semibold text-muted">Output</span>
        <span data-testid="run-status" className="flex min-w-0 items-center gap-1.5 text-faint">
          {ended ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: run.by.color }}
            />
          ) : (
            <Loader2 size={12} className="shrink-0 animate-spin" />
          )}
          <span className="truncate">{describe(run, status)}</span>
        </span>
        <button
          type="button"
          aria-label="Hide output"
          title="Hide output"
          onClick={onHide}
          className="ml-auto grid h-6 w-6 place-items-center rounded-md text-faint transition hover:bg-raised hover:text-fg"
        >
          <X size={12} />
        </button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-canvas px-4 py-3">
        <pre
          data-testid="run-output"
          className="font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words"
        >
          {run.output.map((chunk, at) => (
            <span
              // output only grows, so a chunk's place is its identity
              // biome-ignore lint/suspicious/noArrayIndexKey: as above
              key={at}
              className={chunk.stream === "err" ? "text-red-300" : "text-fg"}
            >
              {chunk.text}
            </span>
          ))}
          {run.error && <span className="text-red-300">{run.error}</span>}
        </pre>
        {ended && printed === 0 && !run.error && <p className="text-xs text-faint">No output.</p>}
        {run.truncated && (
          <p className="mt-2 text-xs text-faint">
            Output past {MAX_OUTPUT_LINES.toLocaleString("en")} lines or{" "}
            {MAX_OUTPUT_CHARS.toLocaleString("en")} characters isn't kept.
          </p>
        )}
      </div>
    </section>
  );
}
