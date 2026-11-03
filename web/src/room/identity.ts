import { randomId } from "./randomId";
import type { User } from "./session";

// 256 names: two guests in one room rarely match (people are told apart by id anyway)
const ADJECTIVES = [
  "Swift",
  "Calm",
  "Bright",
  "Clever",
  "Bold",
  "Quiet",
  "Lucky",
  "Brave",
  "Gentle",
  "Keen",
  "Merry",
  "Nimble",
  "Proud",
  "Sunny",
  "Witty",
  "Eager",
];
const ANIMALS = [
  "Otter",
  "Falcon",
  "Panda",
  "Fox",
  "Lynx",
  "Heron",
  "Koala",
  "Orca",
  "Badger",
  "Crane",
  "Dolphin",
  "Gecko",
  "Hare",
  "Ibis",
  "Marten",
  "Wren",
];
const COLORS = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee"];
const STORAGE_KEY = "pairspace:guest";

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];

// a colour that's always the same for the same key (a member's id, say)
export function colorFor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

// a member is shown by their account name, in a colour fixed by their user id (same everywhere)
export function memberIdentity({ id, name }: { id: string; name: string }): User {
  return { id, name, color: colorFor(id) };
}

// a guest (invited, no account) gets a random identity, kept by this browser, so all its tabs
// are one person. `storage` is the browser's localStorage unless a test passes its own
export function guestIdentity(storage?: BrowserStorage): User {
  let saved: Partial<User> | null = null;
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    // storage blocked (private mode): fall through to a fresh identity
  }
  const id = saved?.id || `guest-${randomId(16)}`;
  const user =
    saved?.name && saved.color
      ? { id, name: saved.name, color: saved.color }
      : { id, name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(COLORS) };
  if (saved?.id !== id) {
    try {
      (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(user));
    } catch {
      // not remembered across reloads, which is fine
    }
  }
  return user;
}
