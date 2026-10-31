import * as Y from "yjs";

// a new room's content: one empty main.js. The server makes it, not the first client: two
// clients opening a new room at once would each make one, and the shared map would keep only one
export function newRoomDocument(): Uint8Array {
  const doc = new Y.Doc();
  const file = new Y.Map<unknown>();
  file.set("name", "main.js");
  file.set("content", new Y.Text());
  doc.getMap("files").set(crypto.randomUUID(), file);
  return Y.encodeStateAsUpdate(doc);
}
