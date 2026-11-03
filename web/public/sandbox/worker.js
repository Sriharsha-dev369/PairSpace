// @ts-check
// Runs one program for the sandbox page (frame.js) and reports what it prints, then how it ended.
// Messages out: { type: "started" }, { type: "output", stream: "out" | "err", text },
// { type: "end", outcome: "done" | "failed", error? }.

/**
 * A room file as JavaScript: its imports' positions, to point them at the other modules here.
 * @typedef {{ path: string, source: string, imports: { start: number, end: number, path: string }[] }} Module
 * @typedef {{ language: "javascript", modules: Module[], entry: string }} Job
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
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
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

self.onmessage = async (/** @type {MessageEvent<Job>} */ event) => {
  const { modules, entry } = event.data;
  try {
    await runJavaScript(modules, entry);
  } catch (error) {
    post({ type: "end", outcome: "failed", error: describe(error) });
  }
};
