// End-to-end spec for Run: code runs in the browser of whoever pressed Run, in a sandbox, and
// everyone in the room sees the output (M7's done-when). The time limit here is 3 s.

import { expect, type Page, test } from "@playwright/test";
import {
  createRoom,
  fileList,
  memberBrowser,
  newFile,
  newRoomUrl,
  openRoomAs,
  shareLink,
  twoGuestsIn,
} from "./members";

const output = (page: Page) => page.getByTestId("run-output");
const runStatus = (page: Page) => page.getByTestId("run-status");

// replaces the open file's code (as one paste: no auto-closed brackets)
async function write(page: Page, code: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(code);
}

async function run(page: Page, code: string) {
  await write(page, code);
  await page.getByRole("button", { name: "Run", exact: true }).click();
}

test("a run by one person shows its output to everyone, with who ran it", async ({ browser }) => {
  const [alice, bob] = await twoGuestsIn(browser);
  const aliceName = await alice.getByTestId("my-name").innerText();

  await run(alice, 'console.log("hello from " + "alice", 6 * 7, { ok: true });');

  for (const page of [alice, bob]) {
    await expect(output(page)).toHaveText('hello from alice 42 {"ok":true}');
    await expect(runStatus(page)).toContainText(`${aliceName} ran main.js`);
  }
});

test("an endless loop is stopped at the time limit, and the room can run again", async ({
  browser,
}) => {
  const [alice, bob] = await twoGuestsIn(browser);

  await run(alice, "while (true) {}");

  await expect(runStatus(bob)).toContainText("is running", { timeout: 2000 });
  await expect(runStatus(bob)).toContainText("time limit", { timeout: 6000 });
  await run(alice, 'console.log("again")');
  await expect(output(bob)).toHaveText("again");
});

test("anyone in the room can stop a run, and everyone sees who stopped it", async ({ browser }) => {
  const [alice, bob] = await twoGuestsIn(browser);
  const bobName = await bob.getByTestId("my-name").innerText();

  await run(alice, 'setInterval(() => console.log("tick"), 100);');
  await expect(output(bob)).toContainText("tick");
  await expect(bob.getByRole("button", { name: "Run", exact: true })).toHaveCount(0); // one at a time

  await bob.getByRole("button", { name: "Stop", exact: true }).click();

  for (const page of [alice, bob]) {
    await expect(runStatus(page)).toContainText(`Stopped by ${bobName}`);
  }
});

test("someone who opens the room later sees the last run's output", async ({ browser }) => {
  const url = await newRoomUrl(browser);
  const alice = await openRoomAs(browser, url);
  await run(alice, 'console.log("for later")');
  await expect(runStatus(alice)).toContainText("ran main.js");

  const carol = await openRoomAs(browser, url);

  await expect(output(carol)).toHaveText("for later");
});

test("a run shows as interrupted when the browser running it leaves", async ({ browser }) => {
  const [alice, bob] = await twoGuestsIn(browser);
  await run(alice, 'setInterval(() => console.log("tick"), 100);');
  await expect(output(bob)).toContainText("tick");

  await alice.close();

  await expect(runStatus(bob)).toContainText("Interrupted");
  await expect(bob.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
});

test("an error says what went wrong, and in which file and line", async ({ browser }) => {
  const page = await openRoomAs(browser, await newRoomUrl(browser));

  await run(page, 'const ok = 1;\nfunction f() { throw new TypeError("nope"); }\nf();');

  await expect(output(page)).toContainText("TypeError: nope");
  await expect(output(page)).toContainText("main.js:2");
});

test("the open file can import the room's other files", async ({ browser }) => {
  const page = await openRoomAs(browser, await newRoomUrl(browser));
  await newFile(page, "src/utils.js");
  await write(
    page,
    'export const twice = (n) => n * 2;\nexport const fail = () => { throw new RangeError("too big"); };',
  );
  await fileList(page).getByRole("button", { name: "main.js", exact: true }).click();

  await run(
    page,
    'import { twice } from "./src/utils.js";\nconsole.log("twice 21 is", twice(21));',
  );
  await expect(output(page)).toHaveText("twice 21 is 42");

  // an error in an imported file names that file
  await run(page, 'import { fail } from "./src/utils";\nfail();');
  await expect(output(page)).toContainText("RangeError: too big");
  await expect(output(page)).toContainText("src/utils.js:2");
});

test("an import that can't be followed says why, without running anything", async ({ browser }) => {
  const page = await openRoomAs(browser, await newRoomUrl(browser));

  await run(page, 'console.log("ran anyway");\nimport { x } from "./missing.js";');

  await expect(output(page)).toHaveText("Can't find './missing.js', imported by main.js.");
  await expect(runStatus(page)).toContainText("ended with an error");
});

test("code that runs can't act as the person who ran it", async ({ browser }) => {
  const owner = await memberBrowser(browser);
  const roomId = await createRoom(owner, "Mine");
  const page = await owner.newPage();
  await page.goto(`/r/${roomId}`);
  const api = `${new URL(page.url()).origin}/api/rooms`;

  await run(
    page,
    `for (const method of ["GET", "POST"]) {
  try {
    const response = await fetch("${api}", { method, credentials: "include", body: method === "POST" ? "{}" : undefined });
    console.log(method, response.status);
  } catch (error) {
    console.log(method, "blocked");
  }
}`,
  );

  await expect(output(page)).toHaveText("GET blocked\nPOST blocked");
  expect(await (await owner.request.get("/api/rooms")).json()).toHaveLength(1); // nothing made
});

test("someone with a view-only link watches runs, but can't start or stop one", async ({
  browser,
}) => {
  const owner = await memberBrowser(browser);
  const roomId = await createRoom(owner);
  const ownerPage = await owner.newPage();
  await ownerPage.goto(`/r/${roomId}`);
  const viewer = await openRoomAs(browser, await shareLink(owner, roomId, "viewer"));

  await run(ownerPage, 'setInterval(() => console.log("tick"), 100);');

  await expect(output(viewer)).toContainText("tick");
  await expect(viewer.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await ownerPage.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(viewer.getByRole("button", { name: "Run", exact: true })).toHaveCount(0);
});
