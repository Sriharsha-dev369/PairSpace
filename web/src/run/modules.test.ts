// Spec for putting a JavaScript program together from the room's files: which files the open file
// imports (and they import), in an order where each comes after what it imports, with where each
// import's name sits in the code (the sandbox points it at the other file).

import { describe, expect, it } from "vitest";
import { javascriptModules } from "./modules";

const room = (files: Record<string, string>) =>
  Object.entries(files).map(([name, source]) => ({ name, source }));

// each import as the text it replaces and the file it points to
const imports = async (files: Record<string, string>, entry = "main.js") =>
  Object.fromEntries(
    (await javascriptModules(room(files), entry)).map((module) => [
      module.path,
      module.imports.map((at) => [module.source.slice(at.start, at.end), at.path]),
    ]),
  );

const order = async (files: Record<string, string>, entry = "main.js") =>
  (await javascriptModules(room(files), entry)).map((module) => module.path);

describe("putting a program together", () => {
  it("runs a file on its own as one module", async () => {
    expect(await imports({ "main.js": "console.log(1)" })).toEqual({ "main.js": [] });
  });

  it("points each import at the room file it names, and puts files after what they import", async () => {
    const files = {
      "main.js": 'import { twice } from "./lib/math.js";\nimport "./setup.js";',
      "lib/math.js": 'export { add } from "./add.js";\nexport const twice = (n) => n * 2;',
      "lib/add.js": "export const add = (a, b) => a + b;",
      "setup.js": "",
    };

    expect(await order(files)).toEqual(["lib/add.js", "lib/math.js", "setup.js", "main.js"]);
    expect(await imports(files)).toMatchObject({
      "main.js": [
        ["./lib/math.js", "lib/math.js"],
        ["./setup.js", "setup.js"],
      ],
      "lib/math.js": [["./add.js", "lib/add.js"]],
    });
  });

  it("follows ../, and names without .js or that are folders", async () => {
    const files = {
      "main.js": 'import "./lib/a.js";',
      "lib/a.js": 'import "../util";\nimport "./helpers";',
      "util.js": "",
      "lib/helpers/index.js": "",
    };

    expect((await imports(files))["lib/a.js"]).toEqual([
      ["../util", "util.js"],
      ["./helpers", "lib/helpers/index.js"],
    ]);
  });

  it("handles import() with a fixed name, and leaves import.meta and computed names alone", async () => {
    const files = {
      "main.js":
        'const lazy = await import("./lazy.js");\nconsole.log(import.meta.url);\nconst name = "x";\nawait import(name);',
      "lazy.js": "",
    };

    expect((await imports(files))["main.js"]).toEqual([["./lazy.js", "lazy.js"]]);
  });

  it("leaves out files the open file never reaches", async () => {
    expect(await order({ "main.js": 'import "./a.js";', "a.js": "", "unused.js": "" })).toEqual([
      "a.js",
      "main.js",
    ]);
  });

  it("leaves a file the scanner can't read to the browser, which says where it's wrong", async () => {
    expect(await imports({ "main.js": "const = 1;" })).toEqual({ "main.js": [] });
  });
});

describe("a program that can't be put together", () => {
  const problem = (files: Record<string, string>) =>
    javascriptModules(room(files), "main.js").then(
      () => null,
      (error: Error) => error.message,
    );

  it("says which import names a file that isn't there", async () => {
    expect(await problem({ "main.js": 'import "./lib/util.js";' })).toBe(
      "Can't find './lib/util.js', imported by main.js.",
    );
  });

  it("says packages can't be imported yet", async () => {
    expect(await problem({ "main.js": 'import _ from "lodash";' })).toBe(
      "main.js imports 'lodash', a package: packages can't be imported yet. Import the room's own files with ./",
    );
  });

  it("says when files import each other in a circle", async () => {
    expect(await problem({ "main.js": 'import "./a.js";', "a.js": 'import "./main.js";' })).toBe(
      "main.js and a.js import each other: a circle of imports can't run yet.",
    );
    expect(
      await problem({
        "main.js": 'import "./a.js";',
        "a.js": 'import "./b.js";',
        "b.js": 'import "./a.js";',
      }),
    ).toBe("a.js and b.js import each other: a circle of imports can't run yet.");
  });

  it("says only JavaScript files can be imported", async () => {
    expect(await problem({ "main.js": 'import data from "./data.json";', "data.json": "{}" })).toBe(
      "main.js imports './data.json': only .js and .mjs files can be imported.",
    );
  });
});
