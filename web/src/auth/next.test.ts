// Spec for where sign-in sends you afterwards. `next` comes from the URL, which anyone can craft,
// so only paths on this site are followed: a link must never bounce people to another website.

import { describe, expect, it } from "vitest";
import { safeNext } from "./next";

describe("where to go after signing in", () => {
  it("follows a path on this site, with its query", () => {
    expect(safeNext("/r/abc123?x=1")).toBe("/r/abc123?x=1");
  });

  it("goes home when there's nowhere to go back to", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("never follows a link to another website", () => {
    for (const elsewhere of [
      "https://evil.example",
      "//evil.example", // a "protocol-relative" link: still another site
      "/\\evil.example", // browsers read a backslash as a slash
      "javascript:alert(1)",
      "r/no-leading-slash",
    ]) {
      expect(safeNext(elsewhere), elsewhere).toBe("/");
    }
  });
});
