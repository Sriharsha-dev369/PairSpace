// The README's pictures, taken from the real app (the production build, as e2e runs it), so they
// can be redone after a change instead of going stale. Not a test: skipped unless asked for.
//   npm run screenshots        (writes docs/images/; the GIF needs ffmpeg)

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { createRoom, memberBrowser, shareLink } from "./members";

const OUT = "docs/images";
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true };

const UTILS =
  "// shared helpers\nexport const show = (pair) => (pair ? `[${pair.join(', ')}]` : 'none');\n";
const MAIN = `import { show } from "./utils.js";

// Two Sum: the indices of two numbers that add up to the target
function twoSum(nums, target) {
  const seen = new Map();
  for (const [i, n] of nums.entries()) {
    if (seen.has(target - n)) return [seen.get(target - n), i];
    seen.set(n, i);
  }
  return null;
}

console.log("twoSum([2, 7, 11, 15], 9) =", show(twoSum([2, 7, 11, 15], 9)));
console.log("twoSum([3, 2, 4], 6) =", show(twoSum([3, 2, 4], 6)));
`;

test.describe.configure({ mode: "serial" });

// replaces the open file's code, as one paste (no auto-closed brackets)
async function write(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(code);
}

// a colour for a guest that isn't the owner's (people's colours are random; two alike would make
// the pictures confusing), set in the browser's saved guest identity before it opens the room
async function differentColour(owner: Page) {
  const taken = await owner
    .getByTestId("my-name")
    .locator("xpath=preceding-sibling::span[1]")
    .evaluate((chip) => getComputedStyle(chip).backgroundColor);
  const rgb = (hex: string) =>
    `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  return ["#34d399", "#f472b6", "#60a5fa"].find((hex) => rgb(hex) !== taken) ?? "#34d399";
}

async function guestBrowser(browser: Browser, name: string, color: string, options = {}) {
  const context = await browser.newContext(options);
  await context.addInitScript(
    (saved) => localStorage.setItem("pairspace:guest", JSON.stringify(saved)),
    { id: `guest-${name.replace(" ", "-").toLowerCase()}`, name, color },
  );
  return context;
}

// an invited guest who names themselves on the invite screen
async function guest(browser: Browser, link: string, name: string, color: string, options = {}) {
  const page = await (await guestBrowser(browser, name, color, options)).newPage();
  await page.goto(link);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  return page;
}

// Ada's room: two files, Grace in it, the code run
async function setUp(browser: Browser) {
  const owner = await memberBrowser(browser, DESKTOP, "Ada Lovelace");
  const roomId = await createRoom(owner, "Two Sum practice");
  const ada = await owner.newPage();
  await ada.goto(`/r/${roomId}`);
  await expect(ada.locator(".cm-content")).toBeVisible();
  await ada
    .getByRole("complementary", { name: "Files" })
    .getByRole("button", { name: "New file" })
    .click();
  await ada.getByLabel("File name").fill("utils.js");
  await ada.getByLabel("File name").press("Enter");
  await write(ada, UTILS);
  await ada.getByRole("button", { name: "main.js", exact: true }).first().click();
  await write(ada, MAIN);
  const link = await shareLink(owner, roomId);
  return { owner, roomId, ada, link };
}

test("README pictures", { tag: "@screenshots" }, async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });

  // the home page, as a visitor first sees it
  const visitor = await (await browser.newContext(DESKTOP)).newPage();
  await visitor.goto("/");
  await expect(visitor.getByTestId("live-demo")).toBeVisible();
  await visitor.waitForTimeout(5000); // Grace, in the demo, types for a while
  await visitor.screenshot({ path: `${OUT}/home.png` });

  const { roomId, ada, link } = await setUp(browser);

  // the invite screen Grace sees first
  const graceColour = await differentColour(ada);
  const invited = await (
    await guestBrowser(browser, "Grace Hopper", graceColour, DESKTOP)
  ).newPage();
  await invited.goto(link);
  await expect(invited.getByTestId("here-now")).toContainText("Ada Lovelace");
  await invited.getByLabel("Your name").fill("Grace Hopper");
  await invited.screenshot({ path: `${OUT}/invite.png` });
  await invited.getByRole("button", { name: "Join room" }).click();
  await expect(invited.locator(".cm-content")).toBeVisible();

  // the room: Grace's cursor in Ada's code, and the run's output for both
  await invited.locator(".cm-line").nth(7).click();
  await invited.keyboard.press("End");
  await ada.getByRole("button", { name: "Run", exact: true }).click();
  await expect(ada.getByTestId("run-output")).toContainText("[0, 1]");
  await expect(ada.locator(".cm-ySelectionInfo")).toHaveText("Grace Hopper");
  await ada.screenshot({ path: `${OUT}/room.png` });

  // the sync inspector, a few seconds into a simulated slow network
  await ada.getByRole("button", { name: /^Sync inspector/ }).click();
  await ada.waitForTimeout(4000);
  await ada.getByRole("radio", { name: "Slow", exact: true }).check();
  await ada.locator(".cm-line").nth(1).click();
  await ada.keyboard.type("// checked on a slow network");
  await ada.waitForTimeout(6000);
  await ada.screenshot({ path: `${OUT}/inspector.png` });
  await ada.getByRole("radio", { name: "Normal", exact: true }).check();
  await ada.getByRole("button", { name: "Close the sync inspector" }).click();

  // the room on Grace's phone, while Ada is still in it
  const phone = await guest(browser, link, "Grace Hopper", graceColour, PHONE);
  await expect(phone.getByText("2 people here")).toBeVisible();
  await phone.screenshot({ path: `${OUT}/phone.png` });
  await phone.context().close();

  // Grace adds a line, so replay has two people's colours
  await invited.locator(".cm-line").nth(10).click();
  await invited.keyboard.press("End");
  await invited.keyboard.press("Enter");
  await invited.keyboard.type("// Grace: one pass, O(n) time");
  await expect(ada.locator(".cm-content")).toContainText("Grace: one pass");
  await ada.waitForTimeout(1500); // saved (writes are batched for half a second)
  await ada.goto(`/r/${roomId}/replay`);
  await expect(ada.getByRole("button", { name: "Play" })).toBeVisible();
  await ada.screenshot({ path: `${OUT}/replay.png` });
});

// two people typing in one file at once, side by side, as a GIF (needs ffmpeg)
test("README live GIF", { tag: "@screenshots" }, async ({ browser }) => {
  test.setTimeout(120_000);
  const size = { width: 1000, height: 560 }; // wide enough for the desktop layout (768+)
  const videos = mkdtempSync(join(tmpdir(), "pairspace-gif-"));
  const recorded = { viewport: size, recordVideo: { dir: videos, size } };

  const owner = await memberBrowser(browser, recorded, "Ada Lovelace");
  const roomId = await createRoom(owner, "Two Sum practice");
  const adaOpened = Date.now();
  const ada = await owner.newPage();
  await ada.goto(`/r/${roomId}`);
  await expect(ada.locator(".cm-content")).toBeVisible();
  // one file, so no import: just the function, for Grace to call
  await write(ada, MAIN.replace(/^import.*\n\n/, "").replace(/console\.log[\s\S]*/, ""));
  const graceOpened = Date.now();
  const grace = await guest(
    browser,
    await shareLink(owner, roomId),
    "Grace Hopper",
    await differentColour(ada),
    recorded,
  );

  const start = Date.now();
  await ada.locator(".cm-line").first().click(); // the comment above the function
  await ada.keyboard.press("End");
  await grace.locator(".cm-line").last().click();
  await Promise.all([
    ada.keyboard.type("\n// Ada: remember each number's index", { delay: 55 }),
    grace.keyboard.type("\nconsole.log(twoSum([2, 7, 11, 15], 9));", { delay: 55 }),
  ]);
  await ada.getByRole("button", { name: "Run", exact: true }).click();
  await expect(grace.getByTestId("run-output")).toContainText("[0,1]"); // both see the output
  await ada.waitForTimeout(1500);
  const seconds = (Date.now() - start) / 1000;
  const [adaVideo, graceVideo] = [ada.video(), grace.video()];
  await ada.context().close();
  await grace.context().close();

  // each recording from the moment the typing began, side by side, then a GIF with its own palette
  const from = (opened: number) => ((start - opened) / 1000).toFixed(2);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    from(adaOpened),
    "-t",
    seconds.toFixed(2),
    "-i",
    (await adaVideo?.path()) ?? "",
    "-ss",
    from(graceOpened),
    "-t",
    seconds.toFixed(2),
    "-i",
    (await graceVideo?.path()) ?? "",
    "-filter_complex",
    "[0:v][1:v]hstack=inputs=2,fps=12,scale=1600:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
    `${OUT}/live.gif`,
  ]);
});
