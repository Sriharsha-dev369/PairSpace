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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx server/src/index.ts",
      env: { PORT: String(SERVER_PORT), WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
      port: SERVER_PORT,
    },
    {
      command: `npm run dev -w web -- --port ${WEB_PORT} --strictPort`,
      env: {
        VITE_SYNC_URL: `ws://localhost:${SERVER_PORT}`,
        SERVER_URL: `http://localhost:${SERVER_PORT}`, // where Vite's /api proxy forwards to
      },
      url: `http://localhost:${WEB_PORT}`,
    },
  ],
});
