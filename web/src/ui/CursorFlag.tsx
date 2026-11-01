// someone's caret with their name on it, as the editor draws remote cursors (for illustrations)
export function CursorFlag({ name, color }: { name: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block h-[1.25em] w-0.5 align-[-0.25em]"
      style={{ backgroundColor: color }}
    >
      <span
        className="absolute bottom-full left-0 rounded-t rounded-br px-1.5 font-sans text-[10.5px] leading-[15px] font-semibold whitespace-nowrap text-canvas"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </span>
  );
}
