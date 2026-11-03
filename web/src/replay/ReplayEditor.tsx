import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Decoration, EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef, useState } from "react";
import { editorTheme, language, useFileLanguage } from "../room/editorSetup";
import type { Author } from "./authors";

export type Run = { text: string; author: Author | null };

// who wrote what, tinted in their colour (and named, for screen readers and tests)
const credits = new Compartment();

function creditsFor(runs: Run[]) {
  const marks = new RangeSetBuilder<Decoration>();
  let at = 0;
  for (const { text, author } of runs) {
    if (author && text.length > 0) {
      marks.add(
        at,
        at + text.length,
        Decoration.mark({
          attributes: { "data-author": author.name, style: `background-color: ${author.color}30` },
        }),
      );
    }
    at += text.length;
  }
  return EditorView.decorations.of(marks.finish());
}

// a file as it was at a step, credited by who wrote it: read only, one view whose text is
// swapped as the step changes
export function ReplayEditor({ name, runs }: { name: string; runs: Run[] }) {
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
          credits.of([]),
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
    if (!view) return;
    const text = runs.map((run) => run.text).join("");
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      effects: credits.reconfigure(creditsFor(runs)),
    });
  }, [view, runs]);
  useFileLanguage(view, name);

  return <div ref={host} data-testid="replay-code" className="h-full" />;
}
