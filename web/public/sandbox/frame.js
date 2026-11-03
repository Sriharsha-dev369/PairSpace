// @ts-check
// The sandbox page. The room page frames it with sandbox="allow-scripts" (and not
// allow-same-origin), which gives it an opaque origin: code run here can't send PairSpace's
// cookies or call its API as whoever pressed Run. The code runs in a Web Worker, so an endless
// loop never blocks a page; the room page ends a run by removing this frame, which ends the worker.
// Plain JS on purpose: an opaque origin can't load module scripts or fetch our files without CORS
// headers, but classic scripts and importScripts need none.

(() => {
  if (self.origin !== "null") {
    document.body.textContent = "This page only runs inside PairSpace's sandbox.";
    return;
  }

  // the parent is the room page, and the output is its own code's: any parent may hear it
  /** @param {unknown} message */
  const send = (message) => window.parent.postMessage(message, "*");

  /** @param {unknown} job */
  function run(job) {
    // a worker must come from this (opaque) origin: a blob made here, which loads the real script
    const workerUrl = new URL("./worker.js", location.href).href;
    const bootstrap = `importScripts(${JSON.stringify(workerUrl)});`;
    const worker = new Worker(
      URL.createObjectURL(new Blob([bootstrap], { type: "text/javascript" })),
    );
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
    if (event.source === window.parent && event.data?.type === "run") run(event.data.job);
  });

  send({ type: "ready" });
})();
