export function FileTabs({ fileName }: { fileName: string }) {
  return (
    <div className="flex h-9 shrink-0 items-end border-b border-line bg-surface px-2">
      <span className="relative flex h-full items-center gap-2 border-x border-line bg-canvas px-3 text-xs">
        <span className="absolute inset-x-0 top-0 h-px bg-accent" />
        <span className="rounded-sm bg-yellow-300/90 px-1 font-mono text-[9px] font-bold text-canvas">
          JS
        </span>
        {fileName}
      </span>
    </div>
  );
}
