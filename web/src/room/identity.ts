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

export const MAX_NAME = 40;

// what's wrong with a name someone typed for themselves, or null if it's fine
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter a name";
  if (trimmed.length > MAX_NAME) return `Keep it to ${MAX_NAME} characters`;
  return null;
}

// chosen: the guest typed (or accepted) this name on the invite screen, which then isn't shown again
interface SavedGuest extends User {
  chosen?: boolean;
}

function load(storage?: BrowserStorage): Partial<SavedGuest> | null {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // storage blocked (private mode): a fresh identity
  }
}

function save(guest: SavedGuest, storage?: BrowserStorage) {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(guest));
  } catch {
    // not remembered across reloads, which is fine
  }
}

// a guest (invited, no account) gets a random identity, kept by this browser, so all its tabs
// are one person. `storage` is the browser's localStorage unless a test passes its own
export function guestIdentity(storage?: BrowserStorage): User {
  const saved = load(storage);
  const id = saved?.id || `guest-${randomId(16)}`;
  const user =
    saved?.name && saved.color
      ? { id, name: saved.name, color: saved.color }
      : { id, name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(COLORS) };
  if (saved?.id !== id) save(user, storage);
  return user;
}

// whether this browser's guest has picked their name (the invite screen asks only once)
export function hasChosenName(storage?: BrowserStorage): boolean {
  return load(storage)?.chosen === true;
}

// the name this browser's guest picked (checked with nameProblem), kept with their id and colour
export function nameGuest(name: string, storage?: BrowserStorage): User {
  const user = { ...guestIdentity(storage), name: name.trim() };
  save({ ...user, chosen: true }, storage);
  return user;
}
