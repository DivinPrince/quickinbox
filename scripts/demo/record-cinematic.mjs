/**
 * Silent product demo — visible custom cursor, short captions, no auto-zoom.
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
import { existsSync, readFileSync } from "node:fs";
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

const cursorSvg = readFileSync(join(__dirname, "assets/cursor.svg"), "utf8");
const cursorDataUri = `data:image/svg+xml;base64,${Buffer.from(cursorSvg).toString("base64")}`;

await rm(RAW, { recursive: true, force: true });
await mkdir(RAW, { recursive: true });
await mkdir(OUT, { recursive: true });

const scenes = JSON.parse(await readFile(join(__dirname, "scenes.json"), "utf8"));
const byId = Object.fromEntries(scenes.map((s) => [s.id, s]));

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
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) return null;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 14);
  await page.mouse.move(x, y, { steps });
  await sleep(80);
  return { x, y, box };
}

async function click(page, locator) {
  await moveTo(page, locator);
  await locator.click();
}

async function typeInto(page, locator, text, delay = 22) {
  await click(page, locator);
  await locator.fill("");
  await locator.pressSequentially(text, { delay });
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

await page.addInitScript((cursorSrc) => {
  const install = () => {
    if (document.getElementById("demo-cursor")) return;

    const style = document.createElement("style");
    style.id = "demo-cursor-style";
    style.textContent = `
      #demo-cursor {
        position: fixed; left: 0; top: 0; width: 32px; height: 32px;
        margin-left: -10px; margin-top: -7px; pointer-events: none;
        z-index: 2147483647; transform: translate(-120px,-120px);
        transition: transform 35ms linear;
        background: url("${cursorSrc}") no-repeat center / contain;
      }
      vite-error-overlay { display: none !important; }
    `;
    document.documentElement.appendChild(style);

    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
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
}, cursorDataUri);

try {
  await scene("01-setup", async () => {
    await page.goto(`${APP_URL}/setup`, { waitUntil: "networkidle" });
    await sleep(500);
    const domainBtn = page.locator("button.domain-card").filter({ hasText: DOMAIN }).first();
    await domainBtn.waitFor({ state: "visible", timeout: 20_000 });
    await click(page, domainBtn);
    await sleep(350);
    await click(page, page.getByRole("button", { name: /Continue/i }));
    await page.getByLabel("Your name").waitFor({ state: "visible" });
  });

  await scene("02-account", async () => {
    await typeInto(page, page.getByLabel("Your name"), NAME, 28);
    await sleep(200);
    await typeInto(page, page.getByLabel("Your address"), LOCAL_PART, 30);
    await sleep(180);
    await typeInto(page, page.getByLabel("Password", { exact: true }), PASSWORD, 18);
    await typeInto(page, page.getByLabel("Confirm password"), PASSWORD, 18);
    await click(page, page.getByRole("button", { name: /Create account/i }));
    await page.waitForURL(/\/(inbox|onboarding)/, { timeout: 30_000 });
    await sleep(400);
  });

  await scene("03-inbox", async () => {
    const seed = await page.evaluate(async () => {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      return res.json();
    });
    console.log("seed", seed);
    await page.goto(`${APP_URL}/inbox`, { waitUntil: "networkidle" });
    await sleep(400);
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await moveTo(page, row);
    await sleep(500);
  });

  await scene("04-thread", async () => {
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    await click(page, row);
    await page.waitForURL(/\/mail\//, { timeout: 15_000 });
    await sleep(500);
    await moveTo(page, page.locator("article, .thread, main").first());
    await sleep(600);
    const star = page.getByRole("button", { name: /star/i }).first();
    if (await star.count()) {
      await click(page, star);
      await sleep(350);
    }
  });

  await scene("05-compose", async () => {
    const compose = page.locator('a.new-message, a[href="/compose"]').first();
    await click(page, compose);
    await page.waitForURL(/\/compose/, { timeout: 15_000 });
    await sleep(300);

    const toAlt = page.getByPlaceholder(/recipient@example.com/i);
    const to = page.locator('input[placeholder*="recipient"]').first();
    const toField = (await toAlt.count()) ? toAlt : to;
    await typeInto(page, toField, "maya@northwind.studio", 20);

    const subject = page.getByPlaceholder(/^Subject$/i);
    await typeInto(page, subject, `Quick update from ${DOMAIN}`, 16);

    const editor = page.locator('[contenteditable="true"]').first();
    await click(page, editor);
    await page.keyboard.type(
      `Hey Maya — mail on ${DOMAIN} is live. Sending this from the QuickMail composer.`,
      { delay: 16 },
    );
    await sleep(300);

    const send = page.locator('form.compose-page button.btn-primary[type="submit"]');
    await send.waitFor({ state: "visible", timeout: 10_000 });
    await click(page, send);
    await page.waitForURL(/\/(inbox|sent|mail)/, { timeout: 20_000 }).catch(() => {});
    await sleep(500);
  });

  await scene("06-starred", async () => {
    const starred = page.locator('a.nav-link[href="/starred"]');
    await click(page, starred);
    await page.waitForURL(/\/starred/, { timeout: 10_000 });
    await sleep(700);
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    if (await row.count()) {
      await moveTo(page, row);
    }
  });

  await scene("07-sent", async () => {
    await click(page, page.locator('a.nav-link[href="/sent"]'));
    await page.waitForURL(/\/sent/, { timeout: 10_000 });
    await sleep(500);
    await moveTo(page, page.locator("main").first());
    await click(page, page.locator('a.nav-link[href="/drafts"]'));
    await page.waitForURL(/\/drafts/, { timeout: 10_000 });
    await sleep(600);
  });

  await scene("08-settings", async () => {
    await click(page, page.locator('a.nav-link[href="/settings"]'));
    await page.waitForURL(/\/settings/, { timeout: 10_000 });
    await sleep(500);
    await moveTo(page, page.locator("main").first());
    await sleep(700);
    const admin = page.locator('a.nav-link[href="/admin"]');
    if (await admin.count()) {
      await click(page, admin);
      await page.waitForURL(/\/admin/, { timeout: 10_000 });
      await sleep(700);
      await moveTo(page, page.locator("main").first());
    }
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
