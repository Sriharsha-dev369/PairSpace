import { useQuery } from "@tanstack/react-query";
import { Check, Link2, Loader2 } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { api } from "../api";

// the owner's way to invite: a link that lets anyone in to edit (guests need no account)
export function ShareButton({ roomId, title }: { roomId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // the same link each time (the server keeps one per room), so asking for it is safe to repeat
  const link = useQuery({
    queryKey: ["share-link", roomId],
    queryFn: () => api<{ code: string }>("POST", `/api/rooms/${roomId}/links`, { role: "editor" }),
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const url = link.data && `${window.location.origin}/join/${link.data.code}`;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

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
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/50">
          <Dialog.Title className="text-base font-semibold">Share “{title}”</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm leading-relaxed text-muted">
            Anyone with this link can join and edit. Guests don't need an account.
          </Dialog.Description>
          <div className="mt-5 flex gap-2">
            <input
              readOnly
              aria-label="Share link"
              value={url ?? ""}
              placeholder={link.isError ? "Couldn't make a link. Close and try again." : ""}
              onFocus={(event) => event.target.select()}
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 font-mono text-xs text-fg outline-none focus:border-accent/60"
            />
            <button
              type="button"
              onClick={copy}
              disabled={!url}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-canvas transition hover:brightness-110 disabled:opacity-60"
            >
              {!url && !link.isError ? (
                <Loader2 size={14} className="animate-spin" />
              ) : copied ? (
                <Check size={14} strokeWidth={2.5} />
              ) : (
                <Link2 size={14} strokeWidth={2.5} />
              )}
              {copied ? "Link copied" : "Copy link"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
