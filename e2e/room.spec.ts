// End-to-end spec: real browsers, real web app, real sync server (started by playwright.config.ts).

import { type Browser, type Dialog, expect, type Page, test } from "@playwright/test";
import { memberBrowser } from "./members";

// each person gets their own browser context: separate storage, like two different computers.
// Invited people join as guests (no account)
async function openRoomAs(browser: Browser, url: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  await expect(page.locator(".cm-content")).toBeVisible();
  return page;
}

// a room created by a member, who then leaves: its link is the invite
async function newRoomUrl(browser: Browser): Promise<string> {
  const page = await (await memberBrowser(browser)).newPage();
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible(); // joined, so the room exists
  const url = page.url();
  await page.context().close();
  return url;
}

test("opening the home page takes you to a new room link", async ({ browser }) => {
  const page = await (await memberBrowser(browser)).newPage();
  await page.goto("/");

  await expect(page).toHaveURL(/\/r\/[a-z0-9]{10}$/);
});

test("an invalid room link says so and offers a new room", async ({ browser }) => {
  const page = await (await memberBrowser(browser)).newPage();
  await page.goto(`/r/${"x".repeat(65)}`); // one over the server's 64 character limit

  await expect(page.getByText("This room link isn't valid")).toBeVisible();
  await page.getByRole("link", { name: "Start a new room" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
});

test("the share button copies the room link", async ({ browser }) => {
  const context = await memberBrowser(browser, {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.getByRole("button", { name: "Share" }).click();

  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
});

test("two people in the same room see each other's typing", async ({ browser }) => {
  const url = await newRoomUrl(browser);
  const alice = await openRoomAs(browser, url);
  const bob = await openRoomAs(browser, url);

  await alice.locator(".cm-content").click();
  await alice.keyboard.type("const greeting = 'hi from alice';");

  await expect(bob.locator(".cm-content")).toContainText("const greeting = 'hi from alice';");
});

test("shows the connection status and who else is in the room", async ({ browser }) => {
  const url = await newRoomUrl(browser);
  const alice = await openRoomAs(browser, url);
  const bob = await openRoomAs(browser, url);
  const aliceName = await alice.getByTestId("my-name").innerText();

  await expect(alice.getByTestId("connection-status")).toHaveText("Connected");
  await expect(bob.getByTestId("other-person")).toHaveText([aliceName]);
});

test("shows the other person's cursor labelled with their name", async ({ browser }) => {
  const url = await newRoomUrl(browser);
  const alice = await openRoomAs(browser, url);
  const bob = await openRoomAs(browser, url);
  const aliceName = await alice.getByTestId("my-name").innerText();

  await alice.locator(".cm-content").click();
  await alice.keyboard.type("x");

  await expect(bob.locator(".cm-ySelectionInfo")).toHaveText(aliceName);
});

test("the name label sits exactly on top of the other person's cursor", async ({ browser }) => {
  const url = await newRoomUrl(browser);
  const alice = await openRoomAs(browser, url);
  const bob = await openRoomAs(browser, url);
  await alice.locator(".cm-content").click();
  await alice.keyboard.type("first line\nsecond line");

  const box = async (selector: string) => {
    const b = await bob.locator(selector).first().boundingBox();
    if (!b) throw new Error(`${selector} is not visible`);
    return b;
  };
  await expect(bob.locator(".cm-ySelectionInfo")).toBeVisible();
  const caret = await box(".cm-ySelectionCaret");
  const label = await box(".cm-ySelectionInfo");
  const line = await box(".cm-line >> nth=1");

  expect(Math.abs(label.y + label.height - caret.y), "label bottom on caret top").toBeLessThan(0.5);
  expect(Math.abs(label.x - caret.x), "label left on caret left").toBeLessThan(0.5);
  expect(Math.abs(caret.height - line.height), "caret is a full line tall").toBeLessThan(0.5);
});

test("the name label fades while the other person is idle and returns when they move", async ({
  browser,
}) => {
  const url = await newRoomUrl(browser);
  const alice = await openRoomAs(browser, url);
  const bob = await openRoomAs(browser, url);
  await alice.locator(".cm-content").click();
  await alice.keyboard.type("hello");
  const label = bob.locator(".cm-ySelectionInfo");

  await expect(label).toHaveCSS("opacity", "1");
  await expect(label).toHaveCSS("opacity", "0", { timeout: 6000 });

  await alice.keyboard.press("ArrowLeft");
  await expect(label).toHaveCSS("opacity", "1");
});

test("going offline shows it, and edits made offline reach the other person once back", async ({
  browser,
}) => {
  const url = await newRoomUrl(browser);
  const alice = await openRoomAs(browser, url);
  const bob = await openRoomAs(browser, url);
  const status = alice.getByTestId("connection-status");
  await expect(status).toHaveText("Connected");

  await alice.context().setOffline(true);
  await expect(status).toHaveText("Offline");
  await alice.locator(".cm-content").click();
  await alice.keyboard.type("written offline");
  await alice.context().setOffline(false);

  await expect(status).toHaveText("Connected");
  await expect(bob.locator(".cm-content")).toContainText("written offline");
});

test("asks before closing a tab whose edits haven't synced", async ({ browser }) => {
  const alice = await openRoomAs(browser, await newRoomUrl(browser));
  await alice.context().setOffline(true);
  await alice.locator(".cm-content").click();
  await alice.keyboard.type("not synced yet");
  await expect(alice.getByTestId("unsynced-hint")).toBeVisible();
  const asked = new Promise<Dialog>((resolve) => alice.once("dialog", resolve));

  await alice.close({ runBeforeUnload: true });

  const dialog = await asked;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
});

test("closes without asking when every edit has synced", async ({ browser }) => {
  const alice = await openRoomAs(browser, await newRoomUrl(browser));
  await alice.locator(".cm-content").click();
  await alice.keyboard.type("synced");
  const dialogs: Dialog[] = [];
  alice.on("dialog", (dialog) => dialogs.push(dialog));
  const closed = alice.waitForEvent("close");

  await alice.close({ runBeforeUnload: true });

  await closed;
  expect(dialogs).toEqual([]);
});

test("pasting something too large to sync says so, and the room keeps syncing", async ({
  browser,
}) => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const alice = await context.newPage();
  await alice.goto(await newRoomUrl(browser));
  await expect(alice.locator(".cm-content")).toBeVisible();
  await alice.evaluate((text) => navigator.clipboard.writeText(text), "x".repeat(3 * 1024 * 1024));
  await alice.locator(".cm-content").click();

  await alice.keyboard.press("ControlOrMeta+V");

  await expect(alice.getByText("That paste is too large to sync")).toBeVisible();
  await expect(alice.locator(".cm-content")).not.toContainText("xxx");
  await expect(alice.getByTestId("connection-status")).toHaveText("Connected");
});

test("the same person with two tabs open shows up once", async ({ browser }) => {
  const url = await newRoomUrl(browser);
  const sameBrowser = await browser.newContext(); // tabs of one browser share its storage
  const tab = await sameBrowser.newPage();
  await tab.goto(url);
  const otherTab = await sameBrowser.newPage();
  await otherTab.goto(url);
  await expect(otherTab.locator(".cm-content")).toBeVisible();
  const myName = await tab.getByTestId("my-name").innerText();

  await otherTab.locator(".cm-content").click();
  await otherTab.keyboard.type("x");

  // the other tab's cursor has arrived, so its presence has too
  await expect(tab.locator(".cm-ySelectionInfo")).toHaveText(myName);
  await expect(tab.getByTestId("other-person")).toHaveCount(0);
  await expect(tab.getByText("Only you here")).toBeVisible();
});
