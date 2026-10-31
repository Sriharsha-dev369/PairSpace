// End-to-end spec for sharing: links that let people in, and the room address that doesn't.

import { expect, test } from "@playwright/test";
import { createRoom, memberBrowser, shareLink } from "./members";

test("the owner shares an edit link, and a guest who opens it edits with them", async ({
  browser,
}) => {
  const ownerBrowser = await memberBrowser(browser, {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const roomId = await createRoom(ownerBrowser, "Pairing");
  const owner = await ownerBrowser.newPage();
  await owner.goto(`/r/${roomId}`);
  await expect(owner.locator(".cm-content")).toBeVisible();

  await owner.getByRole("button", { name: "Share" }).click();
  await owner.getByRole("button", { name: "Copy link" }).click();
  await expect(owner.getByRole("button", { name: "Link copied" })).toBeVisible();
  const link = await owner.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/join\/[A-Za-z0-9_-]{22}$/);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await guest.locator(".cm-content").click();
  await guest.keyboard.type("hello from the guest");

  await expect(owner.locator(".cm-content")).toContainText("hello from the guest");
  await expect(guest.getByTestId("room-title")).toHaveText("Pairing");
  await expect(guest.getByRole("button", { name: "Share" })).toHaveCount(0); // only the owner shares
});

test("a room's address alone doesn't let a stranger in", async ({ browser }) => {
  const roomId = await createRoom(await memberBrowser(browser));
  const stranger = await (await browser.newContext()).newPage();

  await stranger.goto(`/r/${roomId}`);

  await expect(stranger.getByText("You don't have access to this room")).toBeVisible();
});

test("someone signed in who opens a link finds the room on their dashboard", async ({
  browser,
}) => {
  const ownerBrowser = await memberBrowser(browser);
  const link = await shareLink(ownerBrowser, await createRoom(ownerBrowser, "Pairing"));
  const page = await (await memberBrowser(browser, {}, "Bob")).newPage();

  await page.goto(link);
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.goto("/");

  const row = page.getByRole("listitem").filter({ hasText: "Pairing" });
  await expect(row).toContainText("Shared with you");
  await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("a link that doesn't work says so", async ({ page }) => {
  await page.goto("/join/not-a-real-code");

  await expect(page.getByText("This link doesn't work")).toBeVisible();
});
