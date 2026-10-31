// Spec for the room store: how rooms are saved to and loaded from Postgres.
// Runs against the real test database; every test uses a fresh room name.

import { afterAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { openRoomStore } from "../src/room-store";
import { TEST_DATABASE_URL } from "./database";

const store = openRoomStore(TEST_DATABASE_URL);
afterAll(() => store.close());

const newRoom = () => `room-${crypto.randomUUID()}`;

// the Yjs changes made by typing each string in turn into one document
function changesTyping(...parts: string[]): Uint8Array[] {
  const doc = new Y.Doc();
  const changes: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => changes.push(update));
  for (const part of parts) doc.getText("t").insert(doc.getText("t").length, part);
  return changes;
}

async function loadText(room: string) {
  const state = await store.load(room);
  if (state === null) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc.getText("t").toString();
}

describe("room store", () => {
  it("has nothing for a room that was never saved", async () => {
    expect(await store.load(newRoom())).toBeNull();
  });

  it("loads back the changes saved for a room", async () => {
    const room = newRoom();
    for (const update of changesTyping("hello", " world")) {
      await store.append(room, [{ update, author: "Alice" }]);
    }

    expect(await loadText(room)).toBe("hello world");
  });

  it("keeps every change with its author and time, oldest first", async () => {
    const room = newRoom();
    const [a, b, c] = changesTyping("a", "b", "c");
    await store.append(room, [{ update: a, author: "Alice" }]);
    await store.append(room, [
      { update: b, author: null },
      { update: c, author: "Bob" },
    ]);

    const history = await store.history(room);

    expect(history.map((h) => h.author)).toEqual(["Alice", null, "Bob"]);
    expect(history.map((h) => [...h.update])).toEqual([[...a], [...b], [...c]]);
    for (const { at } of history) expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("keeps rooms apart", async () => {
    const [first, second] = [newRoom(), newRoom()];
    const [a] = changesTyping("only in the first");
    const [b] = changesTyping("only in the second");
    await store.append(first, [{ update: a, author: null }]);
    await store.append(second, [{ update: b, author: null }]);

    expect(await loadText(first)).toBe("only in the first");
    expect(await loadText(second)).toBe("only in the second");
  });
});
