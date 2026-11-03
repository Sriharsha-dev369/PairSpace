import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { editorTheme, language, useFileLanguage } from "./editorSetup";
import type { RoomFile } from "./files";
import { syncSizeLimit } from "./syncSizeLimit";

// half the server's 2 MiB message limit: on reconnect, all offline edits travel in one message
const MAX_CHANGE_BYTES = 1024 * 1024;
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const refuseTooLarge = syncSizeLimit({
  maxBytes: MAX_CHANGE_BYTES,
  onRefused: (bytes) =>
    toast.error("That paste is too large to sync", {
      description: `It's ${megabytes(bytes)}; the limit is ${megabytes(MAX_CHANGE_BYTES)}. Paste it in smaller parts.`,
    }),
});

interface Props {
  file: RoomFile;
  awareness: Awareness;
  readOnly?: boolean; // a viewer: the server drops their changes anyway, so typing is switched off
  autoFocus?: boolean; // ready to type in as soon as it opens
}

export function Editor({ file, awareness, readOnly = false, autoFocus = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);

  useEffect(() => {
    if (!host.current) return;
    // per-person undo: only undoes your own edits, never someone else's
    const undoManager = new Y.UndoManager(file.content);
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: file.content.toString(),
        extensions: [
          keymap.of(yUndoManagerKeymap), // before basicSetup so it wins over its own history
          basicSetup,
          language.of([]),
          placeholder("Start typing. Everyone you share this room with sees it live."),
          refuseTooLarge,
          editorTheme, // before oneDark: earlier extensions take precedence
          oneDark,
          yCollab(file.content, awareness, { undoManager }),
          EditorState.readOnly.of(readOnly),
        ],
      }),
    });
    setView(created);
    if (autoFocus) created.focus();
    return () => {
      created.destroy();
      undoManager.destroy();
      setView(null);
      // the Yjs binding leaves my cursor where it was: everyone would still see it in this file
      awareness.setLocalStateField("cursor", null);
    };
  }, [file.content, awareness, readOnly, autoFocus]);

  useFileLanguage(view, file.name);

  return <div ref={host} className="h-full" />;
}
