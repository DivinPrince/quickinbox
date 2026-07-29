/**
 * Silent product demo — bigger custom cursor, top-right slide-in captions,
 * screenshots at each beat. No auto-zoom, no burned subtitle bar.
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
const SHOTS = join(OUT, "shots");
const DOMAIN = (process.env.DEMO_MAIL_DOMAIN || "demo.local").toLowerCase();
const LOCAL_PART = (process.env.DEMO_LOCAL_PART || "hello").toLowerCase();
const NAME = process.env.DEMO_NAME || "Demo User";
const PASSWORD = process.env.DEMO_PASSWORD || "demopass123";
const MAILBOX = `${LOCAL_PART}@${DOMAIN}`;

const cursorSvg = readFileSync(join(__dirname, "assets/cursor.svg"), "utf8");
const cursorDataUri = `data:image/svg+xml;base64,${Buffer.from(cursorSvg).toString("base64")}`;

await rm(RAW, { recursive: true, force: true });
await rm(SHOTS, { recursive: true, force: true });
await mkdir(RAW, { recursive: true });
await mkdir(SHOTS, { recursive: true });
await mkdir(OUT, { recursive: true });

const scenes = JSON.parse(await readFile(join(__dirname, "scenes.json"), "utf8"));
const byId = Object.fromEntries(scenes.map((s) => [s.id, s]));

if (byId["02-account"]) {
  byId["02-account"].caption = `Create ${MAILBOX}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cues = [];
const shotIndex = { n: 0 };
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

async function showCaption(page, text) {
  await page.evaluate((text) => {
    window.__demoCaption?.show(text);
  }, text);
}

async function hideCaption(page) {
  await page.evaluate(() => {
    window.__demoCaption?.hide();
  }).catch(() => {});
}

async function snap(page, label) {
  shotIndex.n += 1;
  const name = `${String(shotIndex.n).padStart(2, "0")}-${label}.png`;
  const path = join(SHOTS, name);
  await page.screenshot({ path, type: "png" });
  console.log(`  shot ${name}`);
  return path;
}

async function scene(id, work) {
  const seg = byId[id];
  if (!seg) throw new Error(`missing scene ${id}`);
  const startMs = now();
  console.log(`[${(startMs / 1000).toFixed(1)}s] ${id} — ${seg.caption}`);
  await showCaption(page, seg.caption);
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
    if (document.getElementById("demo-chrome-style")) return;

    const style = document.createElement("style");
    style.id = "demo-chrome-style";
    style.textContent = `
      #demo-cursor {
        position: fixed; left: 0; top: 0; width: 56px; height: 56px;
        margin-left: -17px; margin-top: -12px; pointer-events: none;
        z-index: 2147483647; transform: translate(-160px,-160px);
        transition: transform 35ms linear;
        background: url("${cursorSrc}") no-repeat center / contain;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,.4));
      }
      #demo-caption {
        position: fixed;
        top: 1.1rem;
        right: 1.1rem;
        z-index: 2147483646;
        pointer-events: none;
        max-width: min(24rem, calc(100vw - 2.2rem));
        padding: 0.8rem 1.1rem 0.8rem 0.95rem;
        border-radius: 1rem;
        font: 600 1rem/1.35 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
        letter-spacing: -0.02em;
        color: #f7f7f4;
        background: linear-gradient(135deg, rgba(22,24,23,.9), rgba(12,13,12,.86));
        backdrop-filter: blur(16px) saturate(1.25);
        -webkit-backdrop-filter: blur(16px) saturate(1.25);
        box-shadow:
          0 0 0 1px rgba(255,255,255,.1),
          0 16px 48px rgba(0,0,0,.32);
        display: flex;
        align-items: center;
        gap: 0.7rem;
        opacity: 0;
        transform: translateX(120%);
        transition:
          transform 480ms cubic-bezier(.22,.61,.36,1),
          opacity 300ms ease;
      }
      #demo-caption.visible {
        opacity: 1;
        transform: translateX(0);
      }
      #demo-caption::before {
        content: "";
        width: 0.4rem;
        height: 0.4rem;
        border-radius: 9999px;
        flex: 0 0 auto;
        background: #90ac9a;
        box-shadow: 0 0 0 3px rgba(144, 172, 154, 0.28);
      }
      #demo-caption-text { min-width: 0; }
      vite-error-overlay { display: none !important; }
    `;
    document.documentElement.appendChild(style);

    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    document.documentElement.appendChild(cursor);

    const caption = document.createElement("div");
    caption.id = "demo-caption";
    caption.innerHTML = `<span id="demo-caption-text"></span>`;
    document.documentElement.appendChild(caption);

    window.addEventListener(
      "mousemove",
      (e) => {
        cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      },
      { passive: true },
    );

    window.__demoCaption = {
      show(text) {
        const el = document.getElementById("demo-caption");
        const label = document.getElementById("demo-caption-text");
        if (!el || !label) return;
        label.textContent = text;
        // Retrigger slide-in when text changes mid-tour.
        el.classList.remove("visible");
        void el.offsetWidth;
        el.classList.add("visible");
      },
      hide() {
        document.getElementById("demo-caption")?.classList.remove("visible");
      },
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
}, cursorDataUri);

try {
  await scene("01-setup", async () => {
    await page.goto(`${APP_URL}/setup`, { waitUntil: "networkidle" });
    await showCaption(page, byId["01-setup"].caption);
    await sleep(900);
    await moveTo(page, page.locator(".partner, .partner-marks").first()).catch(() => {});
    await sleep(400);
    await snap(page, "setup-logos");
    const domainBtn = page.locator("button.domain-card").filter({ hasText: DOMAIN }).first();
    await domainBtn.waitFor({ state: "visible", timeout: 20_000 });
    await click(page, domainBtn);
    await sleep(280);
    await snap(page, "setup-domain");
    await click(page, page.getByRole("button", { name: /^Continue$/i }));
    await page.getByLabel("Your name").waitFor({ state: "visible" });
  });

  await scene("02-account", async () => {
    await showCaption(page, byId["02-account"].caption);
    await typeInto(page, page.getByLabel("Your name"), NAME, 28);
    await sleep(160);
    await typeInto(page, page.getByLabel("Your address"), LOCAL_PART, 30);
    await sleep(140);
    await typeInto(page, page.getByLabel("Password", { exact: true }), PASSWORD, 18);
    await typeInto(page, page.getByLabel("Confirm password"), PASSWORD, 18);
    await snap(page, "create-account");
    await click(page, page.getByRole("button", { name: /Create account/i }));
    await page.waitForURL(/\/(inbox|onboarding)/, { timeout: 30_000 });
    await sleep(350);
  });

  await scene("03-inbox", async () => {
    const seed = await page.evaluate(async () => {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      return res.json();
    });
    console.log("seed", seed);
    await page.goto(`${APP_URL}/inbox`, { waitUntil: "networkidle" });
    await showCaption(page, byId["03-inbox"].caption);
    await sleep(400);
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await moveTo(page, row);
    await snap(page, "inbox");
    await sleep(400);
  });

  await scene("04-thread", async () => {
    await showCaption(page, byId["04-thread"].caption);
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    await click(page, row);
    await page.waitForURL(/\/mail\//, { timeout: 15_000 });
    await showCaption(page, byId["04-thread"].caption);
    await sleep(450);
    await moveTo(page, page.locator("article, .thread, main").first());
    await snap(page, "thread");
    await sleep(450);
    const star = page.getByRole("button", { name: /star/i }).first();
    if (await star.count()) {
      await click(page, star);
      await sleep(300);
    }
  });

  await scene("05-compose", async () => {
    await showCaption(page, byId["05-compose"].caption);
    const compose = page.locator('a.new-message, a[href="/compose"]').first();
    await click(page, compose);
    await page.waitForURL(/\/compose/, { timeout: 15_000 });
    await showCaption(page, byId["05-compose"].caption);
    await sleep(280);

    const toAlt = page.getByPlaceholder(/recipient@example.com/i);
    const to = page.locator('input[placeholder*="recipient"]').first();
    const toField = (await toAlt.count()) ? toAlt : to;
    await typeInto(page, toField, "elon@x.com", 22);
    await typeInto(
      page,
      page.getByPlaceholder(/^Subject$/i),
      `Self-hosted email for ${DOMAIN} — brief note`,
      12,
    );

    const editor = page.locator('[contenteditable="true"]').first();
    await click(page, editor);
    await page.keyboard.type(
      [
        `Mr. Musk,`,
        ``,
        `I am writing to share a brief note about QuickMail, a self-hosted email product we run on ${DOMAIN}.`,
        ``,
        `It provides a full inbox on your own domain, with delivery handled through Resend. The goal is simple: reliable mail you control, without depending on a consumer mailbox provider.`,
        ``,
        `If this is ever relevant to teams at X or Tesla who need domain-owned email infrastructure, I would welcome the chance to send a short overview.`,
        ``,
        `Thank you for your time.`,
        ``,
        `Respectfully,`,
        `Divin Prince`,
        `hello@${DOMAIN}`,
      ].join("\n"),
      { delay: 10 },
    );
    await sleep(240);
    await snap(page, "compose");

    const send = page.locator('form.compose-page button.btn-primary[type="submit"]');
    await send.waitFor({ state: "visible", timeout: 10_000 });
    await click(page, send);
    await page.waitForURL(/\/(inbox|sent|mail)/, { timeout: 20_000 }).catch(() => {});
    await sleep(400);
  });

  await scene("06-starred", async () => {
    await showCaption(page, byId["06-starred"].caption);
    await click(page, page.locator('a.nav-link[href="/starred"]'));
    await page.waitForURL(/\/starred/, { timeout: 10_000 });
    await showCaption(page, byId["06-starred"].caption);
    await sleep(500);
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    if (await row.count()) await moveTo(page, row);
    await snap(page, "starred");
  });

  await scene("07-theme", async () => {
    await showCaption(page, byId["07-theme"].caption);
    await click(page, page.locator('a.nav-link[href="/settings"]'));
    await page.waitForURL(/\/settings/, { timeout: 10_000 });
    await showCaption(page, byId["07-theme"].caption);
    await sleep(350);
    await click(page, page.getByRole("radio", { name: /Dark/i }));
    await sleep(550);
    await snap(page, "theme-dark");
    await click(page, page.getByRole("radio", { name: /Light/i }));
    await sleep(450);
    await snap(page, "theme-light");
    await click(page, page.getByRole("radio", { name: /System/i }));
    await sleep(400);
  });

  await scene("08-users", async () => {
    await showCaption(page, byId["08-users"].caption);
    await click(page, page.locator('a.nav-link[href="/admin"]'));
    await page.waitForURL(/\/admin/, { timeout: 10_000 });
    await showCaption(page, byId["08-users"].caption);
    await sleep(350);
    const nameField = page.getByPlaceholder("Display name");
    await typeInto(page, nameField, "Support", 24);
    await typeInto(page, page.getByLabel("Address"), "support", 22);
    await typeInto(page, page.getByPlaceholder("Temporary password"), "temppass123", 16);
    await snap(page, "admin-new-user");
    await click(page, page.getByRole("button", { name: /^Create$/i }));
    await page.waitForLoadState("networkidle").catch(() => {});
    await showCaption(page, byId["08-users"].caption);
    await sleep(500);
    const users = page.getByRole("heading", { name: /users/i });
    if (await users.count()) await moveTo(page, users);
    await snap(page, "admin-users");
    await sleep(400);
  });

  await hideCaption(page);
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

await writeFile(join(OUT, "cues.json"), JSON.stringify(cues, null, 2));

const webm = (await readdir(RAW)).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no webm recorded");
await copyFile(join(RAW, webm), join(OUT, "silent.webm"));
console.log(`Wrote ${join(OUT, "silent.webm")} + ${shotIndex.n} shots — run scripts/demo/mux-silent.sh next`);
