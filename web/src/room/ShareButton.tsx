import { Check, Link2 } from "lucide-react";
import { useEffect, useState } from "react";

// the room link is the invite: anyone who opens it joins this room
export function ShareButton() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      // clipboard blocked: the link is still in the address bar
    }
  }

  return (
    <button
      type="button"
      onClick={copyLink}
      className="ml-1 flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-canvas transition hover:brightness-110 active:scale-[0.98]"
    >
      {copied ? <Check size={14} strokeWidth={2.5} /> : <Link2 size={14} strokeWidth={2.5} />}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
