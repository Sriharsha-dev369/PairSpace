// Waiting helpers shared by the test files: tests wait for conditions, never for fixed times.

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// poll until a condition is true (never sleep and hope); the condition may query the database
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 1000,
) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${what}`);
    await sleep(5);
  }
}

// To prove something did NOT happen we can't wait for it. Instead we wait for something we know
// will happen, then give the network a short extra moment, then check.
export const SETTLE_MS = 50;
