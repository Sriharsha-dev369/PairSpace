// End-to-end spec for phones: the whole room works on a phone-sized screen, and no page scrolls
// sideways. Invite links are often opened from a chat on a phone.

import { expect, type Page, test } from "@playwright/test";
import { createRoom, fileList, memberBrowser, newFile, openRoomAs, shareLink } from "./members";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

// the page is no wider than the screen: nothing to scroll sideways to
async function fitsTheScreen(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function ownerOnPhone(browser: Parameters<typeof memberBrowser>[0]) {
  const owner = await memberBrowser(browser, PHONE, "Ada Lovelace");
  const roomId = await createRoom(owner, "Interview prep");
  const page = await owner.newPage();
  await page.goto(`/r/${roomId}`);
  await expect(page.locator(".cm-content")).toBeVisible();
  return { owner, roomId, page };
}

test("on a phone, the room fits the screen, and its header folds into a menu", async ({
  browser,
}) => {
  const { page } = await ownerOnPhone(browser);
  await fitsTheScreen(page);

  await page.getByRole("button", { name: "Menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByTestId("connection-status")).toHaveText("Connected");
  await expect(menu.getByTestId("my-name")).toHaveText("Ada Lovelace");
  await expect(menu.getByRole("link", { name: "Replay" })).toBeVisible();
  await menu.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("dialog", { name: /Share/ })).toBeVisible();
});

test("on a phone, the file list slides in over the editor, and opening a file closes it", async ({
  browser,
}) => {
  const { page } = await ownerOnPhone(browser);
  await expect(fileList(page)).toBeHidden(); // the editor gets the whole width

  await page.getByRole("button", { name: "Files" }).click();
  await newFile(page, "b.js");

  await expect(fileList(page)).toBeHidden();
  await expect(page.getByRole("tab", { name: /b\.js/ })).toHaveAttribute("aria-selected", "true");
  const editor = await page.locator(".cm-editor").boundingBox();
  expect(editor?.width).toBeGreaterThan(350);
});

test("on a phone, an invited guest joins and types, and the others see it", async ({ browser }) => {
  const { owner, roomId, page: ada } = await ownerOnPhone(browser);
  const guest = await openRoomAs(browser, await shareLink(owner, roomId), PHONE);
  await fitsTheScreen(guest);

  await guest.locator(".cm-content").click();
  await guest.keyboard.type("typed on a phone");

  await expect(ada.locator(".cm-content")).toContainText("typed on a phone");
});

test("on a phone, the sync inspector opens as a sheet", async ({ browser }) => {
  const { page } = await ownerOnPhone(browser);

  await page.getByRole("button", { name: "Sync inspector", exact: true }).click();

  const sheet = page.getByRole("dialog", { name: "Sync inspector" });
  await expect(sheet.getByTestId("sync-connection")).toHaveText("Connected");
  await fitsTheScreen(page);
  await sheet.getByRole("button", { name: "Close the sync inspector" }).click();
  await expect(sheet).toBeHidden();
});

test("on a phone, replay's files slide in over the code", async ({ browser }) => {
  const { roomId, page } = await ownerOnPhone(browser);
  await page.goto(`/r/${roomId}/replay`);
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await fitsTheScreen(page);

  await page.getByRole("button", { name: "Files" }).click();
  await page.getByRole("dialog", { name: "Files" }).getByText("main.js").click();

  await expect(page.getByRole("dialog", { name: "Files" })).toBeHidden();
});

test("no page scrolls sideways on a phone", async ({ browser }) => {
  const visitor = await (await browser.newContext(PHONE)).newPage();
  for (const path of ["/", "/sign-in", "/sign-up", "/no-such-page"]) {
    await visitor.goto(path);
    await expect(visitor.getByRole("heading", { level: 1 })).toBeVisible();
    await fitsTheScreen(visitor);
  }
  const { owner, roomId, page } = await ownerOnPhone(browser);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your rooms" })).toBeVisible();
  await fitsTheScreen(page);
  const invited = await (await browser.newContext(PHONE)).newPage();
  await invited.goto(await shareLink(owner, roomId));
  await expect(invited.getByRole("button", { name: "Join room" })).toBeVisible();
  await fitsTheScreen(invited);
});
