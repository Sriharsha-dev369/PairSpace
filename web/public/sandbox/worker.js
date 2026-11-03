// @ts-check
// Runs one program for the sandbox page (frame.js) and reports what it prints, then how it ended.
// A module worker (Pyodide needs one): the room page sends this file's text with each run, and
// the frame starts it from a data: URL, since its opaque origin can't load modules from us.
// Messages out: { type: "started" }, { type: "output", stream: "out" | "err", text },
// { type: "end", outcome: "done" | "failed", error? }.

/**
 * A room file; as JavaScript, with its imports' positions, to point them at the other modules here.
 * @typedef {{ path: string, source: string, imports: { start: number, end: number, path: string }[] }} Module
 * @typedef {{ language: "javascript" | "python", modules: Module[], entry: string }} Job
 */

/** @param {unknown} message */
const post = (message) => self.postMessage(message);

/** @param {unknown} value */
function format(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "bigint" || typeof value === "symbol") return value.toString();
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value); // e.g. an object that contains itself
  }
}

/** @param {"out" | "err"} stream @param {unknown[]} values */
const print = (stream, values) =>
  post({ type: "output", stream, text: `${values.map(format).join(" ")}\n` });

for (const [method, stream] of /** @type {const} */ ([
  ["log", "out"],
  ["info", "out"],
  ["debug", "out"],
  ["warn", "err"],
  ["error", "err"],
])) {
  console[method] = (...values) => print(stream, values);
}

// the program ends when its code has run and no timer is left to fire (as in Node)
/** @type {Set<number>} */
const timers = new Set();
let evaluated = false;
const endIfIdle = () => {
  if (evaluated && timers.size === 0) post({ type: "end", outcome: "done" });
};
const { setTimeout: later, clearTimeout: cancel, setInterval: every, clearInterval: stop } = self;
// timers given a function (a string of code, the old form, isn't supported)
self.setTimeout = /** @type {typeof setTimeout} */ (
  (run, ms, ...args) => {
    const id = later(() => {
      timers.delete(id);
      try {
        if (typeof run === "function") run(...args);
      } finally {
        endIfIdle();
      }
    }, ms);
    timers.add(id);
    return id;
  }
);
self.setInterval = /** @type {typeof setInterval} */ (
  (run, ms, ...args) => {
    const id = every(() => typeof run === "function" && run(...args), ms);
    timers.add(id);
    return id;
  }
);
self.clearTimeout = self.clearInterval = (id) => {
  if (id === undefined) return;
  timers.delete(id);
  cancel(id);
  stop(id);
  endIfIdle();
};

/** urls of the modules made from room files, so error locations can name the files instead */
const fileOf = new Map();

/** @param {unknown} error */
function describe(error) {
  if (!(error instanceof Error)) return format(error);
  let text = `${error.name}: ${error.message}`;
  const where = (error.stack ?? "").split("\n").flatMap((line) => {
    for (const [url, path] of fileOf) if (line.includes(url)) return [line.replace(url, path)];
    return [];
  });
  for (const line of where) text += `\n    ${line.trim().replace(/^at /, "at ")}`;
  return text;
}

/** @param {Module[]} modules (dependencies before what imports them) @param {string} entry */
async function runJavaScript(modules, entry) {
  const urlOf = new Map();
  for (const module of modules) {
    let source = module.source;
    // from the last import back, so earlier positions stay right
    for (const at of [...module.imports].sort((a, b) => b.start - a.start)) {
      source = source.slice(0, at.start) + urlOf.get(at.path) + source.slice(at.end);
    }
    // a data: URL, not a blob: one: Safari counts importing a blob from this opaque origin as
    // cross-origin and refuses it; data: is never cross-origin. The comment keeps two files with
    // the same code apart (the same URL would be one module)
    const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(`${source}\n// ${module.path}`)}`;
    urlOf.set(module.path, url);
    fileOf.set(url, module.path);
  }
  post({ type: "started" });
  await import(urlOf.get(entry));
  evaluated = true;
  endIfIdle();
}

self.addEventListener("error", (event) => {
  event.preventDefault();
  post({ type: "output", stream: "err", text: `${describe(event.error ?? event.message)}\n` });
});
self.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  post({
    type: "output",
    stream: "err",
    text: `Uncaught (in promise) ${describe(event.reason)}\n`,
  });
});

// Python: Pyodide (CPython compiled to WebAssembly), from its CDN, which allows any origin to
// load it (this one is opaque). Pinned: a new version is a deliberate change
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const ROOM = "/home/pyodide/room"; // the room's files, so `import utils` finds utils.py

/** @param {string} traceback Python's, trimmed to the room's own files */
function describePython(traceback) {
  const lines = traceback.trimEnd().split("\n");
  const kept = [];
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    if (!line.startsWith("  File ")) {
      if (!line.startsWith("    ")) kept.push(line); // the header and the error itself
    } else if (line.includes(`"${ROOM}/`)) {
      kept.push(line.replace(`${ROOM}/`, ""));
      if (lines[at + 1]?.startsWith("    ")) kept.push(lines[at + 1]); // the line of code
    }
  }
  return kept.join("\n");
}

/** @param {Module[]} files every Python file in the room @param {string} entry */
async function runPython(files, entry) {
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`);
  const pyodide = await loadPyodide({ indexURL: PYODIDE });
  pyodide.setStdout({
    batched: (/** @type {string} */ line) =>
      post({ type: "output", stream: "out", text: `${line}\n` }),
  });
  pyodide.setStderr({
    batched: (/** @type {string} */ line) =>
      post({ type: "output", stream: "err", text: `${line}\n` }),
  });
  pyodide.setStdin({ error: true }); // reading input isn't supported yet: it raises, not waits
  pyodide.runPython(
    'import builtins\ndef _input(prompt=""):\n    raise RuntimeError("input() isn\'t supported yet: put the value in the code")\nbuiltins.input = _input',
  );
  for (const file of files) {
    const path = `${ROOM}/${file.path}`;
    pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    pyodide.FS.writeFile(path, file.source);
  }
  pyodide.FS.chdir(ROOM);
  post({ type: "started" });
  try {
    await pyodide.runPythonAsync(
      `import runpy, sys\nsys.path.insert(0, ${JSON.stringify(ROOM)})\nrunpy.run_path(${JSON.stringify(`${ROOM}/${entry}`)}, run_name="__main__")`,
    );
  } catch (error) {
    throw new Error(describePython(error instanceof Error ? error.message : String(error)));
  }
  post({ type: "end", outcome: "done" });
}

self.onmessage = async (/** @type {MessageEvent<Job>} */ event) => {
  const { language, modules, entry } = event.data;
  try {
    if (language === "python") await runPython(modules, entry);
    else await runJavaScript(modules, entry);
  } catch (error) {
    const python = language === "python" && error instanceof Error;
    post({ type: "end", outcome: "failed", error: python ? error.message : describe(error) });
  }
};
