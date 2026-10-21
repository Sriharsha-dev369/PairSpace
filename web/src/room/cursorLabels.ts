import { ViewPlugin } from "@codemirror/view";
import type { Awareness } from "y-protocols/awareness";

const SHOW_MS = 2500; // how long a name label stays after its person last moved or typed

interface Changes {
  added: number[];
  updated: number[];
}

// shows a remote cursor's name label while that person is active, then lets it fade
// (y-codemirror's caret element doesn't say whose it is, so it's matched by the label's name)
export function cursorLabels(awareness: Awareness) {
  return ViewPlugin.define((view) => {
    const lastActive = new Map<string, number>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const apply = () => {
      const now = Date.now();
      for (const caret of view.dom.querySelectorAll(".cm-ySelectionCaret")) {
        const name = caret.querySelector(".cm-ySelectionInfo")?.textContent ?? "";
        const active = now - (lastActive.get(name) ?? 0) < SHOW_MS;
        caret.classList.toggle("cm-yActive", active);
      }
    };

    const onChange = ({ added, updated }: Changes) => {
      const now = Date.now();
      for (const id of [...added, ...updated]) {
        const name = awareness.getStates().get(id)?.user?.name;
        if (id !== awareness.clientID && name) lastActive.set(name, now);
      }
      queueMicrotask(apply); // after y-codemirror has redrawn the carets for this change
      const timer = setTimeout(() => {
        timers.delete(timer);
        apply();
      }, SHOW_MS);
      timers.add(timer);
    };
    awareness.on("change", onChange);

    return {
      update: () => queueMicrotask(apply), // redraws can replace caret elements, losing the class
      destroy: () => {
        awareness.off("change", onChange);
        for (const timer of timers) clearTimeout(timer);
      },
    };
  });
}
