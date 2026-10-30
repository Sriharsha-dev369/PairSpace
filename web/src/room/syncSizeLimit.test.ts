// Spec for the editor's sync size limit: which changes it refuses before they reach Yjs.
// Runs on a bare CodeMirror state, no browser.

import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { syncSizeLimit } from "./syncSizeLimit";

function editorWithLimit(maxBytes: number) {
  const refused: number[] = [];
  const state = EditorState.create({
    extensions: syncSizeLimit({ maxBytes, onRefused: (bytes) => refused.push(bytes) }),
  });
  // userEvent: how CodeMirror tags what a person did; changes from Yjs (other people) carry none
  const insert = (text: string, userEvent?: string) =>
    state.update({ changes: { from: 0, insert: text }, userEvent }).state.doc.toString();
  return { insert, refused };
}

describe("sync size limit", () => {
  it("refuses a paste too large to sync, and reports its size", () => {
    const editor = editorWithLimit(1000);

    expect(editor.insert("x".repeat(1001), "input.paste")).toBe("");
    expect(editor.refused).toEqual([1001]);
  });

  it("accepts a change exactly at the limit", () => {
    const editor = editorWithLimit(1000);

    expect(editor.insert("x".repeat(1000), "input.paste")).toHaveLength(1000);
    expect(editor.refused).toEqual([]);
  });

  it("counts bytes as sent, not characters", () => {
    const editor = editorWithLimit(1000);

    expect(editor.insert("é".repeat(501), "input.type")).toBe(""); // 501 characters, 1002 bytes
    expect(editor.refused).toEqual([1002]);
  });

  it("leaves changes from other people alone, whatever their size", () => {
    const editor = editorWithLimit(1000);

    expect(editor.insert("x".repeat(2000))).toHaveLength(2000);
    expect(editor.refused).toEqual([]);
  });
});
