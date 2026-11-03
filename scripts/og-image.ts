// Draws the pictures other apps show for PairSpace: the link-preview card (web/public/og.png,
// 1200×630, from og-card.html) and the home-screen icon (web/public/apple-touch-icon.png, the
// logo at 180×180, square: phones round the corners themselves). Run after changing either:
//   npm run og-image

import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const browser = await chromium.launch();
const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await card.goto(`file://${here("og-card.html")}`);
await card.evaluate(() => document.fonts.ready);
await card.screenshot({ path: here("../web/public/og.png") });

const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
await icon.setContent(`<body style="margin:0"><svg width="180" height="180" viewBox="0 0 32 32">
  <defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a5a6ff"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs>
  <rect width="32" height="32" fill="url(#m)"/>
  <rect x="10" y="8" width="3" height="16" rx="1.5" fill="#0b0c10"/>
  <rect x="19" y="8" width="3" height="16" rx="1.5" fill="#0b0c10" opacity="0.55"/></svg></body>`);
await icon.screenshot({ path: here("../web/public/apple-touch-icon.png") });

await browser.close();
