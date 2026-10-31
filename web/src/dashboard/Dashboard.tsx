import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "../api";
import { SignOutButton } from "../auth/SignOutButton";
import type { Member } from "../auth/useMember";
import { Logo } from "../ui/Logo";
import { timeAgo } from "./timeAgo";

interface RoomSummary {
  id: string;
  title: string;
  lastEditedAt: string;
}

const HEADER_BUTTON =
  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-fg";

function IconButton({
  label,
  danger = false,
  ...props
}: ComponentProps<"button"> & { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded-lg text-faint transition hover:bg-raised ${danger ? "hover:text-red-300" : "hover:text-fg"}`}
      {...props}
    />
  );
}

function NewRoomButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-canvas transition hover:brightness-110 active:scale-[0.98] disabled:opacity-70"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} strokeWidth={2.5} />}
      New room
    </button>
  );
}

// a member's own rooms: open, create, rename, delete
export function Dashboard({ member }: { member: Member }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const roomsKey = ["rooms", member.id];
  const rooms = useQuery({
    queryKey: roomsKey,
    queryFn: () => api<RoomSummary[]>("GET", "/api/rooms"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: roomsKey });
  const create = useMutation({
    mutationFn: () => api<{ id: string }>("POST", "/api/rooms", {}),
    onSuccess: ({ id }) => navigate(`/r/${id}`),
    onError: () => toast.error("Couldn't create a room. Please try again."),
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,rgb(139_140_255/0.06),transparent_50%)]">
      <header className="flex h-12 items-center gap-3 border-b border-line bg-surface px-4">
        <Logo />
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 text-xs text-muted">{member.name}</span>
          <SignOutButton className={HEADER_BUTTON} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Your rooms</h1>
            <p className="mt-1 text-sm text-muted">
              Open one to code together, or start a new one and share its link.
            </p>
          </div>
          <NewRoomButton onClick={() => create.mutate()} busy={create.isPending} />
        </div>

        {rooms.isPending ? (
          <div className="mt-16 flex justify-center text-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : rooms.isError ? (
          <p className="mt-10 text-sm text-muted">
            Couldn't load your rooms.{" "}
            <button
              type="button"
              onClick={refresh}
              className="font-medium text-fg underline-offset-4 hover:underline"
            >
              Try again
            </button>
          </p>
        ) : rooms.data.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent">
              <FileCode2 size={20} />
            </span>
            <p className="mt-4 text-sm font-medium">No rooms yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted">
              Start one, then share its link: whoever opens it codes with you live.
            </p>
            <div className="mt-6">
              <NewRoomButton onClick={() => create.mutate()} busy={create.isPending} />
            </div>
          </div>
        ) : (
          <ul className="mt-8 flex flex-col gap-2">
            {rooms.data.map((room) => (
              <RoomRow key={room.id} room={room} onChanged={refresh} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function RoomRow({ room, onChanged }: { room: RoomSummary; onChanged: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const rename = useMutation({
    mutationFn: (title: string) => api("PATCH", `/api/rooms/${room.id}`, { title }),
    onSuccess: () => {
      setRenaming(false);
      onChanged();
    },
    onError: () => toast.error("Couldn't rename the room. Please try again."),
  });

  return (
    <li className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-accent/30">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-accent">
        <FileCode2 size={16} />
      </span>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <RenameField
            initial={room.title}
            onSave={(title) => (title === room.title ? setRenaming(false) : rename.mutate(title))}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <Link
            to={`/r/${room.id}`}
            className="block truncate text-sm font-medium transition hover:text-accent"
          >
            {room.title}
          </Link>
        )}
        <p className="mt-0.5 text-xs text-faint">Edited {timeAgo(room.lastEditedAt)}</p>
      </div>
      <IconButton label="Rename" onClick={() => setRenaming(true)}>
        <Pencil size={14} />
      </IconButton>
      <DeleteRoomButton room={room} onDeleted={onChanged} />
    </li>
  );
}

function RenameField({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const save = () => {
    const title = value.trim();
    if (title) onSave(title);
    else onCancel();
  };

  return (
    <input
      ref={input}
      aria-label="Room name"
      value={value}
      maxLength={80}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
        if (event.key === "Escape") onCancel();
      }}
      onBlur={save}
      className="h-7 w-full rounded-md border border-accent/50 bg-raised px-2 text-sm text-fg outline-none ring-2 ring-accent/20"
    />
  );
}

// deleting is for good, so it asks first
function DeleteRoomButton({ room, onDeleted }: { room: RoomSummary; onDeleted: () => void }) {
  const remove = useMutation({
    mutationFn: () => api("DELETE", `/api/rooms/${room.id}`),
    onSuccess: onDeleted,
    onError: () => toast.error("Couldn't delete the room. Please try again."),
  });

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <IconButton label="Delete" danger>
          <Trash2 size={14} />
        </IconButton>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/50">
          <AlertDialog.Title className="text-base font-semibold">
            Delete “{room.title}”?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-muted">
            The room and its whole history are removed for everyone, and anyone in it now is
            disconnected. This can't be undone.
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                className="h-9 rounded-lg px-3.5 text-sm font-medium text-muted transition hover:bg-raised hover:text-fg"
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                onClick={() => remove.mutate()}
                className="h-9 rounded-lg bg-red-500 px-3.5 text-sm font-semibold text-white transition hover:bg-red-400"
              >
                Delete room
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
