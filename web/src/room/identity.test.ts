// Spec for who you are in a room: the same person in every tab, as a member or a guest.

import { describe, expect, it } from "vitest";
import { guestIdentity, memberIdentity } from "./identity";

// stands in for the browser's localStorage, which every tab of one browser shares
function browserStorage(saved: Record<string, string> = {}) {
  return {
    getItem: (key: string) => saved[key] ?? null,
    setItem: (key: string, value: string) => {
      saved[key] = value;
    },
  };
}

describe("identity", () => {
  it("keeps a guest's id with their name, so all their tabs are one person", () => {
    const storage = browserStorage();

    const firstTab = guestIdentity(storage);
    const secondTab = guestIdentity(storage);

    expect(firstTab.id).not.toBe("");
    expect(secondTab).toEqual(firstTab);
  });

  it("gives a guest saved before ids existed an id, and keeps it", () => {
    const storage = browserStorage({
      "pairspace:guest": JSON.stringify({ name: "Calm Heron", color: "#22d3ee" }),
    });

    const now = guestIdentity(storage);
    const later = guestIdentity(storage);

    expect(now).toEqual(expect.objectContaining({ name: "Calm Heron", color: "#22d3ee" }));
    expect(now.id).not.toBe("");
    expect(later.id).toBe(now.id);
  });

  it("makes a member the same person everywhere: their user id, one colour", () => {
    const here = memberIdentity({ id: "user-42", name: "Ada" });
    const elsewhere = memberIdentity({ id: "user-42", name: "Ada" });

    expect(here.id).toBe("user-42");
    expect(elsewhere).toEqual(here);
  });
});
