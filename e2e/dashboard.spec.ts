// End-to-end spec for the dashboard: a member's own rooms, made, renamed and deleted there.

import { expect, type Page, test } from "@playwright/test";
import { createRoom, joinAsSuggested, memberBrowser, shareLink } from "./members";

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
  await guest.goto(await shareLink(ownerBrowser, roomId));
  await joinAsSuggested(guest);
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

test("from a room, Your rooms leads back to the dashboard, where you can open another", async ({
  browser,
}) => {
  const context = await memberBrowser(browser);
  const first = await createRoom(context, "First room");
  await createRoom(context, "Second room");
  const page = await context.newPage();
  await page.goto(`/r/${first}`);
  await expect(page.getByTestId("room-title")).toHaveText("First room");

  await page.getByRole("link", { name: "Your rooms" }).click();
  await row(page, "Second room").getByRole("link", { name: "Second room" }).click();

  await expect(page.getByTestId("room-title")).toHaveText("Second room");
  await expect(page.locator(".cm-content")).toBeVisible();
});

test("leaving a room while edits haven't synced asks first", async ({ browser }) => {
  const context = await memberBrowser(browser);
  const page = await context.newPage();
  await page.goto(`/r/${await createRoom(context)}`);
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.waitForLoadState("networkidle"); // the pages you may go to next have downloaded too
  await context.setOffline(true);
  await expect(page.getByTestId("connection-status")).toHaveText("Offline");
  await page.locator(".cm-content").click();
  await page.keyboard.type("only in this tab");

  await page.getByRole("link", { name: "Your rooms" }).click();
  await page.getByRole("button", { name: "Stay" }).click();
  await expect(page.locator(".cm-content")).toContainText("only in this tab"); // still here

  await page.getByRole("link", { name: "Your rooms" }).click();
  await page.getByRole("button", { name: "Leave anyway" }).click();
  await expect(page.getByRole("heading", { name: "Your rooms" })).toBeVisible();
});
