import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Loader2 } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { api, type LinkRole } from "../api";
import { DIALOG_OVERLAY, DIALOG_PANEL } from "../ui/styles";

interface ShareLink {
  code: string;
  role: LinkRole;
}

const ROWS: { role: LinkRole; label: string; help: string }[] = [
  { role: "editor", label: "Can edit", help: "Anyone with this link joins and edits." },
  { role: "viewer", label: "Can view", help: "Anyone with this link watches, but can't type." },
];

const SMALL_BUTTON =
  "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// the owner's way to invite: an edit link and a view link, each copyable and revocable
export function ShareButton({ roomId, title }: { roomId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const key = ["share-links", roomId];
  const links = useQuery({
    queryKey: key,
    enabled: open,
    // links exist only when the owner makes them: a turned-off link stays off
    queryFn: () => api<ShareLink[]>("GET", `/api/rooms/${roomId}/links`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="ml-1 flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-canvas transition hover:brightness-110 active:scale-[0.98]"
        >
          <Link2 size={14} strokeWidth={2.5} />
          Share
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content className={`${DIALOG_PANEL} w-[min(92vw,34rem)]`}>
          <Dialog.Title className="text-base font-semibold">Share “{title}”</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm leading-relaxed text-muted">
            Guests don't need an account. Turning a link off removes everyone who came in with it.
          </Dialog.Description>
          <div className="mt-5 flex flex-col divide-y divide-line">
            {ROWS.map((row) => (
              <LinkRow
                key={row.role}
                roomId={roomId}
                {...row}
                link={links.data?.find((link) => link.role === row.role)}
                loading={links.isPending}
                onChanged={refresh}
              />
            ))}
          </div>
          {links.isError && (
            <p role="alert" className="mt-3 text-xs text-red-300">
              Couldn't load the links. Close and try again.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LinkRow({
  roomId,
  role,
  label,
  help,
  link,
  loading,
  onChanged,
}: {
  roomId: string;
  role: LinkRole;
  label: string;
  help: string;
  link?: ShareLink;
  loading: boolean;
  onChanged: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const create = useMutation({
    mutationFn: () => api("POST", `/api/rooms/${roomId}/links`, { role }),
    onSuccess: onChanged,
  });
  const turnOff = useMutation({
    mutationFn: (code: string) => api("DELETE", `/api/rooms/${roomId}/links/${code}`),
    onSuccess: () => {
      setConfirming(false);
      onChanged();
    },
  });
  const url = link && `${window.location.origin}/join/${link.code}`;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000); // asking again later starts over
    return () => clearTimeout(timer);
  }, [confirming]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // clipboard blocked: the link is selectable in the field
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of controls for one link, named by its role
    <div role="group" aria-label={label} className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted">{help}</span>
      </div>
      {url ? (
        <div className="mt-2.5 flex gap-2">
          <input
            readOnly
            aria-label={`${label} link`}
            value={url}
            onFocus={(event) => event.target.select()}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 font-mono text-xs text-fg outline-none focus:border-accent/60"
          />
          <button
            type="button"
            onClick={copy}
            className={`${SMALL_BUTTON} bg-accent text-canvas hover:brightness-110`}
          >
            {copied ? <Check size={14} strokeWidth={2.5} /> : <Link2 size={14} strokeWidth={2.5} />}
            {copied ? "Link copied" : "Copy link"}
          </button>
          <button
            type="button"
            disabled={turnOff.isPending}
            onClick={() => (confirming && link ? turnOff.mutate(link.code) : setConfirming(true))}
            className={`${SMALL_BUTTON} ${confirming ? "bg-red-500 text-white hover:bg-red-400" : "text-muted hover:bg-raised hover:text-red-300"}`}
          >
            {confirming ? "Turn off for everyone" : "Turn off"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={loading || create.isPending}
          onClick={() => create.mutate()}
          className={`${SMALL_BUTTON} mt-2.5 border border-line text-fg hover:bg-raised`}
        >
          {(loading || create.isPending) && <Loader2 size={14} className="animate-spin" />}
          Create link
        </button>
      )}
    </div>
  );
}
