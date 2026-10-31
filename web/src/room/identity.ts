import { newRoomId } from "./room-id";
import type { User } from "./session";

const ADJECTIVES = ["Swift", "Calm", "Bright", "Clever", "Bold", "Quiet", "Lucky", "Brave"];
const ANIMALS = ["Otter", "Falcon", "Panda", "Fox", "Lynx", "Heron", "Koala", "Orca"];
const COLORS = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee"];
const STORAGE_KEY = "pairspace:guest";

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];

// a member is shown by their account name, in a colour fixed by their user id (same everywhere)
export function memberIdentity({ id, name }: { id: string; name: string }): User {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { id, name, color: COLORS[hash % COLORS.length] };
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
  // getRandomValues, not randomUUID: browsers offer randomUUID only over https or on localhost
  const id = saved?.id || `guest-${newRoomId(16)}`;
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
