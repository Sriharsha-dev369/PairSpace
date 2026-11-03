// Spec for a room's files: listing, creating and renaming them in the shared Yjs document.
// Two in-memory documents stand in for two people; `sync` delivers what each has to the other.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createFile, fileNameProblem, listFiles, renameFile } from "./files";

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
