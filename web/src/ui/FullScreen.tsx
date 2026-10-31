import type { ReactNode } from "react";

// a centred page with the app's soft glow behind it: loading states, sign-in, refusals
export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,rgb(139_140_255/0.10),transparent_60%)] px-4 py-10">
      <div className="flex w-full flex-col items-center">{children}</div>
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-2xl shadow-black/40">
      {children}
    </div>
  );
}
