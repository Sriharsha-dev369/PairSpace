import type { ConnectionStatus, Person } from "./session";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  disconnected: "Offline",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-400",
  connecting: "bg-amber-400",
  disconnected: "bg-red-400",
};

interface Props {
  fileName: string;
  status: ConnectionStatus;
  people: Person[];
}

function Avatar({ person, testId }: { person: Person; testId: string }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-xs font-medium text-gray-950"
      style={{ backgroundColor: person.color }}
      data-testid={testId}
    >
      {person.name}
    </span>
  );
}

export function RoomHeader({ fileName, status, people }: Props) {
  const me = people.find((p) => p.isMe);
  const others = people.filter((p) => !p.isMe);

  return (
    <header className="flex items-center gap-3 border-b border-gray-800 px-4 py-2">
      <span className="font-semibold tracking-tight">PairSpace</span>
      <span className="text-sm text-gray-500">{fileName}</span>
      <div className="ml-auto flex items-center gap-2">
        {others.map((person) => (
          <Avatar key={person.id} person={person} testId="other-person" />
        ))}
        {me && <Avatar person={me} testId="my-name" />}
        <span className="ml-2 flex items-center gap-1.5 text-xs text-gray-400">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
          <span data-testid="connection-status">{STATUS_LABEL[status]}</span>
        </span>
      </div>
    </header>
  );
}
