import type { ReactNode } from "react";

const initials = (name: string) =>
  name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2);

// a person in the room: their initials in their colour, their name, then any notes ("you")
export function PersonChip({
  name,
  color,
  testId,
  children,
}: {
  name: string;
  color: string;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line bg-raised py-0.5 pr-2.5 pl-0.5 text-xs">
      <span
        className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-canvas"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      <span data-testid={testId} className="font-medium">
        {name}
      </span>
      {children}
    </span>
  );
}
