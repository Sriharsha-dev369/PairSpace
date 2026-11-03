// Spec for a room's files: listing, creating and renaming them in the shared Yjs document.
// Two in-memory documents stand in for two people; `sync` delivers what each has to the other.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createFile,
  deleteFile,
  fileNameProblem,
  listFiles,
  listTrash,
  renameFile,
  restoreFile,
} from "./files";

// a room as the server makes it: one empty main.js
function newRoom(): Y.Doc {
  const doc = new Y.Doc();
  const file = new Y.Map<unknown>();
  file.set("name", "main.js");
  file.set("content", new Y.Text());
  doc.getMap("files").set("first", file);
  return doc;
}

// two people in the same room
function twoPeople(): [Y.Doc, Y.Doc] {
  const alice = newRoom();
  const bob = new Y.Doc();
  sync(alice, bob);
  return [alice, bob];
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

const names = (doc: Y.Doc) => listFiles(doc).map((file) => file.name);

describe("a room's files", () => {
  it("lists them by name", () => {
    const doc = newRoom();
    createFile(doc, "utils.js");
    createFile(doc, "app.js");

    expect(names(doc)).toEqual(["app.js", "main.js", "utils.js"]);
  });

  it("creates an empty file that reaches everyone in the room", () => {
    const [alice, bob] = twoPeople();

    const id = createFile(alice, "utils.js");
    sync(alice, bob);

    const theirs = listFiles(bob).find((file) => file.id === id);
    expect(theirs?.name).toBe("utils.js");
    expect(theirs?.content.toString()).toBe("");
  });

  it("renames a file for everyone, keeping what's in it", () => {
    const [alice, bob] = twoPeople();
    const [main] = listFiles(alice);
    main.content.insert(0, "console.log(1);");

    renameFile(alice, main.id, "index.js");
    sync(alice, bob);

    expect(names(bob)).toEqual(["index.js"]);
    expect(listFiles(bob)[0].content.toString()).toBe("console.log(1);");
  });

  it("ends with one name for everyone when two people rename a file at the same moment", () => {
    const [alice, bob] = twoPeople();
    const fileId = listFiles(alice)[0].id;

    renameFile(alice, fileId, "alice.js");
    renameFile(bob, fileId, "bob.js");
    sync(alice, bob);

    expect(names(alice)).toHaveLength(1);
    expect(names(alice)).toEqual(names(bob));
  });

  it("remembers when each file was made; a room's first file counts as oldest", () => {
    const doc = newRoom();
    const id = createFile(doc, "utils.js", 5000);

    expect(listFiles(doc).map((file) => [file.name, file.createdAt])).toEqual([
      ["main.js", 0],
      ["utils.js", 5000],
    ]);
    expect(listFiles(doc).find((file) => file.id === id)?.createdAt).toBe(5000);
  });

  it("keeps both files when two people make one name at the same moment", () => {
    const [alice, bob] = twoPeople();

    createFile(alice, "utils.js", 1000);
    createFile(bob, "utils.js", 2000);
    sync(alice, bob);

    expect(names(alice)).toEqual(["main.js", "utils.js", "utils.js"]);
    expect(listFiles(alice).map((file) => file.createdAt)).toEqual([0, 1000, 2000]);
  });

  it("lets a file keep its own name", () => {
    const doc = newRoom();
    const [main] = listFiles(doc);

    expect(() => renameFile(doc, main.id, "main.js")).not.toThrow();
  });

  it("refuses to create or rename to a name that breaks the rules", () => {
    const doc = newRoom();
    const [main] = listFiles(doc);

    expect(() => createFile(doc, "main.js")).toThrow("already a file");
    expect(() => renameFile(doc, main.id, "../main.js")).toThrow();
    expect(names(doc)).toEqual(["main.js"]);
  });
});

describe("the trash", () => {
  it("takes a deleted file out of the list for everyone, and keeps it, contents and all", () => {
    const [alice, bob] = twoPeople();
    const [main] = listFiles(alice);
    main.content.insert(0, "keep me");

    deleteFile(alice, main.id, "Alice");
    sync(alice, bob);

    expect(names(bob)).toEqual([]);
    const [trashed] = listTrash(bob);
    expect(trashed).toMatchObject({ id: main.id, name: "main.js", deletedBy: "Alice" });
    expect(trashed.content.toString()).toBe("keep me");
  });

  it("lists the trash newest first", () => {
    const doc = newRoom();
    const first = createFile(doc, "a.js");
    const second = createFile(doc, "b.js");

    deleteFile(doc, first, "Alice", 1000);
    deleteFile(doc, second, "Alice", 2000);

    expect(listTrash(doc).map((file) => file.name)).toEqual(["b.js", "a.js"]);
  });

  it("brings a restored file back for everyone", () => {
    const [alice, bob] = twoPeople();
    const [main] = listFiles(alice);
    deleteFile(alice, main.id, "Alice");
    sync(alice, bob);

    restoreFile(bob, main.id);
    sync(alice, bob);

    expect(names(alice)).toEqual(["main.js"]);
    expect(listTrash(alice)).toEqual([]);
  });

  it("frees a deleted file's name for a new file", () => {
    const doc = newRoom();
    deleteFile(doc, listFiles(doc)[0].id, "Alice");

    expect(() => createFile(doc, "main.js")).not.toThrow();
  });

  // M6's done-when: one person deletes a file while another is typing in it
  it("keeps what someone typed into a file at the moment it was deleted, and it comes back with it", () => {
    const [alice, bob] = twoPeople();
    const fileId = listFiles(alice)[0].id;

    // at the same moment, before either hears of the other: alice deletes, bob types
    deleteFile(alice, fileId, "Alice");
    listFiles(bob)[0].content.insert(0, "bob's work");
    sync(alice, bob);

    expect(names(alice)).toEqual([]);
    expect(names(bob)).toEqual([]);
    expect(listTrash(alice)[0].content.toString()).toBe("bob's work");
    restoreFile(alice, fileId);
    sync(alice, bob);
    expect(listFiles(bob)[0].content.toString()).toBe("bob's work");
  });

  it("puts a file renamed at the moment it was deleted in the trash under its new name", () => {
    const [alice, bob] = twoPeople();
    const fileId = listFiles(alice)[0].id;

    deleteFile(alice, fileId, "Alice");
    renameFile(bob, fileId, "index.js");
    sync(alice, bob);

    expect(listTrash(alice).map((file) => file.name)).toEqual(["index.js"]);
    expect(listTrash(bob).map((file) => file.name)).toEqual(["index.js"]);
  });

  it("ends the same for everyone when one person restores a file as another deletes it", () => {
    const [alice, bob] = twoPeople();
    const fileId = createFile(alice, "utils.js");
    deleteFile(alice, fileId, "Alice");
    sync(alice, bob);

    restoreFile(alice, fileId);
    deleteFile(bob, fileId, "Bob");
    sync(alice, bob);

    expect(names(alice)).toEqual(names(bob));
    expect(listTrash(alice).map((file) => file.id)).toEqual(listTrash(bob).map((file) => file.id));
  });
});

describe("file names", () => {
  const taken = ["main.js", "src/app.js"];

  it("accepts plain names and names with folders", () => {
    for (const name of ["utils.js", "README", "src/lib/math.ts", "a".repeat(100), "my file.py"]) {
      expect(fileNameProblem(name, taken), name).toBeNull();
    }
  });

  it("says what's wrong with a name, so it can be fixed", () => {
    expect(fileNameProblem("", taken)).toMatch(/name/);
    expect(fileNameProblem("a".repeat(101), taken)).toMatch(/100 characters/);
    expect(fileNameProblem(" main.py", taken)).toMatch(/space/);
    expect(fileNameProblem("main.js", taken)).toMatch(/already a file/);
    expect(fileNameProblem("src/app.js", taken)).toMatch(/already a file/);
    for (const name of ["/main.py", "src/", "src//app.py", "../x.py", "src/./x.py", "a/../b"]) {
      expect(fileNameProblem(name, taken), name).toMatch(/folder/);
    }
  });

  it("treats names that differ only in case as different files", () => {
    expect(fileNameProblem("Main.js", taken)).toBeNull();
  });
});
