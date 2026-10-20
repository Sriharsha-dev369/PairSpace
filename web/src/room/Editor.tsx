import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { RoomFile } from "./session";

interface Props {
  file: RoomFile;
  awareness: Awareness;
}

export function Editor({ file, awareness }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    // per-person undo: only undoes your own edits, never someone else's
    const undoManager = new Y.UndoManager(file.content);
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: file.content.toString(),
        extensions: [
          keymap.of(yUndoManagerKeymap), // before basicSetup so it wins over its own history
          basicSetup,
          javascript(),
          oneDark,
          EditorView.theme({ "&": { height: "100%" }, ".cm-scroller": { overflow: "auto" } }),
          yCollab(file.content, awareness, { undoManager }),
        ],
      }),
    });
    return () => {
      view.destroy();
      undoManager.destroy();
    };
  }, [file.content, awareness]);

  return <div ref={host} className="h-full" />;
}
