// End-to-end spec for the dashboard: a member's own rooms, made, renamed and deleted there.

import { expect, type Page, test } from "@playwright/test";
import { createRoom, memberBrowser } from "./members";

// the row for a room on the dashboard, found by its name
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });

test("the dashboard lists your rooms, and New room opens a fresh one", async ({ browser }) => {
  const page = await (await memberBrowser(browser)).newPage();
  await page.goto("/");
  await expect(page.getByText("No rooms yet")).toBeVisible();

  await page.getByRole("button", { name: "New room" }).first().click();

  await expect(page).toHaveURL(/\/r\/[a-z0-9]{10}$/);
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.goto("/");
  await expect(row(page, "Untitled room")).toBeVisible();
});

test("renaming a room on the dashboard sticks", async ({ browser }) => {
  const context = await memberBrowser(browser);
  await createRoom(context, "Old name");
  const page = await context.newPage();
  await page.goto("/");

  await row(page, "Old name").getByRole("button", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Room name" }).fill("New name");
  await page.keyboard.press("Enter");

  await expect(row(page, "New name")).toBeVisible();
  await page.reload();
  await expect(row(page, "New name")).toBeVisible();
});

test("deleting a room asks first, then removes it and tells anyone inside", async ({ browser }) => {
  const ownerBrowser = await memberBrowser(browser);
  const roomId = await createRoom(ownerBrowser, "Doomed");
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/r/${roomId}`);
  await expect(guest.locator(".cm-content")).toBeVisible();
  const owner = await ownerBrowser.newPage();
  await owner.goto("/");

  await row(owner, "Doomed").getByRole("button", { name: "Delete" }).click();
  await owner.getByRole("button", { name: "Cancel" }).click();
  await expect(row(owner, "Doomed")).toBeVisible(); // asking first: cancel keeps it
  await row(owner, "Doomed").getByRole("button", { name: "Delete" }).click();
  await owner.getByRole("button", { name: "Delete room" }).click();

  await expect(row(owner, "Doomed")).toHaveCount(0);
  await expect(guest.getByText("This room was deleted")).toBeVisible();
});
