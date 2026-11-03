// Tailwind class lists that several components share, so they can't drift apart

// a quiet text button in a page header (sign in, sign out)
export const HEADER_BUTTON =
  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-fg";

// a dialog's dimmed backdrop, and its panel (each dialog adds its own width)
export const DIALOG_OVERLAY = "fixed inset-0 bg-black/60 backdrop-blur-[2px]";
export const DIALOG_PANEL =
  "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/50";
