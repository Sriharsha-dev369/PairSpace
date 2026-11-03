import { type Import, init, parse } from "es-module-lexer";
import type { Module } from "./sandbox";

interface Source {
  name: string;
  source: string;
}

// a program that can't be put together; the message says why, for the person who pressed Run
class ImportProblem extends Error {}

const RUNNABLE = /\.m?js$/;

// "lib/a.js" + "../util" -> "util"; null if it climbs out of the room
function join(from: string, specifier: string): string | null {
  const parts = specifier.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

// the room file an import names: as written, or with .js, .mjs or /index.js added
function resolve(specifier: string, from: string, names: Set<string>): string {
  if (!/^\.{0,2}\//.test(specifier)) {
    throw new ImportProblem(
      `${from} imports '${specifier}', a package: packages can't be imported yet. Import the room's own files with ./`,
    );
  }
  const base = join(from, specifier);
  const found = [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`].find(
    (name) => name !== null && names.has(name),
  );
  if (!found) throw new ImportProblem(`Can't find '${specifier}', imported by ${from}.`);
  if (!RUNNABLE.test(found)) {
    throw new ImportProblem(
      `${from} imports '${specifier}': only .js and .mjs files can be imported.`,
    );
  }
  return found;
}

function circle(files: string[]): ImportProblem {
  const said =
    files.length === 1
      ? `${files[0]} imports itself`
      : `${files.slice(0, -1).join(", ")} and ${files.at(-1)} import each other`;
  return new ImportProblem(`${said}: a circle of imports can't run yet.`);
}

// where a file's imports sit in its code, and which room files they name. A file the scanner can't
// read is left to the browser, which says exactly where it's wrong
function importsOf(path: string, source: string, names: Set<string>) {
  let found: readonly Import[];
  try {
    [found] = parse(source, path);
  } catch {
    return [];
  }
  return found.flatMap((at) => {
    // import.meta, or import() of a name worked out as it runs: nothing to point anywhere
    if (at.type === "import-meta" || at.specifier === undefined) return [];
    // in import("./x.js") the range includes the quotes; in import ... from "./x.js" it doesn't
    const quoted = at.type === "dynamic";
    return [
      {
        start: quoted ? at.start + 1 : at.start,
        end: quoted ? at.end - 1 : at.end,
        path: resolve(at.specifier, path, names),
      },
    ];
  });
}

// the program the open file starts: it and every room file it reaches through imports, each
// after the files it imports (the sandbox needs their addresses first). Throws, saying why, if
// an import names a missing file, a package or a non-JavaScript file, or files import in a circle
export async function javascriptModules(files: Source[], entry: string): Promise<Module[]> {
  await init; // the scanner is WebAssembly: ready once it has compiled
  const sources = new Map(files.map((file) => [file.name, file.source]));
  const names = new Set(sources.keys());
  const done = new Set<string>();
  const modules: Module[] = [];

  function visit(path: string, chain: string[]) {
    if (done.has(path)) return;
    if (chain.includes(path)) throw circle(chain.slice(chain.indexOf(path)));
    const source = sources.get(path) ?? "";
    const imports = importsOf(path, source, names);
    for (const target of imports) visit(target.path, [...chain, path]);
    done.add(path);
    modules.push({ path, source, imports });
  }

  visit(entry, []);
  return modules;
}
