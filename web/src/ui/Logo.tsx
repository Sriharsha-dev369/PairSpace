// two overlapping cursors: two people in one space
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ps-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5a6ff" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#ps-mark)" />
      <rect x="10" y="8" width="3" height="16" rx="1.5" fill="#0b0c10" />
      <rect x="19" y="8" width="3" height="16" rx="1.5" fill="#0b0c10" opacity="0.55" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-sm font-semibold tracking-tight">PairSpace</span>
    </span>
  );
}
