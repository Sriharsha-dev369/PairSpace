// @ts-check
// The sandbox page. The room page frames it with sandbox="allow-scripts" (and not
// allow-same-origin), which gives it an opaque origin: code run here can't send PairSpace's
// cookies or call its API as whoever pressed Run. The code runs in a Web Worker, so an endless
// loop never blocks a page; the room page ends a run by removing this frame, which ends the worker.
// Plain JS on purpose: an opaque origin can't load module scripts or fetch our files without CORS
// headers, so this page is a classic script, and the room page sends the worker's code (worker.js)
// with each run.

(() => {
  if (self.origin !== "null") {
    document.body.textContent = "This page only runs inside PairSpace's sandbox.";
    return;
  }

  // the parent is the room page, and the output is its own code's: any parent may hear it
  /** @param {unknown} message */
  const send = (message) => window.parent.postMessage(message, "*");

  /** @param {unknown} job @param {string} code the worker's (worker.js) */
  function run(job, code) {
    // a module worker (Pyodide needs one) from a data: URL: in an opaque origin a module worker
    // can't come from our server (no CORS headers) nor from a blob (refused), but this works
    const worker = new Worker(`data:text/javascript,${encodeURIComponent(code)}`, {
      type: "module",
    });
    worker.onmessage = (event) => send(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      send({
        type: "end",
        outcome: "failed",
        error: event.message || "The program couldn't start.",
      });
    };
    worker.postMessage(job);
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source === window.parent && message?.type === "run") run(message.job, message.worker);
  });

  send({ type: "ready" });
})();
