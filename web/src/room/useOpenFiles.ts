import { useEffect, useState } from "react";
import type { RoomFile } from "./files";
import type { RoomSession } from "./session";

interface Open {
  ids: string[]; // tabs, in the order they were opened
  active: string | null;
}

// the files this person has open as tabs, and the one they're in. Theirs alone, except that
// everyone else is shown which file they're in. Starts with the first file open
export function useOpenFiles(session: RoomSession, files: RoomFile[]) {
  const [open, setOpen] = useState<Open>(() => {
    const first = files[0]?.id;
    return { ids: first ? [first] : [], active: first ?? null };
  });
  const tabs = open.ids.flatMap((id) => files.filter((file) => file.id === id));
  const active = files.find((file) => file.id === open.active) ?? null;

  const activeId = active?.id ?? null;
  useEffect(() => session.setOpenFile(activeId), [session, activeId]);

  return {
    tabs,
    active,
    openFile: (id: string) =>
      setOpen(({ ids }) => ({ ids: ids.includes(id) ? ids : [...ids, id], active: id })),
    // closing the tab you're in moves you to its neighbour
    closeFile: (id: string) =>
      setOpen(({ ids, active }) => {
        const at = ids.indexOf(id);
        const left = ids.filter((other) => other !== id);
        return { ids: left, active: active === id ? (left[at] ?? left[at - 1] ?? null) : active };
      }),
  };
}
