/**
 * Tutorial demo recorder skeleton — visible cursor, paced to ElevenLabs manifest.
 *
 * Adapt `SCENES` / `runScene` for your product. Keep narrate() holds ≥ audio.
 *
 * Usage:
 *   export CHROME_PATH=/usr/bin/google-chrome   # if needed
 *   export DEMO_APP_URL=http://127.0.0.1:3000
 *   bun add playwright-core                     # in a scratch dir
 *   bunx playwright-core install ffmpeg
 *   bun record-demo.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { mkdir, readdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const APP_URL = process.env.DEMO_APP_URL || "http://127.0.0.1:3000";
const OUT = process.env.DEMO_OUT || "/tmp/demo-artifacts";
const AUDIO = join(OUT, "audio");
const RAW = join(OUT, "raw");

await rm(RAW, { recursive: true, force: true });
await mkdir(RAW, { recursive: true });

const manifest = JSON.parse(await readFile(join(AUDIO, "manifest.json"), "utf8"));
const byId = Object.fromEntries(manifest.map((m) => [m.id, m]));

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
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
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

async function narrate(id, work) {
  const seg = byId[id];
  if (!seg) throw new Error(`missing audio segment ${id}`);
  const startMs = now();
  console.log(`[${(startMs / 1000).toFixed(1)}s] ${id} (${seg.durationSec}s) — ${seg.caption}`);
  await work();
  const elapsed = now() - startMs;
  const target = Math.ceil(seg.durationSec * 1000) + 250;
  if (elapsed < target) await sleep(target - elapsed);
  const endMs = now();
  if (cues.length && cues[cues.length - 1].endMs > startMs) {
    cues[cues.length - 1].endMs = startMs;
  }
  cues.push({ startMs, endMs, text: seg.caption });
}

async function moveTo(page, locator, steps = 16) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 12), {
    steps,
  });
  await sleep(80);
}

async function click(page, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await moveTo(page, locator);
  await locator.click();
}

async function typeInto(page, locator, text, delay = 28) {
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
  recordVideo: { dir: RAW, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

await page.addInitScript(() => {
  const install = () => {
    if (document.getElementById("demo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #demo-cursor {
        position: fixed; left: 0; top: 0; width: 22px; height: 22px;
        margin-left: -2px; margin-top: -2px; pointer-events: none;
        z-index: 2147483647; transform: translate(-120px,-120px);
        transition: transform 35ms linear;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.55));
      }
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
  // ——— Adapt these scenes to your product ———
  // One narrate() block per manifest id. Each block does one job and holds
  // until its narration has finished playing.

  await narrate("01-intro", async () => {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
  });

  await narrate("02-overview", async () => {
    // Move the cursor over whatever you're describing, even without clicking.
    await moveTo(page, page.getByRole("heading").first());
  });

  // Add more narrate("03-…", async () => { … }) matching your manifest ids.
  //
  // Building blocks:
  //   await click(page, page.getByRole("link", { name: "Settings" }));
  //   await typeInto(page, page.getByLabel("Project name"), "Demo project");
  //   await page.waitForSelector("text=Ready", { timeout: 60_000 });
  //   await moveTo(page, page.getByText("Status"));   // point without clicking
  //
  // Add a sign-in scene only if the tour is actually about a signed-in flow.

  console.log("Recording finished", page.url(), `total=${(now() / 1000).toFixed(1)}s`);
} catch (err) {
  console.error(err);
  await page.screenshot({ path: join(OUT, "error.png"), fullPage: true }).catch(() => {});
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(1);
}

await context.close();
await browser.close();

// ASS captions
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
  ass += `Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Default,,0,0,0,,${c.text}\n`;
}
await writeFile(join(OUT, "captions.ass"), ass);
await writeFile(join(OUT, "cues.json"), JSON.stringify(cues, null, 2));

const webm = (await readdir(RAW)).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no webm recorded");
await copyFile(join(RAW, webm), join(OUT, "silent.webm"));
console.log(`Wrote ${join(OUT, "silent.webm")} and captions.ass — run scripts/mux.sh next`);
