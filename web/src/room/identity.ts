import type { User } from "./session";

const ADJECTIVES = ["Swift", "Calm", "Bright", "Clever", "Bold", "Quiet", "Lucky", "Brave"];
const ANIMALS = ["Otter", "Falcon", "Panda", "Fox", "Lynx", "Heron", "Koala", "Orca"];
const COLORS = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee"];
const STORAGE_KEY = "pairspace:guest";

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];

// a member is shown by their account name, in a colour fixed by their user id (same everywhere)
export function memberIdentity({ id, name }: { id: string; name: string }): User {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { name, color: COLORS[hash % COLORS.length] };
}

// a guest (invited, no account) gets a random identity, kept by this browser
export function guestIdentity(): User {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as User;
  } catch {
    // storage blocked (private mode): fall through to a fresh identity
  }
  const user = { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(COLORS) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    // not remembered across reloads, which is fine
  }
  return user;
}
