// End-to-end spec for accessibility: every page passes axe's automated WCAG 2.1 A and AA checks
// (contrast, names for controls, labels, landmarks, ...). Automated checks catch about a third
// of real problems; keyboard use is covered by the other specs, which drive pages by role.

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createRoom, memberBrowser, newRoomUrl, shareLink } from "./members";

// what axe finds, one line per problem, so a failure says what to fix. With a dialog open, only
// the dialog: the page behind it is hidden from assistive technology on purpose while it's open
async function problems(page: Page, { dialog = false } = {}) {
  const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  const { violations } = await (dialog ? axe.include('[role="dialog"]') : axe).analyze();
  return violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
}

test("the pages for visitors pass the automated accessibility checks", async ({ page }) => {
  for (const path of ["/", "/sign-in", "/sign-up", "/no-such-page", "/join/not-a-code"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await problems(page), path).toEqual([]);
  }
});

test("the dashboard passes the automated accessibility checks, empty and with rooms", async ({
  browser,
}) => {
  const owner = await memberBrowser(browser);
  const page = await owner.newPage();
  await page.goto("/");
  await expect(page.getByText("No rooms yet")).toBeVisible();
  expect(await problems(page)).toEqual([]);

  await createRoom(owner, "Interview prep");
  await page.reload();
  await expect(page.getByText("Interview prep")).toBeVisible();
  expect(await problems(page)).toEqual([]);
});

test("a room passes the automated accessibility checks, with its panels open", async ({
  browser,
}) => {
  const owner = await memberBrowser(browser, {}, "Ada Lovelace");
  const roomId = await createRoom(owner, "Interview prep");
  const page = await owner.newPage();
  await page.goto(`/r/${roomId}`);
  await page.locator(".cm-content").click();
  await page.keyboard.type("console.log('hi')");
  expect(await problems(page)).toEqual([]);

  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText(/ran main\.js/)).toBeVisible();
  await page.getByRole("button", { name: /^Sync inspector/ }).click();
  await expect(page.getByRole("complementary", { name: "Sync inspector" })).toBeVisible();
  expect(await problems(page)).toEqual([]);

  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await problems(page, { dialog: true })).toEqual([]);
});

test("the invite screen and replay pass the automated accessibility checks", async ({
  browser,
}) => {
  const owner = await memberBrowser(browser, {}, "Ada Lovelace");
  const roomId = await createRoom(owner, "Interview prep");
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(await shareLink(owner, roomId));
  await expect(guest.getByRole("button", { name: "Join room" })).toBeVisible();
  expect(await problems(guest)).toEqual([]);

  const page = await owner.newPage();
  await page.goto(`/r/${roomId}/replay`);
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  expect(await problems(page)).toEqual([]);
});

test("a room on a phone passes the automated accessibility checks, menu open", async ({
  browser,
}) => {
  const page = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
  ).newPage();
  await page.goto(await newRoomUrl(browser));
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  expect(await problems(page)).toEqual([]);

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  expect(await problems(page, { dialog: true })).toEqual([]);
});
