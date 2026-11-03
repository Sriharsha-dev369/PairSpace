// End-to-end spec for sharing: links that let people in, and the room address that doesn't.

import { expect, test } from "@playwright/test";
import { createRoom, joinAsSuggested, memberBrowser, shareLink } from "./members";

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
  const editLinkRow = owner.getByRole("group", { name: "Can edit" });
  await editLinkRow.getByRole("button", { name: "Create link" }).click();
  await editLinkRow.getByRole("button", { name: "Copy link" }).click();
  await expect(editLinkRow.getByRole("button", { name: "Link copied" })).toBeVisible();
  const link = await owner.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/join\/[A-Za-z0-9_-]{22}$/);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await joinAsSuggested(guest);
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
  await joinAsSuggested(page);
  await page.goto("/");

  const row = page.getByRole("listitem").filter({ hasText: "Pairing" });
  await expect(row).toContainText("Shared with you");
  await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("a link that doesn't work says so", async ({ page }) => {
  await page.goto("/join/not-a-real-code");

  await expect(page.getByText("This link doesn't work")).toBeVisible();
});

test("a view-only link lets someone watch, but not type", async ({ browser }) => {
  const ownerBrowser = await memberBrowser(browser);
  const roomId = await createRoom(ownerBrowser);
  const owner = await ownerBrowser.newPage();
  await owner.goto(`/r/${roomId}`);
  const viewer = await (await browser.newContext()).newPage();
  await viewer.goto(await shareLink(ownerBrowser, roomId, "viewer"));
  await joinAsSuggested(viewer);
  await expect(viewer.getByText("View only")).toBeVisible();

  await viewer.locator(".cm-content").click();
  await viewer.keyboard.type("not allowed");
  await owner.locator(".cm-content").click();
  await owner.keyboard.type("written by the owner");

  await expect(viewer.locator(".cm-content")).toContainText("written by the owner");
  await expect(viewer.locator(".cm-content")).not.toContainText("not allowed");
  await expect(owner.locator(".cm-content")).not.toContainText("not allowed");
});

test("turning off a link from Share disconnects whoever used it", async ({ browser }) => {
  const ownerBrowser = await memberBrowser(browser);
  const roomId = await createRoom(ownerBrowser);
  const link = await shareLink(ownerBrowser, roomId);
  const owner = await ownerBrowser.newPage();
  await owner.goto(`/r/${roomId}`);
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await joinAsSuggested(guest);

  await owner.getByRole("button", { name: "Share" }).click();
  const editLinkRow = owner.getByRole("group", { name: "Can edit" });
  await editLinkRow.getByRole("button", { name: "Turn off" }).click();
  await editLinkRow.getByRole("button", { name: "Turn off for everyone" }).click();

  await expect(guest.getByText("Your access to this room was turned off")).toBeVisible();
  await expect(editLinkRow.getByRole("button", { name: "Create link" })).toBeVisible();
});
