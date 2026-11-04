import { defineConfig, devices } from "@playwright/test";

// apart from the dev servers' ports, so e2e runs never collide with them
const PORT = 8790;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // a stray test.only would silently skip every other test in CI
  forbidOnly: !!process.env.CI,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
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
  // one server, as in production: the built web app (bundled pages, the files people get)
  // served by the app's own server, with the API and the rooms' WebSockets on the same origin
  webServer: {
    command: "(cd web && npx vite build) && npx tsx server/src/index.ts",
    env: {
      PORT: String(PORT),
      WEB_ORIGIN: `http://localhost:${PORT}`,
      WEB_DIR: "web/dist",
      VITE_RUN_TIME_LIMIT_MS: "3000", // endless loops end sooner than the real 10 s
      VITE_SENTRY_DSN: "http://e2e@sentry.invalid/1", // nowhere: tests catch what's sent
      // a placeholder GitHub app: tests check we send people to GitHub, not GitHub itself
      GITHUB_CLIENT_ID: "e2e-github-app",
      GITHUB_CLIENT_SECRET: "e2e-github-secret",
    },
    port: PORT,
    timeout: 120_000, // the build comes first
  },
});
