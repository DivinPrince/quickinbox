/**
 * Cinematic silent product demo — visible cursor, mouse-following camera, captions.
 * Adapted from the DivinPrince/dpskills demo-video skill (no narration).
 *
 * Camera: continuous spring that tracks the cursor (pan + scale + light tilt).
 * Not discrete zoom-in / zoom-out cuts.
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
const VW = 1440;
const VH = 900;

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
let mouse = { x: VW / 2, y: VH / 2 };

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

/** Ease mouse toward a point so the follow-cam can track it. */
async function glideMouse(page, x, y, { steps = 28, settleMs = 180 } = {}) {
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
  await sleep(settleMs);
}

/**
 * Visual center from getBoundingClientRect, plus layout center recovered from
 * the live camera (no transform disable — avoids flashes and keeps tracking smooth).
 */
async function targetPoints(page, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const handle = await locator.elementHandle();
  if (!handle) return null;
  return page.evaluate((el) => {
    const v = el.getBoundingClientRect();
    const visual = {
      x: v.left + v.width / 2,
      y: v.top + Math.min(Math.max(v.height / 2, 10), v.height - 4),
    };
    const cam = window.__demoCam?.getState?.();
    const vw = window.innerWidth || 1440;
    const vh = window.innerHeight || 900;
    if (!cam || !cam.enabled || cam.scale < 1.001) {
      return { layout: { ...visual }, visual };
    }
    const s = cam.scale;
    const layout = {
      x: cam.fx + (visual.x - vw / 2) / s,
      y: cam.fy + (visual.y - vh / 2) / s,
    };
    return { layout, visual };
  }, handle);
}

async function moveTo(page, locator, { steps = 22, settleMs = 200 } = {}) {
  const pt = await targetPoints(page, locator);
  if (!pt) return null;
  await page.evaluate((p) => {
    window.__demoCam?.focusLayout?.(p.layout.x, p.layout.y);
  }, pt);

  // A few mid-flight corrections so the cursor rides with the easing camera.
  const hops = 6;
  const from = { ...mouse };
  for (let i = 1; i <= hops; i++) {
    const live = await targetPoints(page, locator);
    const aim = live?.visual ?? pt.visual;
    const t = i / hops;
    const ease = t * (2 - t);
    const x = from.x + (aim.x - from.x) * ease;
    const y = from.y + (aim.y - from.y) * ease;
    await page.mouse.move(x, y, { steps: Math.max(2, Math.floor(steps / hops)) });
    mouse = { x, y };
    await sleep(28);
  }
  const finalVisual = (await targetPoints(page, locator))?.visual ?? pt.visual;
  await page.mouse.move(finalVisual.x, finalVisual.y, { steps: 4 });
  mouse = { ...finalVisual };
  await sleep(settleMs * 0.45);
  return pt;
}

async function cam(page, opts) {
  try {
    await page.evaluate((opts) => {
      window.__demoCam?.configure(opts);
    }, opts);
  } catch {
    // Navigation can destroy the context mid-tween — safe to ignore.
  }
}

async function click(page, locator, { punch = 1.45, settleScale = 1.34 } = {}) {
  await moveTo(page, locator, { steps: 22, settleMs: 200 });
  if (punch) {
    await cam(page, { targetScale: punch });
    await page.evaluate(() => window.__demoCam?.pulse?.(1.5, 240)).catch(() => {});
  }
  // DOM click ignores the decorative camera transform — cursor still tracks.
  await locator.evaluate((el) => {
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    el.click();
  });
  await sleep(160);
  await cam(page, { targetScale: settleScale });
}

async function typeInto(page, locator, text, delay = 22) {
  await moveTo(page, locator, { steps: 30, settleMs: 220 });
  await cam(page, { targetScale: 1.4 });
  await locator.evaluate((el) => {
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    el.click();
  });
  await locator.fill("");
  await locator.pressSequentially(text, { delay });
  await cam(page, { targetScale: 1.32 });
}

const browser = await chromium.launch({
  executablePath: detectChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const context = await browser.newContext({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: 1,
  recordVideo: { dir: RAW, size: { width: VW, height: VH } },
});
const page = await context.newPage();

await page.addInitScript(() => {
  const install = () => {
    if (window.__demoCam) return;

    const style = document.createElement("style");
    style.id = "demo-cinematic-style";
    style.textContent = `
      html {
        overflow: hidden !important;
        background: #eceae4;
      }
      html[data-theme="dark"] {
        background: #1a1a1a;
      }
      body {
        will-change: transform;
        backface-visibility: hidden;
      }
      #demo-cursor {
        position: fixed; left: 0; top: 0; width: 22px; height: 22px;
        margin-left: -2px; margin-top: -2px; pointer-events: none;
        z-index: 2147483647; transform: translate(-120px,-120px);
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.55));
      }
      vite-error-overlay { display: none !important; }
    `;
    document.documentElement.appendChild(style);

    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 3 L4 19 L9.5 14.5 L13 22 L15.5 21 L12 13.5 L19 13 Z"
        fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(cursor);

    /**
     * Center-tracking follow-cam.
     * Focus point is in *layout* space; every frame we translate+scale so that
     * point eases toward the viewport center. Mouse moves update the focus via
     * the inverse of the current camera — so the frame tracks the cursor
     * continuously instead of doing zoom-in / zoom-out cuts.
     */
    const state = {
      fx: window.innerWidth / 2,
      fy: window.innerHeight / 2,
      targetFX: window.innerWidth / 2,
      targetFY: window.innerHeight / 2,
      scale: 1,
      targetScale: 1.38,
      follow: 0.2,
      scaleFollow: 0.14,
      enabled: true,
      tiltMax: 0.55,
    };

    const apply = () => {
      if (!document.body) return;
      if (!state.enabled) {
        document.body.style.transform = "";
        document.body.style.transformOrigin = "";
        return;
      }
      const vw = window.innerWidth || 1440;
      const vh = window.innerHeight || 900;
      const s = state.scale;
      const tx = vw / 2 - state.fx * s;
      const ty = vh / 2 - state.fy * s;
      const tiltY = (state.fx / vw - 0.5) * state.tiltMax * 2;
      const tiltX = (0.5 - state.fy / vh) * state.tiltMax;
      document.body.style.transformOrigin = "0 0";
      document.body.style.transform =
        `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(4)}) ` +
        `perspective(1600px) rotateX(${tiltX.toFixed(3)}deg) rotateY(${tiltY.toFixed(3)}deg)`;
    };

    const tick = () => {
      state.fx += (state.targetFX - state.fx) * state.follow;
      state.fy += (state.targetFY - state.fy) * state.follow;
      state.scale += (state.targetScale - state.scale) * state.scaleFollow;
      apply();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    window.addEventListener(
      "mousemove",
      (e) => {
        const vw = window.innerWidth || 1440;
        const vh = window.innerHeight || 900;
        const s = Math.max(state.scale, 0.001);
        // Inverse of translate(vw/2 - fx*s, …) scale(s) about 0,0
        state.targetFX = state.fx + (e.clientX - vw / 2) / s;
        state.targetFY = state.fy + (e.clientY - vh / 2) / s;
        cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      },
      { passive: true },
    );

    window.__demoCam = {
      getState() {
        return {
          fx: state.fx,
          fy: state.fy,
          scale: state.scale,
          enabled: state.enabled,
        };
      },
      /** Layout-space focus (pre-transform page coordinates). */
      focusLayout(x, y, { snap = false } = {}) {
        state.targetFX = x;
        state.targetFY = y;
        if (snap) {
          state.fx = x;
          state.fy = y;
          apply();
        }
      },
      configure(opts = {}) {
        if (typeof opts.targetScale === "number") state.targetScale = opts.targetScale;
        if (typeof opts.follow === "number") state.follow = opts.follow;
        if (typeof opts.scaleFollow === "number") state.scaleFollow = opts.scaleFollow;
        if (typeof opts.tiltMax === "number") state.tiltMax = opts.tiltMax;
        if (typeof opts.enabled === "boolean") {
          state.enabled = opts.enabled;
          if (!opts.enabled) apply();
        }
        if (opts.focus && typeof opts.focus.x === "number") {
          // interpret as layout focus
          state.targetFX = opts.focus.x;
          state.targetFY = opts.focus.y;
        }
        if (opts.snap) {
          state.fx = state.targetFX;
          state.fy = state.targetFY;
          state.scale = state.targetScale;
          apply();
        }
      },
      pulse(scale = 1.3, holdMs = 320) {
        const prev = state.targetScale;
        state.targetScale = scale;
        setTimeout(() => {
          state.targetScale = prev;
        }, holdMs);
      },
    };
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
});

try {
  await scene("01-setup", async () => {
    await page.goto(`${APP_URL}/setup`, { waitUntil: "networkidle" });
    await cam(page, { targetScale: 1.4, follow: 0.16, scaleFollow: 0.1 });
    await glideMouse(page, VW * 0.5, VH * 0.42, { steps: 20, settleMs: 350 });
    const domainBtn = page.locator("button.domain-card").filter({ hasText: DOMAIN }).first();
    await domainBtn.waitFor({ state: "visible", timeout: 20_000 });
    await cam(page, { targetScale: 1.42 });
    await click(page, domainBtn, { punch: 1.34 });
    await sleep(280);
    const cont = page.getByRole("button", { name: /Continue/i });
    await cam(page, { targetScale: 1.36 });
    await click(page, cont, { punch: 1.3 });
    await page.getByLabel("Your name").waitFor({ state: "visible" });
  });

  await scene("02-account", async () => {
    await cam(page, { targetScale: 1.34, follow: 0.15 });
    await typeInto(page, page.getByLabel("Your name"), NAME, 28);
    await sleep(160);
    const address = page.getByLabel("Your address");
    await cam(page, { targetScale: 1.4 });
    await typeInto(page, address, LOCAL_PART, 30);
    await sleep(140);
    await typeInto(page, page.getByLabel("Password", { exact: true }), PASSWORD, 18);
    await typeInto(page, page.getByLabel("Confirm password"), PASSWORD, 18);
    const create = page.getByRole("button", { name: /Create account/i });
    await cam(page, { targetScale: 1.32 });
    await click(page, create, { punch: 1.26 });
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
    await cam(page, { targetScale: 1.32, follow: 0.09, snap: true, focus: { x: VW * 0.55, y: VH * 0.4 } });
    await sleep(350);
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await cam(page, { targetScale: 1.36 });
    // Drift across a couple of rows so the camera tracks the mouse.
    const rows = page.locator("a[href^='/mail/'], a[href*='/mail/']");
    const count = Math.min(await rows.count(), 2);
    for (let i = 0; i < count; i++) {
      await moveTo(page, rows.nth(i), { steps: 34, settleMs: 260 });
    }
    await moveTo(page, row, { steps: 30, settleMs: 280 });
  });

  await scene("04-thread", async () => {
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    await cam(page, { targetScale: 1.32 });
    await click(page, row, { punch: 1.28 });
    await page.waitForURL(/\/mail\//, { timeout: 15_000 });
    await sleep(400);
    await cam(page, { targetScale: 1.34, follow: 0.12 });
    const body = page.locator("article, .thread, main").first();
    await moveTo(page, body, { steps: 36, settleMs: 420 });
    const star = page.getByRole("button", { name: /star/i }).first();
    if (await star.count()) {
      await cam(page, { targetScale: 1.32 });
      await click(page, star, { punch: 1.24 });
      await sleep(280);
    }
  });

  await scene("05-compose", async () => {
    await cam(page, { targetScale: 1.32, follow: 0.14 });
    const compose = page.locator('a.new-message, a[href="/compose"]').first();
    await click(page, compose, { punch: 1.24 });
    await page.waitForURL(/\/compose/, { timeout: 15_000 });
    await sleep(280);

    const toAlt = page.getByPlaceholder(/recipient@example.com/i);
    const to = page.locator('input[placeholder*="recipient"]').first();
    const toField = (await toAlt.count()) ? toAlt : to;
    await cam(page, { targetScale: 1.4 });
    await typeInto(page, toField, "maya@northwind.studio", 20);

    const subject = page.getByPlaceholder(/^Subject$/i);
    await typeInto(page, subject, `Quick update from ${DOMAIN}`, 16);

    const editor = page.locator('[contenteditable="true"]').first();
    await click(page, editor, { punch: 1.16 });
    await page.keyboard.type(
      `Hey Maya — mail on ${DOMAIN} is live. Sending this from the QuickMail composer.`,
      { delay: 16 },
    );
    await sleep(240);

    const send = page.locator('form.compose-page button.btn-primary[type="submit"]');
    await send.waitFor({ state: "visible", timeout: 10_000 });
    await cam(page, { targetScale: 1.42 });
    await moveTo(page, send, { steps: 34, settleMs: 280 });
    await page.evaluate(() => window.__demoCam?.pulse?.(1.34, 300)).catch(() => {});
    await Promise.all([
      page.waitForURL(/\/(inbox|sent|mail)/, { timeout: 20_000 }).catch(() => {}),
      send.evaluate((el) => el.click()),
    ]);
    await sleep(450);
    await cam(page, { targetScale: 1.32, snap: true });
  });

  await scene("06-starred", async () => {
    await cam(page, { targetScale: 1.34, follow: 0.15 });
    const starred = page.locator('a.nav-link[href="/starred"]');
    await moveTo(page, starred, { steps: 36, settleMs: 280 });
    await cam(page, { targetScale: 1.34 });
    await starred.evaluate((el) => el.click());
    await page.waitForURL(/\/starred/, { timeout: 15_000 });
    await sleep(500);
    const row = page.locator("a[href^='/mail/'], a[href*='/mail/']").first();
    if (await row.count()) {
      await cam(page, { targetScale: 1.4 });
      await moveTo(page, row, { steps: 36, settleMs: 360 });
    }
  });

  await scene("07-sent", async () => {
    await cam(page, { targetScale: 1.34 });
    const sent = page.locator('a.nav-link[href="/sent"]');
    await moveTo(page, sent, { steps: 32, settleMs: 260 });
    await sent.evaluate((el) => el.click());
    await page.waitForURL(/\/sent/, { timeout: 15_000 });
    await sleep(400);
    await moveTo(page, page.locator("main").first(), { steps: 30, settleMs: 300 });
    const drafts = page.locator('a.nav-link[href="/drafts"]');
    await moveTo(page, drafts, { steps: 32, settleMs: 260 });
    await drafts.evaluate((el) => el.click());
    await page.waitForURL(/\/drafts/, { timeout: 15_000 });
    await sleep(500);
  });

  await scene("08-settings", async () => {
    await cam(page, { targetScale: 1.34, follow: 0.14 });
    const settings = page.locator('a.nav-link[href="/settings"]');
    await moveTo(page, settings, { steps: 34, settleMs: 280 });
    await settings.evaluate((el) => el.click());
    await page.waitForURL(/\/settings/, { timeout: 15_000 });
    await sleep(400);
    await cam(page, { targetScale: 1.36 });
    await moveTo(page, page.locator("main").first(), { steps: 34, settleMs: 420 });
    const cards = page.locator("main .surface, main section, main h2, main h1");
    const n = Math.min(await cards.count(), 2);
    for (let i = 0; i < n; i++) {
      await moveTo(page, cards.nth(i), { steps: 28, settleMs: 240 });
    }
    const admin = page.locator('a.nav-link[href="/admin"]');
    if (await admin.count()) {
      await cam(page, { targetScale: 1.4 });
      await moveTo(page, admin, { steps: 32, settleMs: 260 });
      await admin.evaluate((el) => el.click());
      await page.waitForURL(/\/admin/, { timeout: 15_000 });
      await sleep(500);
      await moveTo(page, page.locator("main").first(), { steps: 32, settleMs: 400 });
    }
    await cam(page, { targetScale: 1.2, follow: 0.12 });
    await glideMouse(page, VW * 0.55, VH * 0.45, { steps: 24, settleMs: 450 });
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
PlayResX: ${VW}
PlayResY: ${VH}
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
