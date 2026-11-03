import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { DIALOG_OVERLAY } from "./styles";

const SIDES = {
  left: "inset-y-0 left-0 w-[min(85vw,20rem)] border-r",
  right: "inset-y-0 right-0 w-[min(85vw,20rem)] border-l",
  bottom: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t",
};

// beside the page on a wide screen; on a phone, a sheet sliding over it (closed unless open)
export function SidePanel({ phone, ...sheet }: Parameters<typeof Sheet>[0] & { phone: boolean }) {
  if (phone) return <Sheet {...sheet} />;
  return sheet.open ? sheet.children : null;
}

// a panel that slides over the page on phones (files, the menu, the inspector): it holds focus
// while open, and Escape or a tap outside closes it
export function Sheet({
  title,
  side,
  open,
  onOpenChange,
  children,
}: {
  title: string; // what screen readers call it
  side: keyof typeof SIDES;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={DIALOG_OVERLAY} />
        <Dialog.Content
          aria-describedby={undefined}
          className={`fixed flex flex-col overflow-y-auto border-line bg-surface shadow-2xl shadow-black/50 ${SIDES[side]}`}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
