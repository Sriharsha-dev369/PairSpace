import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect } from "react";
import { languageOf } from "./language";

// what the room's editor and replay's share: the look, and the language from the file's name

// layered on top of oneDark: our colours and fonts, and name labels sitting exactly on cursors
export const editorTheme = EditorView.theme(
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
    // every remote cursor always shows whose it is (the library's default only shows it on hover)
    ".cm-ySelectionInfo": {
      opacity: "1",
      pointerEvents: "none", // the label must not swallow clicks on the code under it
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

// what a file's name decides, swapped in place when it changes (main.js to main.py): its language,
// and what screen readers call the editor
export const language = new Compartment();
export const label = new Compartment();

// a named, keyboard-reachable code area: even a read-only one must take focus, to scroll
const labelFor = (name: string) =>
  EditorView.contentAttributes.of({ "aria-label": `Code in ${name}`, tabindex: "0" });

// loads the language a file's name says (each language's code only when a file needs it)
export function useFileName(view: EditorView | null, name: string) {
  useEffect(() => {
    if (!view) return;
    view.dispatch({ effects: label.reconfigure(labelFor(name)) });
    let current = true;
    const use = (support: Extension) =>
      current && view.dispatch({ effects: language.reconfigure(support) });
    const description = languageOf(name);
    if (description) description.load().then(use);
    else use([]);
    return () => {
      current = false;
    };
  }, [view, name]);
}
