// End-to-end spec for rooms with several files: the file list, tabs, and two people in different
// files at once.

import { expect, type Page, test } from "@playwright/test";
import {
  createRoom,
  memberBrowser,
  newRoomUrl,
  openRoomAs,
  shareLink,
  twoGuestsIn,
} from "./members";

const fileList = (page: Page) => page.getByRole("complementary", { name: "Files" });
const editor = (page: Page) => page.locator(".cm-content");

async function newFile(page: Page, name: string) {
  await fileList(page).getByRole("button", { name: "New file" }).click();
  await page.getByLabel("File name").fill(name);
  await page.getByLabel("File name").press("Enter");
}

test("a new file reaches everyone, and two people work in different files at once", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);
  const aliceName = await alice.getByTestId("my-name").innerText();

  await newFile(alice, "utils.js");
  await expect(alice.getByRole("tab", { name: "utils.js", selected: true })).toBeVisible();
  await expect(alice.locator(".cm-line")).toHaveCount(1); // empty: the Enter that named it isn't in it
  await alice.keyboard.type("export const answer = 42;"); // a new file is ready to type in
  await editor(bob).click();
  await bob.keyboard.type("console.log('main');");

  // bob, still in main.js, sees the new file, and that alice is in it
  const utils = fileList(bob).getByRole("listitem").filter({ hasText: "utils.js" });
  await expect(utils.getByLabel(`${aliceName} is in this file`)).toBeVisible();
  await expect(editor(bob)).not.toContainText("answer");
  await fileList(bob).getByRole("button", { name: "utils.js", exact: true }).click();
  await expect(editor(bob)).toContainText("export const answer = 42;");
  await fileList(alice).getByRole("button", { name: "main.js", exact: true }).click();
  await expect(editor(alice)).toContainText("console.log('main');");
});

test("renaming a file renames it for everyone, and its language follows the new name", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);
  await expect(bob.getByTestId("language")).toHaveText("JavaScript");

  await fileList(alice).getByRole("button", { name: "Rename main.js" }).click();
  await alice.getByLabel("File name").fill("main.py");
  await alice.getByLabel("File name").press("Enter");

  await expect(bob.getByRole("tab", { name: "main.py" })).toBeVisible();
  await expect(fileList(bob).getByRole("button", { name: "main.py", exact: true })).toBeVisible();
  await expect(bob.getByTestId("language")).toHaveText("Python");
  await expect(editor(bob)).toHaveAttribute("data-language", "python"); // highlighted as Python
});

test("a file name that can't be used is refused, with the reason", async ({ browser }) => {
  const page = await openRoomAs(browser, await newRoomUrl(browser));
  const name = page.getByLabel("File name");

  await newFile(page, "main.js");
  await expect(fileList(page).getByRole("alert")).toHaveText(
    "There's already a file with this name.",
  );
  await name.fill("../secret.js");
  await name.press("Enter");
  await expect(fileList(page).getByRole("alert")).toContainText("folder");

  await name.press("Escape");
  await expect(fileList(page).getByRole("listitem")).toHaveCount(1);
});

test("closing a file takes your cursor out of it for everyone", async ({ browser }) => {
  const [alice, bob] = await twoGuestsIn(browser);
  await editor(alice).click();
  await alice.keyboard.type("x");
  await expect(bob.locator(".cm-ySelectionInfo")).toBeVisible();

  await alice.getByRole("button", { name: "Close main.js" }).click();

  await expect(bob.locator(".cm-ySelectionInfo")).toHaveCount(0);
});

test("someone with a view-only link opens files, but can't create or rename them", async ({
  browser,
}) => {
  const owner = await memberBrowser(browser);
  const roomId = await createRoom(owner);
  const ownerPage = await owner.newPage();
  await ownerPage.goto(`/r/${roomId}`);
  await newFile(ownerPage, "notes.md");
  const viewer = await openRoomAs(browser, await shareLink(owner, roomId, "viewer"));

  await fileList(viewer).getByRole("button", { name: "notes.md", exact: true }).click();

  await expect(viewer.getByTestId("language")).toHaveText("Markdown");
  await expect(fileList(viewer).getByRole("button", { name: "New file" })).toHaveCount(0);
  await expect(fileList(viewer).getByRole("button", { name: /^Rename/ })).toHaveCount(0);
});
