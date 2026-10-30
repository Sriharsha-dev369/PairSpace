import { EditorState, type Extension } from "@codemirror/state";

interface Options {
  maxBytes: number;
  onRefused: (bytes: number) => void;
}

const utf8 = new TextEncoder(); // Yjs sends text as UTF-8, so that's the size that counts

// drops a typed, pasted or dropped change too large to sync, before it reaches Yjs
export function syncSizeLimit({ maxBytes, onRefused }: Options): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.isUserEvent("input")) return tr; // other people's changes arrive through Yjs, untagged
    let bytes = 0;
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      bytes += utf8.encode(inserted.toString()).length;
    });
    if (bytes <= maxBytes) return tr;
    onRefused(bytes);
    return [];
  });
}
