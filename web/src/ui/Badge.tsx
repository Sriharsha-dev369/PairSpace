import type { ReactNode } from "react";

// a short fact next to a name, like "View only"
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
      {children}
    </span>
  );
}
