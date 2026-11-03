import { Users } from "lucide-react";

// language: the open file's; none when no file is open
export function StatusBar({ peopleCount, language }: { peopleCount: number; language?: string }) {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-surface px-4 text-[11px] text-faint">
      <span className="flex items-center gap-1.5">
        <Users size={12} />
        {peopleCount === 1 ? "1 person here" : `${peopleCount} people here`}
      </span>
      {language && <span data-testid="language">{language}</span>}
    </footer>
  );
}
