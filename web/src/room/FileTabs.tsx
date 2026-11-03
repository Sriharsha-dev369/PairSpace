import { X } from "lucide-react";
import { FileBadge } from "./FileBadge";
import type { RoomFile } from "./files";

interface Props {
  tabs: RoomFile[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

// the files this person has open, and which one they're looking at
export function FileTabs({ tabs, activeId, onSelect, onClose }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-line bg-surface px-2"
    >
      {tabs.map((file) => {
        const active = file.id === activeId;
        return (
          <div
            key={file.id}
            className={`relative flex h-full shrink-0 items-center border-x text-xs ${active ? "border-line bg-canvas text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {active && <span className="absolute inset-x-0 top-0 h-px bg-accent" />}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(file.id)}
              className="flex h-full items-center gap-2 pr-1.5 pl-3 focus-visible:outline-none"
            >
              <FileBadge name={file.name} />
              {file.name}
            </button>
            <button
              type="button"
              aria-label={`Close ${file.name}`}
              title="Close"
              onClick={() => onClose(file.id)}
              className="mr-1.5 grid h-5 w-5 place-items-center rounded text-faint transition hover:bg-raised hover:text-fg"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
