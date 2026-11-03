import { Activity, X } from "lucide-react";
import { type ReactNode, useId } from "react";
import { duration } from "../duration";
import { STATUS } from "../room/connectionStatus";
import type { ConnectionStatus, SessionSync } from "../room/session";
import { timeAgo } from "../timeAgo";
import { NETWORKS, type Network, SHAPES } from "./link";
import { MessageList } from "./MessageList";
import { RoundTripChart } from "./RoundTripChart";
import { useNow, useSync } from "./useSync";

const NAMES: Record<Network, string> = {
  normal: "Normal",
  slow: "Slow",
  "very-slow": "Very slow",
  flaky: "Flaky",
  offline: "Offline",
};

const seconds = (ms: number) => `${ms / 1000} s`;

// what choosing it does, from the link's own numbers: "0.5 s each way"
function effect(network: Network): string {
  if (network === "normal") return "Nothing added";
  if (network === "offline") return "No connection at all";
  const { delayMs, jitterMs, dropsEveryMs } = SHAPES[network];
  if (dropsEveryMs) return `Drops every ${dropsEveryMs[0] / 1000} to ${seconds(dropsEveryMs[1])}`;
  if (jitterMs === 0) return `${seconds(delayMs)} each way`;
  return `${delayMs / 1000} to ${seconds(delayMs + jitterMs)} each way, uneven`;
}

const changes = (n: number) => (n === 0 ? "None" : n === 1 ? "1 change" : `${n} changes`);

// seconds count here, so "3 s ago" until a minute, then "2 minutes ago"
function since(at: number | null, now: number): string {
  if (at === null) return "Not yet";
  const elapsed = Math.floor((now - at) / 1000);
  if (elapsed < 1) return "just now";
  return elapsed < 60 ? `${elapsed} s ago` : timeAgo(at, now);
}

// on someone else's chip: the bad network they're simulating, so their lag isn't taken for a bug
export function NetworkTag({ network }: { network: Network }) {
  return (
    <span
      data-testid="network-tag"
      title="Turned on in their sync inspector"
      className="rounded-full bg-amber-400/10 px-1.5 text-[10px] font-medium text-amber-300"
    >
      simulated {NAMES[network].toLowerCase()} network
    </span>
  );
}

// in the status bar: the latest round trip and any simulated network, and the way into the inspector
export function RoundTripButton({
  sync,
  open,
  onToggle,
}: {
  sync: SessionSync;
  open: boolean;
  onToggle: () => void;
}) {
  const { roundTrips, network } = useSync(sync);
  const latest = roundTrips.at(-1);
  return (
    <button
      type="button"
      aria-expanded={open}
      title="Round trip to the server. Open the sync inspector"
      onClick={onToggle}
      className={`flex h-5 items-center gap-1 rounded px-1.5 tabular-nums transition hover:bg-raised hover:text-fg ${open ? "bg-raised text-fg" : ""}`}
    >
      <Activity size={12} aria-hidden="true" />
      <span className="sr-only">Sync inspector, round trip</span>
      {latest ? duration(latest.ms) : "…"}
      {network !== "normal" && (
        <span className="rounded bg-amber-400/15 px-1 font-medium text-amber-300">
          {NAMES[network]}
        </span>
      )}
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

// the bad network to simulate, for this browser only
function NetworkChoice({
  network,
  onChoose,
}: {
  network: Network;
  onChoose: (network: Network) => void;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="border-t border-line px-3 py-3 text-xs">
      <h3 id={heading} className="text-muted">
        Simulate a network
      </h3>
      <p className="mt-0.5 text-[11px] text-faint">
        This browser only. Others see it on your name.
      </p>
      <div role="radiogroup" aria-labelledby={heading} className="mt-2 -mx-1.5">
        {NETWORKS.map((choice) => (
          <label
            key={choice}
            className="flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 transition hover:bg-raised has-checked:bg-raised"
          >
            <input
              type="radio"
              name="network"
              aria-label={NAMES[choice]}
              checked={network === choice}
              onChange={() => onChoose(choice)}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block font-medium">{NAMES[choice]}</span>
              <span className="block text-[11px] text-faint">{effect(choice)}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

// this browser's connection to the room, measured live, and a bad network to try it on
export function SyncInspector({
  sync,
  status,
  onClose,
}: {
  sync: SessionSync;
  status: ConnectionStatus;
  onClose: () => void;
}) {
  const { roundTrips, waiting, lastConfirmedAt, network } = useSync(sync);
  const now = useNow();
  const latest = roundTrips.at(-1);

  return (
    <aside
      aria-label="Sync inspector"
      className="flex w-full shrink-0 flex-col overflow-y-auto border-line bg-surface md:w-72 md:border-l"
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
      <RoundTripChart trips={roundTrips} now={now} />
      <NetworkChoice network={network} onChoose={sync.setNetwork} />
      <MessageList sync={sync} />
    </aside>
  );
}
