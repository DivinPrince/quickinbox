/**
 * Cinematic silent product demo — visible cursor, auto zooms, short captions.
 * Adapted from the DivinPrince/dpskills demo-video skill (no narration).
 *
 * Usage:
 *   DEMO_APP_URL=http://127.0.0.1:5173 \
 *   DEMO_MAIL_DOMAIN=your.domain \
 *   DEMO_LOCAL_PART=hello \
 *   DEMO_NAME="Demo User" \
 *   DEMO_PASSWORD=demopass123 \
 *   node scripts/demo/record-cinematic.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { mkdir, readdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.DEMO_APP_URL || "http://127.0.0.1:5173";
const OUT = process.env.DEMO_OUT || "/tmp/demo-artifacts";
const RAW = join(OUT, "raw");
const DOMAIN = (process.env.DEMO_MAIL_DOMAIN || "demo.local").toLowerCase();
const LOCAL_PART = (process.env.DEMO_LOCAL_PART || "hello").toLowerCase();
const NAME = process.env.DEMO_NAME || "Demo User";
const PASSWORD = process.env.DEMO_PASSWORD || "demopass123";
const MAILBOX = `${LOCAL_PART}@${DOMAIN}`;

await rm(RAW, { recursive: true, force: true });
await mkdir(RAW, { recursive: true });
await mkdir(OUT, { recursive: true });

const scenes = JSON.parse(await readFile(join(__dirname, "scenes.json"), "utf8"));
const byId = Object.fromEntries(scenes.map((s) => [s.id, s]));

// Personalize the account-create caption at record time (domain stays out of git).
if (byId["02-account"]) {
  byId["02-account"].caption = `Create ${MAILBOX}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cues = [];
const t0 = Date.now();
const now = () => Date.now() - t0;

function detectChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("Set CHROME_PATH to your Chrome/Chromium binary");
}

function assTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

async function scene(id, work) {
  const seg = byId[id];
  if (!seg) throw new Error(`missing scene ${id}`);
  const startMs = now();
  console.log(`[${(startMs / 1000).toFixed(1)}s] ${id} — ${seg.caption}`);
  await work();
  const elapsed = now() - startMs;
  const target = Math.ceil((seg.holdSec || 3) * 1000);
  if (elapsed < target) await sleep(target - elapsed);
  const endMs = now();
  if (cues.length && cues[cues.length - 1].endMs > startMs) {
    cues[cues.length - 1].endMs = startMs;
  }
  cues.push({ startMs, endMs, text: seg.caption });
}

async function moveTo(page, locator, steps = 18) {
  const box = await locator.boundingBox();
  if (!box) return null;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 14);
  await page.mouse.move(x, y, { steps });
  await sleep(70);
  return { x, y, box };
}

async function click(page, locator) {
  // Camera transforms on <body> can skew hit-testing — flatten before acting.
  await zoomReset(page, 120).catch(() => {});
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await moveTo(page, locator);
  await locator.click({ force: true });
}

async function typeInto(page, locator, text, delay = 22) {
  await click(page, locator);
  await locator.fill("");
  await locator.pressSequentially(text, { delay });
}

/** Cinematic camera: quick zoom toward a locator, with a light 3D tilt. */
async function zoomTo(page, locator, { scale = 1.18, tilt = 1.6, ms = 700 } = {}) {
  const box = await locator.boundingBox().catch(() => null);
  const ox = box ? ((box.x + box.width / 2) / 1440) * 100 : 50;
  const oy = box ? ((box.y + box.height / 2) / 900) * 100 : 40;
  await page.evaluate(
    ({ ox, oy, scale, tilt, ms }) => {
      const root = document.documentElement;
      root.style.setProperty("--demo-ox", `${ox}%`);
      root.style.setProperty("--demo-oy", `${oy}%`);
      root.style.setProperty("--demo-scale", String(scale));
      root.style.setProperty("--demo-tilt", `${tilt}deg`);
      root.style.setProperty("--demo-cam-ms", `${ms}ms`);
      root.classList.add("demo-cam-live");
    },
    { ox, oy, scale, tilt, ms },
  );
  await sleep(ms + 40);
}

async function zoomReset(page, ms = 450) {
  await page.evaluate((ms) => {
    const root = document.documentElement;
    root.style.setProperty("--demo-cam-ms", `${ms}ms`);
    root.style.setProperty("--demo-scale", "1");
    root.style.setProperty("--demo-tilt", "0deg");
    root.style.setProperty("--demo-ox", "50%");
    root.style.setProperty("--demo-oy", "45%");
  }, ms);
  await sleep(ms + 40);
}

const browser = await chromium.launch({
  executablePath: detectChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: RAW, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

await page.addInitScript(() => {
  const install = () => {
    if (document.getElementById("demo-cursor")) return;

    const style = document.createElement("style");
    style.id = "demo-cinematic-style";
    style.textContent = `
      html {
        --demo-ox: 50%;
        --demo-oy: 45%;
        --demo-scale: 1;
        --demo-tilt: 0deg;
        --demo-cam-ms: 500ms;
      }
      html.demo-cam-live body {
        transform-origin: var(--demo-ox) var(--demo-oy);
        transform: perspective(1400px) rotateY(var(--demo-tilt)) scale(var(--demo-scale));
        transition: transform var(--demo-cam-ms) cubic-bezier(.22,.61,.36,1);
        will-change: transform;
      }
      #demo-cursor {
        position: fixed; left: 0; top: 0; width: 22px; height: 22px;
        margin-left: -2px; margin-top: -2px; pointer-events: none;
        z-index: 2147483647; transform: translate(-120px,-120px);
        transition: transform 35ms linear;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.55));
      }
      /* Hide noisy overlays during recording */
      vite-error-overlay, [data-svelte-h] > .vite-error { display: none !important; }
    `;
    document.documentElement.appendChild(style);

    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 3 L4 19 L9.5 14.5 L13 22 L15.5 21 L12 13.5 L19 13 Z"
        fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(cursor);
    window.addEventListener(
      "mousemove",
      (e) => {
        cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      },
      { passive: true },
    );
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
});

try {
  await scene("01-setup", async () => {
    await page.goto(`${APP_URL}/setup`, { waitUntil: "networkidle" });
    await sleep(500);
    const domainBtn = page.locator("button.domain-card").filter({ hasText: DOMAIN }).first();
    await domainBtn.waitFor({ state: "visible", timeout: 20_000 });
    await zoomTo(page, domainBtn, { scale: 1.22, tilt: -1.8, ms: 650 });
    await click(page, domainBtn);
    await sleep(350);
    const cont = page.getByRole("button", { name: /Continue/i });
    await zoomTo(page, cont, { scale: 1.12, tilt: 1.2, ms: 420 });
    await click(page, cont);
    await page.getByLabel("Your name").waitFor({ state: "visible" });
  });

  await scene("02-account", async () => {
    await zoomReset(page, 380);
    await typeInto(page, page.getByLabel("Your name"), NAME, 28);
    await sleep(200);
    const address = page.getByLabel("Your address");
    await zoomTo(page, address, { scale: 1.16, tilt: 1.4, ms: 450 });
    await typeInto(page, address, LOCAL_PART, 30);
    await sleep(180);
    await typeInto(page, page.getByLabel("Password", { exact: true }), PASSWORD, 18);
    await typeInto(page, page.getByLabel("Confirm password"), PASSWORD, 18);
    const create = page.getByRole("button", { name: /Create account/i });
    await zoomTo(page, create, { scale: 1.14, tilt: -1.2, ms: 400 });
    await click(page, create);
    await page.waitForURL(/\/(inbox|onboarding)/, { timeout: 30_000 });
    await sleep(400);
  });

  await scene("03-inbox", async () => {
    // Seed dummy mail so the tour isn't empty.
    const seed = await page.evaluate(async () => {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      return res.json();
    });
    console.log("seed", seed);
    await page.goto(`${APP_URL}/inbox`, { waitUntil: "networkidle" });
    await zoomReset(page, 300);
    await sleep(400);
    const list = page.locator("main, .mailbox, [class*='mailbox']").first();
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await zoomTo(page, list, { scale: 1.08, tilt: 1.1, ms: 700 });
    await moveTo(page, row);
    await sleep(500);
  });

  await scene("04-thread", async () => {
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    await zoomTo(page, row, { scale: 1.2, tilt: -1.5, ms: 480 });
    await click(page, row);
    await page.waitForURL(/\/mail\//, { timeout: 15_000 });
    await sleep(500);
    const body = page.locator("article, .thread, main").first();
    await zoomTo(page, body, { scale: 1.12, tilt: 1.3, ms: 700 });
    await sleep(600);
    const star = page.getByRole("button", { name: /star/i }).first();
    if (await star.count()) {
      await click(page, star);
      await sleep(350);
    }
  });

  await scene("05-compose", async () => {
    await zoomReset(page, 350);
    const compose = page.getByRole("link", { name: /New message/i });
    await zoomTo(page, compose, { scale: 1.18, tilt: 1.6, ms: 420 });
    await click(page, compose);
    await page.waitForURL(/\/compose/, { timeout: 15_000 });
    await sleep(300);

    const to = page.locator('input[placeholder*="recipient"], input[name="to"], input[type="email"]').first();
    const toAlt = page.getByPlaceholder(/recipient@example.com/i);
    const toField = (await toAlt.count()) ? toAlt : to;
    await zoomTo(page, toField, { scale: 1.15, tilt: -1.2, ms: 400 });
    await typeInto(page, toField, "maya@northwind.studio", 20);

    const subject = page.getByPlaceholder(/^Subject$/i);
    await typeInto(page, subject, `Quick update from ${DOMAIN}`, 16);

    // Rich text editor — prefer contenteditable.
    const editor = page.locator('[contenteditable="true"], .ProseMirror, .tiptap').first();
    await click(page, editor);
    await page.keyboard.type(
      `Hey Maya — mail on ${DOMAIN} is live. Sending this from the QuickMail composer.`,
      { delay: 16 },
    );
    await sleep(300);

    const send = page.locator('form.compose-page button.btn-primary[type="submit"]');
    await send.waitFor({ state: "visible", timeout: 10_000 });
    await zoomTo(page, send, { scale: 1.16, tilt: 1.4, ms: 400 });
    await click(page, send);
    await page.waitForURL(/\/(inbox|sent|mail)/, { timeout: 20_000 }).catch(() => {});
    await sleep(500);
    await zoomTo(page, page.locator("main").first(), { scale: 1.08, tilt: 1.0, ms: 500 });
  });

  await scene("06-starred", async () => {
    await zoomReset(page, 300);
    const starred = page.locator('a.nav-link[href="/starred"]');
    await zoomTo(page, starred, { scale: 1.2, tilt: -1.6, ms: 420 });
    await click(page, starred);
    await page.waitForURL(/\/starred/, { timeout: 10_000 });
    await sleep(700);
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    if (await row.count()) {
      await zoomTo(page, row, { scale: 1.14, tilt: 1.2, ms: 550 });
      await moveTo(page, row);
    }
  });

  await scene("07-sent", async () => {
    await zoomReset(page, 280);
    const sent = page.locator('a.nav-link[href="/sent"]');
    await click(page, sent);
    await page.waitForURL(/\/sent/, { timeout: 10_000 });
    await sleep(500);
    await zoomTo(page, page.locator("main").first(), { scale: 1.1, tilt: 1.0, ms: 500 });
    const drafts = page.locator('a.nav-link[href="/drafts"]');
    await click(page, drafts);
    await page.waitForURL(/\/drafts/, { timeout: 10_000 });
    await sleep(600);
  });

  await scene("08-settings", async () => {
    await zoomReset(page, 280);
    const settings = page.locator('a.nav-link[href="/settings"]');
    await zoomTo(page, settings, { scale: 1.18, tilt: -1.4, ms: 420 });
    await click(page, settings);
    await page.waitForURL(/\/settings/, { timeout: 10_000 });
    await sleep(500);
    await zoomTo(page, page.locator("main").first(), { scale: 1.12, tilt: 1.5, ms: 700 });
    await sleep(700);
    const admin = page.locator('a.nav-link[href="/admin"]');
    if (await admin.count()) {
      await click(page, admin);
      await page.waitForURL(/\/admin/, { timeout: 10_000 });
      await sleep(700);
      await zoomTo(page, page.locator("main").first(), { scale: 1.1, tilt: -1.2, ms: 600 });
    }
    await zoomReset(page, 500);
    await sleep(400);
  });

  console.log(`Recording finished ${page.url()} total=${(now() / 1000).toFixed(1)}s mailbox=${MAILBOX}`);
} catch (err) {
  console.error(err);
  await page.screenshot({ path: join(OUT, "error.png"), fullPage: true }).catch(() => {});
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(1);
}

await context.close();
await browser.close();

let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 900
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,15,&H00FFFFFF,&H000000FF,&H80000000,&H64000000,0,0,0,0,100,100,0,0,1,1.1,0,2,48,48,14,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
for (const c of cues) {
  ass += `Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Default,,0,0,0,,${c.text.replaceAll(",", "\\,")}\n`;
}
await writeFile(join(OUT, "captions.ass"), ass);
await writeFile(join(OUT, "cues.json"), JSON.stringify(cues, null, 2));

const webm = (await readdir(RAW)).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no webm recorded");
await copyFile(join(RAW, webm), join(OUT, "silent.webm"));
console.log(`Wrote ${join(OUT, "silent.webm")} and captions.ass — run scripts/demo/mux-silent.sh next`);
