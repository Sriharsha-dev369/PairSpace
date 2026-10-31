// Spec for "edited … ago" on the dashboard.

import { describe, expect, it } from "vitest";
import { timeAgo } from "./timeAgo";

describe("time ago", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  const secondsAgo = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it("says 'just now' under a minute", () => {
    expect(timeAgo(secondsAgo(20), now)).toBe("just now");
  });

  it("uses the largest whole unit", () => {
    expect(timeAgo(secondsAgo(5 * 60), now)).toBe("5 minutes ago");
    expect(timeAgo(secondsAgo(3 * 3600), now)).toBe("3 hours ago");
    expect(timeAgo(secondsAgo(86400), now)).toBe("yesterday");
    expect(timeAgo(secondsAgo(14 * 86400), now)).toBe("2 weeks ago");
  });
});
