// End-to-end spec for replay (M8): people who can edit step back through the room's saved
// changes and see the files and code exactly as they were.

import { expect, type Page, test } from "@playwright/test";
import {
  createRoom,
  fileList,
  memberBrowser,
  newFile,
  newRoomUrl,
  openRoomAs,
  shareLink,
} from "./members";

// replay steps through saved changes: wait until the server has saved this many
async function savedChanges(page: Page, count: number) {
  const url = new URL(page.url());
  const link = url.searchParams.get("link");
  const history = `/api/rooms/${url.pathname.split("/")[2]}/history${link ? `?link=${link}` : ""}`;
  await expect
    .poll(async () => {
      const response = await page.request.get(history);
      return response.ok() ? (await response.json()).length : 0;
    })
    .toBe(count);
}

const shownCode = (page: Page) => page.getByTestId("replay-code").locator(".cm-content");
const filesThen = (page: Page) => page.getByRole("complementary", { name: "Files at this step" });

test("someone who can edit steps back through the room: files and code as they were, and who changed them", async ({
  browser,
}) => {
  const page = await openRoomAs(browser, await newRoomUrl(browser));
  const me = await page.getByTestId("my-name").innerText();
  // one edit per saved change: each is one step
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("first");
  await savedChanges(page, 2); // the room's first file, then "first"
  await newFile(page, "utils.js");
  await savedChanges(page, 3);
  await fileList(page).getByRole("button", { name: "main.js", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" second");
  await savedChanges(page, 4);

  await page.getByRole("link", { name: "Replay" }).click();

  const slider = page.getByRole("slider", { name: "Step" });
  await expect(slider).toHaveValue("3"); // starts at the latest change
  await expect(shownCode(page)).toHaveText("first second");
  await expect(filesThen(page).getByTestId("file-name")).toHaveText(["main.js", "utils.js"]);

  await slider.focus();
  await page.keyboard.press("Home"); // the room as it was made
  await expect(shownCode(page)).toHaveText("");
  await expect(filesThen(page).getByTestId("file-name")).toHaveText(["main.js"]);
  await expect(page.getByTestId("step-author")).toHaveText("PairSpace");

  await page.keyboard.press("ArrowRight");
  await expect(shownCode(page)).toHaveText("first");
  await expect(page.getByTestId("step-author")).toHaveText(me);

  await page.keyboard.press("ArrowRight");
  await expect(filesThen(page).getByTestId("file-name")).toHaveText(["main.js", "utils.js"]);
  await expect(shownCode(page)).toHaveText("first");
});

test("a view-only link can't replay the room", async ({ browser }) => {
  const owner = await memberBrowser(browser);
  const roomId = await createRoom(owner);
  const viewLink = await shareLink(owner, roomId, "viewer");
  const viewer = await openRoomAs(browser, viewLink);

  await expect(viewer.getByRole("link", { name: "Replay" })).toHaveCount(0);
  await viewer.goto(`${new URL(viewer.url()).pathname}/replay${new URL(viewer.url()).search}`);
  await expect(viewer.getByText("Replay is for people who can edit")).toBeVisible();
});
