/**
 * Capture a square Gumroad thumbnail of the inbox (no crop).
 *
 * Usage:
 *   DEMO_APP_URL=http://127.0.0.1:5173 \
 *   DEMO_MAIL_DOMAIN=divinprince.com \
 *   DEMO_LOCAL_PART=hello \
 *   DEMO_PASSWORD=demopass123 \
 *   node scripts/demo/capture-inbox-thumb.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = process.env.DEMO_APP_URL || "http://127.0.0.1:5173";
const DOMAIN = (process.env.DEMO_MAIL_DOMAIN || "demo.local").toLowerCase();
const LOCAL = (process.env.DEMO_LOCAL_PART || "hello").toLowerCase();
const EMAIL = `${LOCAL}@${DOMAIN}`;
const PASS = process.env.DEMO_PASSWORD || "demopass123";
const OUT_DIR = process.env.DEMO_OUT || "/opt/cursor/artifacts";
const SIZE = Number(process.env.DEMO_THUMB_SIZE || 1600);

function detectChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("Chrome not found");
}

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: detectChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const context = await browser.newContext({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await context.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem("mail:theme", "dark");
  } catch {
    /* ignore */
  }
});

await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
if (!/\/(inbox|mail|starred|settings|admin)/.test(page.url())) {
  const email = page.locator('input[type="email"], input[name="email"], #email').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 15_000 });
  await email.fill(EMAIL);
  await password.fill(PASS);
  await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click();
  await page.waitForURL(/\/(inbox|onboarding|mail)/, { timeout: 20_000 });
}

await page.goto(`${APP}/inbox`, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  try {
    await fetch("/api/demo/seed", { method: "POST" });
  } catch {
    /* ignore */
  }
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);

await page.evaluate(() => {
  document.getElementById("demo-caption")?.remove();
  document.getElementById("demo-cursor")?.remove();
  document.getElementById("demo-chrome-style")?.remove();
});

await page.locator("a[href^='/mail/'], a[href*='/mail/']").first().waitFor({
  state: "visible",
  timeout: 15_000,
});
await page.waitForTimeout(400);

const outHi = join(OUT_DIR, "gumroad-inbox-thumb-1600.png");
await page.screenshot({ path: outHi, type: "png", fullPage: false });

await page.setViewportSize({ width: 1280, height: 1280 });
await page.waitForTimeout(350);
const outStd = join(OUT_DIR, "gumroad-inbox-thumb.png");
await page.screenshot({ path: outStd, type: "png", fullPage: false });

console.log(`Wrote ${outHi} and ${outStd}`);
await browser.close();
