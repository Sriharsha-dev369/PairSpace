import { languageOf } from "./language";

const TONES: Record<string, string> = {
  JavaScript: "bg-yellow-300/90 text-canvas",
  JSX: "bg-yellow-300/90 text-canvas",
  TypeScript: "bg-sky-400/90 text-canvas",
  TSX: "bg-sky-400/90 text-canvas",
  Python: "bg-blue-400/90 text-canvas",
  HTML: "bg-orange-400/90 text-canvas",
  CSS: "bg-violet-400/90 text-canvas",
  JSON: "bg-lime-300/90 text-canvas",
  Markdown: "bg-slate-300/90 text-canvas",
};

// a file's type at a glance: its extension, in its language's colour
export function FileBadge({ name }: { name: string }) {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const label = dot > 0 ? base.slice(dot + 1, dot + 5).toUpperCase() : "TXT";
  const tone = TONES[languageOf(name)?.name ?? ""] ?? "bg-line text-muted";
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 rounded-sm px-1 font-mono text-[9px] leading-[14px] font-bold ${tone}`}
    >
      {label}
    </span>
  );
}
