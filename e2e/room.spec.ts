// End-to-end spec: real browsers, real web app, real sync server (started by playwright.config.ts).

import { type Browser, expect, type Page, test } from "@playwright/test";

// each person gets their own browser context: separate storage, like two different computers
async function openRoomAs(browser: Browser, url: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  await expect(page.locator(".cm-content")).toBeVisible();
  return page;
}

async function newRoomUrl(browser: Browser): Promise<string> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/r\//);
  const url = page.url();
  await page.context().close();
  return url;
}

test("opening the home page takes you to a new room link", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/r\/[a-z0-9]{10}$/);
});

test("two people in the same room see each other's typing", async ({ browser }) => {
  const url = await newRoomUrl(browser);
  const alice = await openRoomAs(browser, url);
  const bob = await openRoomAs(browser, url);

  await alice.locator(".cm-content").click();
  await alice.keyboard.type("const greeting = 'hi from alice';");

  await expect(bob.locator(".cm-content")).toContainText("const greeting = 'hi from alice';");
});
