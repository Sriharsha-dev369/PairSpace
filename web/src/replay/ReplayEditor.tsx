import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef, useState } from "react";
import { editorTheme, language, useFileLanguage } from "../room/editorSetup";

// a file as it was at a step: read only, one view whose text is swapped as the step changes
export function ReplayEditor({ name, text }: { name: string; text: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        extensions: [
          basicSetup,
          language.of([]),
          editorTheme,
          oneDark,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    });
    setView(created);
    return () => created.destroy();
  }, []);

  useEffect(() => {
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, [view, text]);
  useFileLanguage(view, name);

  return <div ref={host} data-testid="replay-code" className="h-full" />;
}
