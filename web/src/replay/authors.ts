import * as Y from "yjs";
import { colorFor } from "../room/identity";
import type { Step } from "./timeline";

export interface Author {
  key: string; // one per person: a member's account, or a guest's name
  name: string;
  color: string;
}

// who made each Yjs client's changes. A client is one browser tab's session; every saved change
// says which clients' edits it holds, and its row says who saved it
export function authorsOf(steps: Step[]): Map<number, Author> {
  const authors = new Map<number, Author>();
  for (const step of steps) {
    if (step.author === null) continue; // the server's own changes (a room's first file): nobody's
    const author = {
      key: step.authorId ?? `guest:${step.author}`,
      name: step.author,
      color: colorFor(step.authorId ?? step.author),
    };
    for (const { id } of Y.decodeUpdate(step.update).structs) {
      if (!authors.has(id.client)) authors.set(id.client, author);
    }
  }
  return authors;
}

// a text as runs written by one person each, in order; deleted text isn't in it
export function runsOf(text: Y.Text, authors: Map<number, Author>) {
  const runs: { text: string; author: Author | null }[] = [];
  // Yjs keeps a text as a list of items, each added by one client (Yjs internals, read only)
  for (let item = text._start; item !== null; item = item.right) {
    if (item.deleted || !(item.content instanceof Y.ContentString)) continue;
    const author = authors.get(item.id.client) ?? null;
    const last = runs.at(-1);
    if (last && last.author?.key === author?.key) last.text += item.content.str;
    else runs.push({ text: item.content.str, author });
  }
  return runs;
}

// a pause longer than this plays as PAUSE_SHOWN_MS: a coffee break shouldn't take as long to watch
export const LONG_PAUSE_MS = 1500;
export const PAUSE_SHOWN_MS = 600;

// how long Play waits after showing `step` before the next one: as long as it took, short pauses
export function playbackDelay(steps: Step[], step: number): number {
  const gap = steps[step + 1].at - steps[step].at;
  return gap > LONG_PAUSE_MS ? PAUSE_SHOWN_MS : Math.max(gap, 0);
}
