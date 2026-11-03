import { useEffect, useState } from "react";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { Editor } from "../room/Editor";
import type { RoomFile } from "../room/session";

const LATENCY_MS = 80; // one trip across a typical network, between the two documents
const NETWORK = Symbol("network"); // marks changes that arrived from the other document
const GRACE = { name: "Grace", color: "#34d399" };
const YOU = { name: "You", color: "#60a5fa" };
const OPENING = "// This is the real PairSpace editor. Type anywhere in it.\n\n";
// ends on the last line, so her name sits over the blank line above, not over her code
// biome-ignore lint/suspicious/noTemplateCurlyInString: it's the code she types, a template literal
const SHE_WRITES = 'function greet(name) {\n  return `Hello, ${name}!`;\n}\n\ngreet("everyone");';

interface Demo {
  file: RoomFile;
  awareness: Awareness;
  stop(): void;
}

// two documents in this page, joined by a pretend network: yours, and Grace's, who types a
// small function. Both are real Yjs documents, so your edits merge with hers as in a room
function startDemo(): Demo {
  const mine = new Y.Doc();
  const hers = new Y.Doc();
  const myAwareness = new Awareness(mine);
  const herAwareness = new Awareness(hers);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };

  const link = (from: Y.Doc, to: Y.Doc) =>
    from.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== NETWORK) later(() => Y.applyUpdate(to, update, NETWORK), LATENCY_MS);
    });
  link(mine, hers);
  link(hers, mine);
  herAwareness.on("update", ({ added, updated, removed }: Record<string, number[]>) => {
    const update = encodeAwarenessUpdate(herAwareness, [...added, ...updated, ...removed]);
    later(() => applyAwarenessUpdate(myAwareness, update, NETWORK), LATENCY_MS);
  });

  const herText = hers.getText("code");
  herText.insert(0, OPENING);
  Y.applyUpdate(mine, Y.encodeStateAsUpdate(hers), NETWORK); // both start from the same text
  myAwareness.setLocalStateField("user", { ...YOU, colorLight: `${YOU.color}33` });
  herAwareness.setLocalStateField("user", { ...GRACE, colorLight: `${GRACE.color}33` });

  // she types at her own spot, held as a relative position, so your edits never move her
  let at = Y.createRelativePositionFromTypeIndex(herText, herText.length, -1);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const typeFrom = (i: number) => {
    if (i >= SHE_WRITES.length) return;
    const index = Y.createAbsolutePositionFromRelativePosition(at, hers)?.index ?? herText.length;
    const typed = reducedMotion ? SHE_WRITES.slice(i) : SHE_WRITES[i];
    herText.insert(index, typed);
    at = Y.createRelativePositionFromTypeIndex(herText, index + typed.length, -1);
    herAwareness.setLocalStateField("cursor", { anchor: at, head: at });
    if (!reducedMotion)
      later(() => typeFrom(i + 1), typed === "\n" ? 280 : 45 + Math.random() * 75);
  };
  later(() => typeFrom(0), 900);

  return {
    file: { id: "demo", name: "main.js", content: mine.getText("code") },
    awareness: myAwareness,
    stop: () => {
      for (const timer of timers) clearTimeout(timer);
      myAwareness.destroy();
      herAwareness.destroy();
      mine.destroy();
      hers.destroy();
    },
  };
}

function Chip({ name, color }: { name: string; color: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line bg-raised py-0.5 pr-2.5 pl-0.5 text-xs">
      <span
        aria-hidden="true"
        className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-canvas"
        style={{ backgroundColor: color }}
      >
        {name[0]}
      </span>
      <span className="font-medium">{name}</span>
    </span>
  );
}

// the product, working: a room's editor with a second person in it
export function LiveDemo() {
  const [demo, setDemo] = useState<Demo | null>(null);
  useEffect(() => {
    const started = startDemo();
    setDemo(started);
    return () => started.stop();
  }, []);

  return (
    <figure data-testid="live-demo">
      <div className="overflow-hidden rounded-2xl border border-line bg-canvas shadow-[0_40px_120px_-40px_rgb(139_140_255/0.25)]">
        <div className="flex h-12 items-center gap-3 border-b border-line bg-surface px-4">
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className="rounded bg-[#f7df1e]/90 px-1 text-[9px] font-bold text-black">JS</span>
            main.js
          </span>
          <span className="ml-auto flex items-center gap-2">
            <Chip name="Grace" color={GRACE.color} />
            <Chip name="You" color={YOU.color} />
            <span className="ml-1 hidden items-center gap-1.5 text-xs text-muted sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" />
              Connected
            </span>
          </span>
        </div>
        <div className="h-[300px]">
          {demo && <Editor file={demo.file} awareness={demo.awareness} />}
        </div>
      </div>
      <figcaption className="mt-4 max-w-xl text-sm text-muted">
        This is the real editor, running in your browser. Type anywhere: Grace keeps writing, and
        your edits merge with hers.
      </figcaption>
    </figure>
  );
}
