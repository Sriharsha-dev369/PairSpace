import { Activity, X } from "lucide-react";
import type { ReactNode } from "react";
import { duration } from "../duration";
import { STATUS } from "../room/connectionStatus";
import type { ConnectionStatus, RoomSession } from "../room/session";
import { timeAgo } from "../timeAgo";
import { useNow, useSyncStats } from "./useSync";

type Sync = RoomSession["sync"];

const changes = (n: number) => (n === 0 ? "None" : n === 1 ? "1 change" : `${n} changes`);

// seconds count here, so "3 s ago" until a minute, then "2 minutes ago"
function since(at: number | null, now: number): string {
  if (at === null) return "Not yet";
  const seconds = Math.floor((now - at) / 1000);
  if (seconds < 1) return "just now";
  return seconds < 60 ? `${seconds} s ago` : timeAgo(at, now);
}

// in the status bar: the latest round trip, and the way into the inspector
export function RoundTripButton({
  sync,
  open,
  onToggle,
}: {
  sync: Sync;
  open: boolean;
  onToggle: () => void;
}) {
  const latest = useSyncStats(sync).roundTrips.at(-1);
  return (
    <button
      type="button"
      aria-label="Sync inspector"
      aria-expanded={open}
      title="Round trip to the server. Open the sync inspector"
      onClick={onToggle}
      className={`flex h-5 items-center gap-1 rounded px-1.5 tabular-nums transition hover:bg-raised hover:text-fg ${open ? "bg-raised text-fg" : ""}`}
    >
      <Activity size={12} />
      {latest ? duration(latest.ms) : "…"}
    </button>
  );
}

// one measurement: what it is, a line on what it means, and its value
function Reading({
  label,
  note,
  testId,
  children,
}: {
  label: string;
  note: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5">
      <dt>
        <span className="text-muted">{label}</span>
        <span className="mt-0.5 block text-[11px] text-faint">{note}</span>
      </dt>
      <dd data-testid={testId} className="shrink-0 font-medium tabular-nums">
        {children}
      </dd>
    </div>
  );
}

// this browser's connection to the room, measured live
export function SyncInspector({
  sync,
  status,
  onClose,
}: {
  sync: Sync;
  status: ConnectionStatus;
  onClose: () => void;
}) {
  const { roundTrips, waiting, lastConfirmedAt } = useSyncStats(sync);
  const now = useNow();
  const latest = roundTrips.at(-1);

  return (
    <aside
      aria-label="Sync inspector"
      className="flex w-72 shrink-0 flex-col border-l border-line bg-surface"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line pr-1.5 pl-3">
        <h2 className="text-xs font-semibold">Sync inspector</h2>
        <button
          type="button"
          aria-label="Close the sync inspector"
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded text-faint transition hover:bg-raised hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
      <dl className="divide-y divide-line text-xs">
        <Reading label="Connection" note="This browser's link to the room" testId="sync-connection">
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS[status].dot}`} />
            {STATUS[status].label}
          </span>
        </Reading>
        <Reading label="Round trip" note="A ping to the server and back" testId="sync-round-trip">
          {latest ? duration(latest.ms) : "Measuring…"}
        </Reading>
        <Reading
          label="Waiting"
          note="Your changes the server hasn't confirmed"
          testId="sync-waiting"
        >
          <span className={waiting > 0 ? "text-amber-300" : ""}>{changes(waiting)}</span>
        </Reading>
        <Reading
          label="Last confirmed"
          note="When the server last answered"
          testId="sync-last-confirmed"
        >
          {since(lastConfirmedAt, now)}
        </Reading>
      </dl>
    </aside>
  );
}
