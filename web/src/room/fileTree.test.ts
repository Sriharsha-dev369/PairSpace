// Spec for how the file list shows files: duplicate names told apart, and names with "/" grouped
// into folders. Folders exist only in the list; the room's document has files with names.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { RoomFile } from "./files";
import { displayNames, fileTree, type TreeNode } from "./fileTree";

const file = (id: string, name: string, createdAt = 0): RoomFile => ({
  id,
  name,
  createdAt,
  content: new Y.Text(),
});

describe("the name each file is shown with", () => {
  it("is its own name when nobody else has it", () => {
    const names = displayNames([file("a", "main.js"), file("b", "utils.js")]);

    expect([...names.values()]).toEqual(["main.js", "utils.js"]);
  });

  it("numbers later files with a name already taken, before the extension", () => {
    const names = displayNames([
      file("b", "utils.js", 2000),
      file("c", "utils.js", 3000),
      file("a", "utils.js", 1000),
    ]);

    expect(names.get("a")).toBe("utils.js"); // the first one made keeps it
    expect(names.get("b")).toBe("utils (2).js");
    expect(names.get("c")).toBe("utils (3).js");
  });

  it("numbers names without an extension at the end, and keeps their folders", () => {
    const names = displayNames([
      file("a", "README"),
      file("b", "README", 1),
      file("c", "src/app.js"),
      file("d", "src/app.js", 1),
      file("e", ".env"),
      file("f", ".env", 1),
    ]);

    expect([names.get("b"), names.get("d"), names.get("f")]).toEqual([
      "README (2)",
      "src/app (2).js",
      ".env (2)",
    ]);
  });

  it("never shows a name another file really has", () => {
    const names = displayNames([
      file("a", "utils.js", 1000),
      file("b", "utils.js", 2000),
      file("c", "utils (2).js", 500),
    ]);

    expect(names.get("b")).toBe("utils (3).js");
  });

  it("is the same for everyone when two files were made at the same moment", () => {
    const a = file("a", "utils.js", 1000);
    const b = file("b", "utils.js", 1000);

    expect(displayNames([a, b]).get("b")).toBe("utils (2).js");
    expect(displayNames([b, a]).get("b")).toBe("utils (2).js");
  });
});

// a tree as nested names, for comparing: folders as { name: children }
const shape = (nodes: TreeNode[]): unknown[] =>
  nodes.map((node) => (node.kind === "folder" ? { [node.name]: shape(node.children) } : node.name));

describe("the file tree", () => {
  it("groups files by folder, folders first, each in alphabetical order", () => {
    const tree = fileTree([
      file("1", "README.md"),
      file("2", "src/app.js"),
      file("3", "src/lib/math.ts"),
      file("4", "index.html"),
      file("5", "src/a.js"),
    ]);

    expect(shape(tree)).toEqual([
      { src: [{ lib: ["math.ts"] }, "a.js", "app.js"] },
      "index.html",
      "README.md",
    ]);
  });

  it("gives each folder its full path, and each file its shown name", () => {
    const [src] = fileTree([file("1", "src/lib/math.ts"), file("2", "src/lib/math.ts", 1)]);

    expect(src).toMatchObject({ kind: "folder", path: "src" });
    const [lib] = src.kind === "folder" ? src.children : [];
    expect(lib).toMatchObject({ kind: "folder", path: "src/lib" });
    expect(lib.kind === "folder" && shape(lib.children)).toEqual(["math (2).ts", "math.ts"]);
  });
});
