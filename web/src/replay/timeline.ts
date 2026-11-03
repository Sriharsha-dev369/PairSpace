import * as Y from "yjs";

// one saved change: the Yjs update, who made it (the name shown then; a member's id) and when
export interface Step {
  at: number;
  author: string | null; // null: the server's own (a room's first file)
  authorId: string | null;
  update: Uint8Array;
}

// as GET /api/rooms/:id/history sends it
export interface SavedStep {
  at: string;
  author: string | null;
  authorId: string | null;
  update: string; // base64
}

export function parseHistory(saved: SavedStep[]): Step[] {
  return saved.map(({ at, author, authorId, update }) => ({
    at: Date.parse(at),
    author,
    authorId,
    update: Uint8Array.from(atob(update), (char) => char.charCodeAt(0)),
  }));
}

// a jump replays at most this many changes on top of the nearest saved state of the room
const CHECKPOINT_EVERY = 50;

// the room at any step of its history: a fresh document with every change up to that step
export function createTimeline(steps: Step[]) {
  const working = new Y.Doc();
  const checkpoints = [Y.encodeStateAsUpdate(working)]; // [j]: after the first j * 50 changes
  steps.forEach((step, at) => {
    Y.applyUpdate(working, step.update);
    if ((at + 1) % CHECKPOINT_EVERY === 0) checkpoints.push(Y.encodeStateAsUpdate(working));
  });
  working.destroy();

  return {
    size: steps.length,
    steps,
    // the room once step `step` was made (0: the first change); the caller destroys it
    docAt(step: number): Y.Doc {
      const doc = new Y.Doc();
      const from = Math.floor((step + 1) / CHECKPOINT_EVERY);
      Y.applyUpdate(doc, checkpoints[from]);
      for (let at = from * CHECKPOINT_EVERY; at <= step; at++) Y.applyUpdate(doc, steps[at].update);
      return doc;
    },
  };
}

export type Timeline = ReturnType<typeof createTimeline>;
