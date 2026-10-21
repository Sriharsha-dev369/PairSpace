import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { RoomFile } from "./session";

// layered on top of oneDark: our colours and fonts, and always-visible name labels sitting exactly on cursors
const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "13.5px", backgroundColor: "var(--color-canvas)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.7" },
    ".cm-content": { padding: "20px 0" },
    ".cm-gutters": {
      backgroundColor: "var(--color-canvas)",
      color: "var(--color-faint)",
      border: "none",
      paddingLeft: "12px",
    },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-fg)" },
    // inline-block + 1lh: the caret spans the whole line, so the label can sit exactly on top of it
    ".cm-ySelectionCaret": { display: "inline-block", height: "1lh", verticalAlign: "top" },
    ".cm-ySelectionCaretDot": { display: "none" }, // the label already marks the cursor; the dot only flickered
    ".cm-ySelectionInfo": {
      opacity: "1",
      transition: "none",
      top: "-15px",
      height: "15px",
      lineHeight: "15px",
      padding: "0 6px",
      borderRadius: "4px 4px 4px 0",
      fontFamily: "var(--font-sans)",
      fontSize: "10.5px",
      fontWeight: "600",
      color: "var(--color-canvas)",
    },
  },
  { dark: true },
);

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
          placeholder("Start typing. Everyone with this room's link sees it live."),
          theme, // before oneDark: earlier extensions take precedence
          oneDark,
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
