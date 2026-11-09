// The smoke test: is the site up and working? Runs locally with the rest, and against a deployed
// site with BASE_URL=https://… (then nothing is started here). The @deep test writes to the site
// (a throwaway member and room), so the daily check leaves it out.

import { expect, test } from "@playwright/test";
import { createRoom, memberBrowser, openRoomAs, shareLink } from "./members";

test.beforeAll("wait for the deployed service to wake up", async ({ request }) => {
  if (!process.env.BASE_URL) return;

  // Render's free service can take about a minute to wake after an idle spell.
  test.setTimeout(150_000);
  await expect(async () => {
    const health = await request.get("/api/health", { timeout: 10_000 });
    try {
      expect(health.status()).toBe(200);
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      await health.dispose();
    }
  }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });
});

// the app's code ran: the home page set its own title (index.html's is plain "PairSpace")
test("the app loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("PairSpace – code together in real time");
});

test("the server is up, and so is its database", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true });
});

test("a new member's room syncs live to the person they invite", { tag: "@deep" }, async ({
  browser,
}) => {
  const owner = await memberBrowser(browser, {}, "Smoke Test");
  const roomId = await createRoom(owner, "Smoke test");
  const page = await owner.newPage();
  await page.goto(`/r/${roomId}`);
  await expect(page.locator(".cm-content")).toBeVisible();
  const guest = await openRoomAs(browser, await shareLink(owner, roomId));

  await guest.locator(".cm-content").click();
  await guest.keyboard.type("smoke test");

  await expect(page.locator(".cm-content")).toContainText("smoke test");
});
