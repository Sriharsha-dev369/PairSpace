import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { SessionSync } from "../room/session";
import type { MessageKind, MessageLog } from "./messages";

const KINDS: Record<MessageKind, { name: string; note: string }> = {
  "handshake-1": {
    name: "Sync: what I have",
    note: "Sync step 1: a summary of every change this copy has (a state vector)",
  },
  "handshake-2": {
    name: "Sync: what you lack",
    note: "Sync step 2: the changes the other side's summary showed it was missing",
  },
  change: { name: "Change", note: "One edit, sent the moment it's made" },
  presence: { name: "Presence", note: "Names, colours and cursors (Yjs awareness)" },
  keepalive: {
    name: "Keepalive",
    note: "The server's regular 'still here', so a dead link is noticed",
  },
  ping: { name: "Ping", note: "Numbered: its pong times the round trip" },
  pong: { name: "Pong", note: "The server's answer to the ping with the same number" },
  other: { name: "Other", note: "A message this inspector doesn't know" },
};

const size = (bytes: number) => (bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`);

// "18:51:03.120": to the millisecond, since messages come close together
function clock(at: number) {
  const time = new Date(at);
  return `${time.toTimeString().slice(0, 8)}.${String(time.getMilliseconds()).padStart(3, "0")}`;
}

function useMessages(sync: SessionSync): MessageLog {
  const [log, setLog] = useState(() => sync.messages());

  useEffect(() => {
    setLog(sync.messages());
    return sync.watchMessages(() => setLog(sync.messages()));
  }, [sync]);

  return log;
}

// what crossed this browser's connection, newest first, like a network tab
export function MessageList({ sync }: { sync: SessionSync }) {
  const { recent, sent, received } = useMessages(sync);
  const heading = useId();

  return (
    <section aria-labelledby={heading} className="border-t border-line text-xs">
      <div className="px-3 pt-3">
        <h3 id={heading} className="text-muted">
          Messages
        </h3>
        <p data-testid="messages-total" className="mt-0.5 text-[11px] text-faint tabular-nums">
          Sent {sent.count} ({size(sent.bytes)}), received {received.count} ({size(received.bytes)})
        </p>
      </div>
      <ol aria-labelledby={heading} className="mt-2 max-h-72 overflow-y-auto pb-2">
        {[...recent].reverse().map((message) => {
          const kind = KINDS[message.kind];
          return (
            <li
              key={message.id}
              title={kind.note}
              className="flex items-center gap-2 px-3 py-[3px] text-[11px]"
            >
              {message.way === "out" ? (
                <ArrowUp size={11} className="shrink-0 text-muted" aria-hidden="true" />
              ) : (
                <ArrowDown size={11} className="shrink-0 text-muted" aria-hidden="true" />
              )}
              <span className="sr-only">{message.way === "out" ? "Sent" : "Received"}</span>
              <span className="min-w-0 flex-1 truncate">
                {kind.name}
                {message.number !== undefined && ` ${message.number}`}
              </span>
              <span className="text-faint tabular-nums">{size(message.bytes)}</span>
              <span className="w-[76px] text-right text-faint tabular-nums">
                {clock(message.at)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
