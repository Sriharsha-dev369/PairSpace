import { defineConfig, devices } from "@playwright/test";

// separate ports from the dev servers, so e2e runs never collide with them
const SERVER_PORT = 8790;
const WEB_PORT = 5190;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // a stray test.only would silently skip every other test in CI
  forbidOnly: !!process.env.CI,
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Run's sandbox rests on rules each browser engine applies its own way (Safari refused what
    // Chrome allowed), so its tests run in each engine
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: "run.spec.ts" },
    // Playwright's Firefox doesn't start on the development Mac, so it runs in CI only
    ...(process.env.CI
      ? [{ name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: "run.spec.ts" }]
      : []),
  ],
  webServer: [
    {
      command: "npx tsx server/src/index.ts",
      env: {
        PORT: String(SERVER_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        // a placeholder GitHub app: tests check we send people to GitHub, not GitHub itself
        GITHUB_CLIENT_ID: "e2e-github-app",
        GITHUB_CLIENT_SECRET: "e2e-github-secret",
      },
      port: SERVER_PORT,
    },
    {
      // the production build, as people get it: bundled pages, not the dev server's hundreds of
      // separate files (which every fresh test browser downloaded again). The type check is
      // CI's other job, so this builds without it
      command: `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`,
      cwd: "web",
      timeout: 120_000, // the build comes first
      env: {
        VITE_SYNC_URL: `ws://localhost:${SERVER_PORT}`,
        VITE_RUN_TIME_LIMIT_MS: "3000", // endless loops end sooner than the real 10 s
        SERVER_URL: `http://localhost:${SERVER_PORT}`, // where Vite's /api proxy forwards to
      },
      url: `http://localhost:${WEB_PORT}`,
    },
  ],
});
