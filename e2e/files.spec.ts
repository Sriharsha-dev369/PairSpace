// End-to-end spec for rooms with several files: the file list, tabs, and two people in different
// files at once.

import { expect, type Page, test } from "@playwright/test";
import {
  createRoom,
  fileList,
  joinAsSuggested,
  memberBrowser,
  newFile,
  newRoomUrl,
  openRoomAs,
  openTab,
  shareLink,
  twoGuestsIn,
} from "./members";

const editor = (page: Page) => page.locator(".cm-content");

async function rename(page: Page, from: string, to: string) {
  await fileList(page)
    .getByRole("button", { name: `Rename ${from}` })
    .click();
  await page.getByLabel("File name").fill(to);
  await page.getByLabel("File name").press("Enter");
}

// the names in the file list, as shown, in any order
const shownNames = async (page: Page) =>
  (await fileList(page).getByTestId("file-name").allInnerTexts()).sort();

// edits made while offline meet the other person's only on reconnecting: true concurrency
async function goOffline(page: Page) {
  await page.context().setOffline(true);
  await expect(page.getByTestId("connection-status")).toHaveText("Offline");
}

test("a new file reaches everyone, and two people work in different files at once", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);
  const aliceName = await alice.getByTestId("my-name").innerText();

  await newFile(alice, "utils.js");
  await expect(openTab(alice, "utils.js")).toHaveAttribute("aria-current", "true");
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

  await expect(openTab(bob, "main.py")).toBeVisible();
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

// M6's done-when, as people see it
test("someone deletes the file you're typing in: you're told who, can restore it, and lose nothing", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);
  const aliceName = await alice.getByTestId("my-name").innerText();
  await editor(bob).click();
  await bob.keyboard.type("bob's work");
  await expect(editor(alice)).toContainText("bob's work");

  await fileList(alice).getByRole("button", { name: "Delete main.js" }).click();

  await expect(bob.getByText(`${aliceName} deleted this file`)).toBeVisible();
  await editor(bob).click();
  await bob.keyboard.type(" more"); // paused until it's restored
  await bob.getByRole("button", { name: "Restore", exact: true }).click();
  await fileList(alice).getByRole("button", { name: "main.js", exact: true }).click();
  await expect(editor(alice)).toContainText("bob's work");
  await expect(editor(alice)).not.toContainText("more"); // typed before Restore, so it'd be here
});

// guests' names are picked at random, so two can match: "You" must mean you, not your name
test("when two people show the same name, only the one who deleted a file is told 'You'", async ({
  browser,
}) => {
  const url = await newRoomUrl(browser);
  const sameName = async (id: string) => {
    const context = await browser.newContext();
    await context.addInitScript(
      (guest) => {
        localStorage.setItem("pairspace:guest", JSON.stringify(guest));
      },
      { id, name: "Bold Heron", color: "#34d399" },
    );
    const page = await context.newPage();
    await page.goto(url);
    await joinAsSuggested(page); // as "Bold Heron", the name it suggests
    return page;
  };
  const [alice, bob] = [await sameName("guest-alice"), await sameName("guest-bob")];

  await fileList(alice).getByRole("button", { name: "Delete main.js" }).click();

  await expect(bob.getByText("Bold Heron deleted this file")).toBeVisible();
});

test("a deleted file waits in the trash: Undo brings it back, and so can anyone else", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);
  await newFile(alice, "utils.js");

  await fileList(alice).getByRole("button", { name: "Delete utils.js" }).click();
  await expect(openTab(alice, "utils.js")).toHaveCount(0); // its tab closes
  await expect(fileList(bob).getByRole("button", { name: "utils.js", exact: true })).toHaveCount(0);
  await alice.getByRole("button", { name: "Undo" }).click();
  await expect(fileList(bob).getByRole("button", { name: "utils.js", exact: true })).toBeVisible();

  await fileList(alice).getByRole("button", { name: "Delete utils.js" }).click();
  await fileList(bob).getByRole("button", { name: "Trash (1)" }).click();
  await fileList(bob).getByRole("button", { name: "Restore utils.js" }).click();
  await expect(
    fileList(alice).getByRole("button", { name: "utils.js", exact: true }),
  ).toBeVisible();
});

test("closing a file takes your cursor out of it for everyone", async ({ browser }) => {
  const [alice, bob] = await twoGuestsIn(browser);
  await editor(alice).click();
  await alice.keyboard.type("x");
  await expect(bob.locator(".cm-ySelectionInfo")).toBeVisible();

  await alice.getByRole("button", { name: "Close main.js" }).click();

  await expect(bob.locator(".cm-ySelectionInfo")).toHaveCount(0);
});

test("someone with a view-only link opens files, but can't create, rename, delete or restore them", async ({
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
  await expect(fileList(viewer).getByRole("button", { name: /^Delete/ })).toHaveCount(0);

  // nor restore one: not from the notice in the file, nor from the trash
  await fileList(ownerPage).getByRole("button", { name: "Delete notes.md" }).click();
  await expect(viewer.getByText("deleted this file")).toBeVisible();
  await fileList(viewer).getByRole("button", { name: "Trash (1)" }).click();
  await expect(viewer.getByRole("button", { name: /^Restore/ })).toHaveCount(0);
});

test("two people renaming a file at the same time end with one name for everyone", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);
  await goOffline(alice);

  await rename(alice, "main.js", "alice.js");
  await rename(bob, "main.js", "bob.js");
  await alice.context().setOffline(false);

  await expect(async () => {
    const names = await shownNames(alice);
    expect(names).toHaveLength(1);
    expect(["alice.js", "bob.js"]).toContain(names[0]);
    expect(await shownNames(bob)).toEqual(names);
  }).toPass();
});

test("a name two people make at the same time shows the later file as (2)", async ({ browser }) => {
  const [alice, bob] = await twoGuestsIn(browser);
  await goOffline(alice);

  await newFile(alice, "utils.js");
  await newFile(bob, "utils.js"); // made a moment after alice's
  await alice.context().setOffline(false);

  for (const page of [alice, bob]) {
    await expect
      .poll(() => shownNames(page))
      .toEqual(["main.js", "utils (2).js", "utils.js"].sort());
  }
});

test("files with folders in their names are grouped in the list, and a folder folds", async ({
  browser,
}) => {
  const page = await openRoomAs(browser, await newRoomUrl(browser));
  const app = fileList(page).getByRole("button", { name: "app.js", exact: true });

  await newFile(page, "src/app.js");

  const folder = fileList(page).getByRole("button", { name: "src", exact: true });
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await expect(app).toBeVisible();
  await expect(openTab(page, "app.js")).toBeVisible();
  await folder.click();
  await expect(app).toHaveCount(0);
});
