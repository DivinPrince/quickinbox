/**
 * Silent mobile (WhatsApp-ready) product demo — light mode, vertical phone frame.
 *
 * Usage:
 *   DEMO_APP_URL=http://127.0.0.1:5173 \
 *   DEMO_MAIL_DOMAIN=your.domain \
 *   DEMO_LOCAL_PART=hello \
 *   DEMO_NAME="Demo User" \
 *   DEMO_PASSWORD=demopass123 \
 *   node scripts/demo/record-mobile.mjs
 *
 * Then:
 *   DEMO_OUT=… bash scripts/demo/mux-mobile.sh
 */
import { chromium, devices } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.DEMO_APP_URL || "http://127.0.0.1:5173";
const OUT = process.env.DEMO_OUT || "/tmp/demo-mobile";
const RAW = join(OUT, "raw");
const SHOTS = join(OUT, "shots");
const DOMAIN = (process.env.DEMO_MAIL_DOMAIN || "demo.local").toLowerCase();
const LOCAL_PART = (process.env.DEMO_LOCAL_PART || "hello").toLowerCase();
const NAME = process.env.DEMO_NAME || "Demo User";
const PASSWORD = process.env.DEMO_PASSWORD || "demopass123";
const MAILBOX = `${LOCAL_PART}@${DOMAIN}`;

// Phone CSS layout (≤900px) + sharp capture; mux upscales to 1080×1920.
const VIEW_W = 390;
const VIEW_H = 844;

const cursorSvg = readFileSync(join(__dirname, "assets/cursor.svg"), "utf8");
const cursorDataUri = `data:image/svg+xml;base64,${Buffer.from(cursorSvg).toString("base64")}`;

await rm(RAW, { recursive: true, force: true });
await rm(SHOTS, { recursive: true, force: true });
await mkdir(RAW, { recursive: true });
await mkdir(SHOTS, { recursive: true });
await mkdir(OUT, { recursive: true });

const scenes = JSON.parse(await readFile(join(__dirname, "scenes.json"), "utf8"));
const byId = Object.fromEntries(scenes.map((s) => [s.id, s]));
if (byId["02-account"]) byId["02-account"].caption = `Create ${MAILBOX}`;

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
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("Set CHROME_PATH to your Chrome/Chromium binary");
}

async function showCaption(page, text) {
  await page.evaluate((text) => window.__demoCaption?.show(text), text);
}

async function hideCaption(page) {
  await page.evaluate(() => window.__demoCaption?.hide()).catch(() => {});
}

async function snap(page, label) {
  shotIndex.n += 1;
  const name = `${String(shotIndex.n).padStart(2, "0")}-${label}.png`;
  await page.screenshot({ path: join(SHOTS, name), type: "png" });
  console.log(`  shot ${name}`);
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

async function moveTo(page, locator, steps = 14) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) return null;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 12);
  await page.mouse.move(x, y, { steps });
  await sleep(60);
  return { x, y, box };
}

async function click(page, locator) {
  await moveTo(page, locator);
  await locator.click({ force: true });
}

async function typeInto(page, locator, text, delay = 18) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await moveTo(page, locator);
  await locator.click({ force: true });
  await locator.fill("");
  await locator.pressSequentially(text, { delay });
}

async function openNav(page) {
  const open = page.locator(".sidebar.mobile-open");
  if (await open.count()) return;
  const toggle = page.getByRole("button", { name: /Open navigation/i });
  await toggle.waitFor({ state: "visible", timeout: 8_000 });
  await click(page, toggle);
  await page.locator(".sidebar.mobile-open").waitFor({ state: "visible", timeout: 5_000 });
  await sleep(200);
}

async function closeNav(page) {
  if (!(await page.locator(".sidebar.mobile-open").count())) return;
  const scrim = page.getByRole("button", { name: /Close navigation/i });
  if (await scrim.count()) {
    await scrim.click({ force: true });
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }
  await page
    .locator(".sidebar.mobile-open")
    .waitFor({ state: "hidden", timeout: 5_000 })
    .catch(() => {});
  await sleep(150);
}

async function navTo(page, href) {
  await openNav(page);
  const link = page.locator(`aside.sidebar a[href="${href}"]`).first();
  await link.waitFor({ state: "visible", timeout: 8_000 });
  await Promise.all([
    page.waitForURL((url) => url.pathname === href || url.pathname.startsWith(`${href}/`), {
      timeout: 12_000,
    }),
    click(page, link),
  ]);
  // Drawer may stay open for links that don't auto-close (e.g. New message).
  await closeNav(page);
  await sleep(250);
}

const browser = await chromium.launch({
  executablePath: detectChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const iphone = devices["iPhone 13"];
const context = await browser.newContext({
  ...iphone,
  viewport: { width: VIEW_W, height: VIEW_H },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
  recordVideo: { dir: RAW, size: { width: VIEW_W, height: VIEW_H } },
});
const page = await context.newPage();

await page.addInitScript(() => {
  try {
    localStorage.setItem("mail:theme", "light");
  } catch {
    /* ignore */
  }
});

await page.addInitScript((cursorSrc) => {
  const install = () => {
    if (document.getElementById("demo-chrome-style")) return;
    const style = document.createElement("style");
    style.id = "demo-chrome-style";
    style.textContent = `
      #demo-cursor {
        position: fixed; left: 0; top: 0; width: 44px; height: 44px;
        margin-left: -13px; margin-top: -9px; pointer-events: none;
        z-index: 2147483647; transform: translate(-160px,-160px);
        transition: transform 30ms linear;
        background: url("${cursorSrc}") no-repeat center / contain;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));
      }
      #demo-caption {
        position: fixed;
        top: 0.7rem;
        left: 0.7rem;
        right: 0.7rem;
        z-index: 2147483646;
        pointer-events: none;
        padding: 0.65rem 0.85rem;
        border-radius: 0.9rem;
        font: 600 0.92rem/1.3 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
        letter-spacing: -0.02em;
        color: #f7f7f4;
        background: linear-gradient(135deg, rgba(22,24,23,.92), rgba(12,13,12,.88));
        backdrop-filter: blur(14px) saturate(1.2);
        -webkit-backdrop-filter: blur(14px) saturate(1.2);
        box-shadow: 0 0 0 1px rgba(255,255,255,.1), 0 12px 32px rgba(0,0,0,.28);
        display: flex; align-items: center; gap: 0.55rem;
        opacity: 0;
        transform: translateY(-120%);
        transition: transform 420ms cubic-bezier(.22,.61,.36,1), opacity 280ms ease;
      }
      #demo-caption.visible { opacity: 1; transform: translateY(0); }
      #demo-caption::before {
        content: ""; width: 0.35rem; height: 0.35rem; border-radius: 9999px; flex: 0 0 auto;
        background: #90ac9a; box-shadow: 0 0 0 3px rgba(144,172,154,.28);
      }
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
    await sleep(700);
    await snap(page, "setup-logos");
    const domainBtn = page.locator("button.domain-card").filter({ hasText: DOMAIN }).first();
    await domainBtn.waitFor({ state: "visible", timeout: 20_000 });
    await click(page, domainBtn);
    await sleep(220);
    await snap(page, "setup-domain");
    await click(page, page.getByRole("button", { name: /^Continue$/i }));
    await page.getByLabel("Your name").waitFor({ state: "visible" });
  });

  await scene("02-account", async () => {
    await showCaption(page, byId["02-account"].caption);
    await typeInto(page, page.getByLabel("Your name"), NAME, 22);
    await typeInto(page, page.getByLabel("Your address"), LOCAL_PART, 24);
    await typeInto(page, page.getByLabel("Password", { exact: true }), PASSWORD, 14);
    await typeInto(page, page.getByLabel("Confirm password"), PASSWORD, 14);
    await snap(page, "create-account");
    await click(page, page.getByRole("button", { name: /Create account/i }));
    await page.waitForURL(/\/(inbox|onboarding)/, { timeout: 30_000 });
    await sleep(300);
  });

  await scene("03-inbox", async () => {
    const seed = await page.evaluate(async () => {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      return res.json();
    });
    console.log("seed", seed);
    await page.goto(`${APP_URL}/inbox`, { waitUntil: "networkidle" });
    await showCaption(page, byId["03-inbox"].caption);
    await sleep(350);
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await moveTo(page, row);
    await snap(page, "inbox");
  });

  await scene("04-thread", async () => {
    await showCaption(page, byId["04-thread"].caption);
    await click(page, page.locator("a[href^='/mail/'], a[href*='/mail/']").first());
    await page.waitForURL(/\/mail\//, { timeout: 15_000 });
    await showCaption(page, byId["04-thread"].caption);
    await sleep(400);
    await snap(page, "thread");
    const star = page.getByRole("button", { name: /star/i }).first();
    if (await star.count()) {
      await click(page, star);
      await sleep(250);
    }
  });

  await scene("05-compose", async () => {
    await showCaption(page, byId["05-compose"].caption);
    // Client-side nav (full reload used to SSR-crash compose before DOMParser guard).
    await navTo(page, "/compose");
    await showCaption(page, byId["05-compose"].caption);
    await sleep(280);

    const toField = page.locator("#to, input[placeholder*='recipient']").first();
    await toField.waitFor({ state: "visible", timeout: 15_000 });
    await typeInto(page, toField, "elon@x.com", 18);
    await typeInto(
      page,
      page.getByPlaceholder(/^Subject$/i),
      `Self-hosted email for ${DOMAIN}`,
      12,
    );

    const editor = page.locator('[contenteditable="true"]').first();
    await click(page, editor);
    await page.keyboard.type(
      [
        `Mr. Musk,`,
        ``,
        `A brief note about QuickMail — self-hosted email we run on ${DOMAIN}, with delivery through Resend.`,
        ``,
        `If domain-owned mail is useful for teams at X or Tesla, I would welcome the chance to share a short overview.`,
        ``,
        `Thank you for your time.`,
        ``,
        `Respectfully,`,
        `Divin Prince`,
        `hello@${DOMAIN}`,
      ].join("\n"),
      { delay: 9 },
    );
    await sleep(200);
    await snap(page, "compose");
    const send = page.locator('form.compose-page button.btn-primary[type="submit"]');
    await send.scrollIntoViewIfNeeded().catch(() => {});
    await click(page, send);
    await page.waitForURL(/\/(inbox|sent|mail)/, { timeout: 20_000 }).catch(() => {});
    await sleep(350);
  });

  await scene("06-starred", async () => {
    await showCaption(page, byId["06-starred"].caption);
    await navTo(page, "/starred");
    await showCaption(page, byId["06-starred"].caption);
    await sleep(400);
    await snap(page, "starred");
  });

  await scene("07-theme", async () => {
    await showCaption(page, byId["07-theme"].caption);
    await navTo(page, "/settings");
    await showCaption(page, byId["07-theme"].caption);
    await sleep(280);
    await click(page, page.getByRole("radio", { name: /Dark/i }));
    await sleep(450);
    await snap(page, "theme-dark");
    await click(page, page.getByRole("radio", { name: /Light/i }));
    await sleep(400);
    await snap(page, "theme-light");
  });

  await scene("08-users", async () => {
    await showCaption(page, byId["08-users"].caption);
    await navTo(page, "/admin");
    await showCaption(page, byId["08-users"].caption);
    await sleep(280);
    const nameField = page.getByPlaceholder("Display name");
    await nameField.scrollIntoViewIfNeeded();
    await typeInto(page, nameField, "Support", 20);
    await typeInto(page, page.getByLabel("Address"), "support", 18);
    await typeInto(page, page.getByPlaceholder("Temporary password"), "temppass123", 14);
    await snap(page, "admin-new-user");
    await click(page, page.getByRole("button", { name: /^Create$/i }));
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(450);
    await snap(page, "admin-users");
  });

  await hideCaption(page);
  console.log(`Mobile recording finished ${page.url()} total=${(now() / 1000).toFixed(1)}s`);
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
console.log(`Wrote ${join(OUT, "silent.webm")} + ${shotIndex.n} shots — run scripts/demo/mux-mobile.sh next`);
