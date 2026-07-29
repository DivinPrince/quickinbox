---
name: demo-video
description: >-
  Records polished product and tutorial demo videos: real UI automation in a
  headless browser with a visible mouse cursor, small burned-in captions, and
  ElevenLabs voiceover synced to on-screen actions. Use when the user asks for a
  demo video, tutorial video, walkthrough video, narrated screencast, product
  feature tour, or to "record the UI with voice and subtitles."
license: MIT
compatibility: >-
  Requires Chrome or Chromium, ffmpeg and ffprobe, Node 20+ or Bun, Python 3.10+,
  network access, and an ElevenLabs API key in ELEVEN_API_KEY.
metadata:
  author: DivinPrince
  version: "1.0"
---

# Demo videos (cursor + captions + voiceover)

Records real UI with a visible cursor, small captions, and spoken narration.

## When to use

- "Make a demo / tutorial / walkthrough video"
- "Add voiceover to a screen recording"
- "Show the cursor" / "smaller subtitles"
- Feature tours, onboarding clips, release videos, bug repros with commentary

## End result

One MP4, four layers:

| Layer | What |
|-------|------|
| Video | Headless Chrome recording of the real app |
| Cursor | Injected SVG pointer that follows `mouse.move` / clicks |
| Captions | Short chapter titles, ~15px @ 1440×900, bottom edge |
| Audio | ElevenLabs TTS, segment-synced to each scene |

Typical length: 2–4 minutes.

## Setup

```bash
google-chrome --version || chromium --version   # Playwright needs a real binary
ffmpeg -version && ffprobe -version
node --version || bun --version                 # Node 20+
python3 --version                               # 3.10+
```

Install Playwright's ffmpeg helper from a scratch dir so the product lockfile
stays clean:

```bash
mkdir -p /tmp/demo-video && cd /tmp/demo-video
npm init -y && npm i playwright-core && npx playwright-core install ffmpeg
```

```bash
export ELEVEN_API_KEY='sk_…'          # never commit this
export DEMO_OUT="${DEMO_OUT:-/tmp/demo-artifacts}"
mkdir -p "$DEMO_OUT"/{audio,raw,frames}
```

The app needs a stable URL — localhost, preview deploy, or production. Seed
whatever data makes the tour look real.

## Pipeline

```
1. Write scenes.json      → id, caption, narration
2. gen-narration.py       → audio/<id>.mp3 + manifest.json with real durations
3. record-demo.mjs        → silent.webm + captions.ass (cursor, holds ≥ audio)
4. mux.sh                 → feature-tutorial.mp4 (h264 + aac + burned captions)
5. Spot-check             → cursor visible, captions small, audio present
```

### 1. Scenes

```json
{
  "id": "03-create",
  "caption": "Create your first project",
  "text": "Click New project, give it a name, and pick a region close to your users."
}
```

- **Caption**: 3–7 words, burned on screen. Not the full narration.
- **Narration**: 1–3 sentences, present tense, conversational.
- One scene = one job. Ids `01-…`, `02-…` so concat order is obvious.
- Say the control's label, not "the purple button".
- Open on what the thing *is*. Sign-in and install steps are scenes only when
  the tour is actually about them.
- Never read secrets aloud.

Save the spoken script as `SCRIPT.md` next to the MP4.

### 2. Narration

```bash
python3 scripts/gen-narration.py --script scenes.json --out "$DEMO_OUT/audio"
```

One MP3 per scene plus `manifest.json` with a measured `durationSec` — the
recorder and mux both read it, so regenerate whenever the text changes.

Voice via `ELEVEN_VOICE_ID` (default Alice, `Xb7hH8MSUJpSbSDYk0k2`). Others:
Matilda `XrExE9yKIg1WjnnlVkGX`, Daniel `onwK4e9ZLuTAKqWW03F9`, Sarah
`EXAVITQu4vr4xnSDxMaL`. IDs drift — list them, which also proves the key works:

```bash
curl -sS -H "xi-api-key: $ELEVEN_API_KEY" https://api.elevenlabs.io/v1/voices \
  | python3 -c "import sys,json; [print(v['voice_id'], v['name']) for v in json.load(sys.stdin).get('voices',[])]"
```

`stability` 0.3–0.5 keeps delivery lively; above 0.7 goes flat.

### 3. Record

```bash
cd /tmp/demo-video    # where playwright-core lives
DEMO_APP_URL=http://127.0.0.1:3000 node scripts/record-demo.mjs
```

Adapt the `narrate(...)` blocks — one per manifest id. The skeleton just opens
the URL; every scene after that is yours.

Two invariants:

**Every click moves the cursor first.** Headless Chrome renders no OS cursor, so
the script injects an SVG pointer at `z-index: 2147483647` and drives it with
`page.mouse.move(x, y, { steps: 16 })`. Route clicks through the `click()` helper
— a bare `locator.click()` gives you a video where things happen with no pointer
in sight.

**Each scene holds ≥ its audio duration + 250ms**, so narration never gets cut
off. If UI work outlasts the line, the rest of the scene is a silent hold; for
wait-heavy steps prefer a second "still provisioning…" line over 40s of silence.

Selectors: prefer role and label over CSS.

```js
page.getByRole("button", { name: /Create database/i })
page.getByLabel("Project name")
```

Gotchas worth knowing up front:

- CodeMirror and similar editors ignore `fill()` — click `.cm-content`,
  Select-All, then `keyboard.insertText()`.
- React controlled inputs sometimes ignore `fill()` too; `pressSequentially`
  with a ~22ms delay also just looks better on camera.
- Hide devtools badges (TanStack, React Query, Vite overlays) with injected CSS,
  re-applied on an interval if they mount late.
- If the tour signs in, `127.0.0.1` and `localhost` are different origins for
  CORS and cookies — align the URL with the API's trusted origins first.
- A failed run screenshots to `$DEMO_OUT/error.png`. Check it first.

### 4. Captions

The recorder writes `captions.ass` from the scene captions and the timings it
actually observed. Two things matter:

**Use ASS, not SRT.** SRT renders against a ~288px default PlayRes, so
`FontSize=18` becomes enormous at 1440×900 and `force_style` is guesswork. ASS
with explicit `PlayResX`/`PlayResY` matching the viewport makes `Fontsize` mean
real pixels.

```ass
[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 900

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,15,&H00FFFFFF,&H000000FF,&H80000000,&H64000000,0,0,0,0,100,100,0,0,1,1.1,0,2,48,48,14,1
```

`Fontsize` 14–16, `Alignment 2` (bottom center), `MarginV 14`. The font must be
installed — `DejaVu Sans` on Linux, `Helvetica` on macOS.

**Cues never overlap.** Each ends exactly where the next starts; the recorder
trims the previous cue to enforce it. One line, no stacking.

`cues.json` ships alongside so captions can be re-styled and re-burned from
`silent.webm` without re-recording.

### 5. Mux and verify

```bash
DEMO_OUT=/tmp/demo-artifacts bash scripts/mux.sh
```

Concatenates the MP3s with 250ms pads matching the recorder's breath, burns the
captions, muxes h264 + aac. If you change the pad, change `target` in `narrate()`
to match or audio drifts.

```bash
ffprobe -v error -show_entries stream=codec_type,codec_name \
  -show_entries format=duration -of default=noprint_wrappers=1 \
  "$DEMO_OUT/feature-tutorial.mp4"
# Expect h264 + aac, duration ≈ total narration

ffmpeg -y -i "$DEMO_OUT/feature-tutorial.mp4" -ss 00:00:12 -frames:v 1 -update 1 /tmp/check.png
```

No audio stream almost always means `narration.mp3` never got built — check that
`manifest.json` paths are absolute.

## Smoke test

Prove the toolchain in ten seconds before committing to a long shoot:

```bash
curl -sS -X POST "https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID:-Xb7hH8MSUJpSbSDYk0k2}" \
  -H "xi-api-key: $ELEVEN_API_KEY" -H "Content-Type: application/json" -H "Accept: audio/mpeg" \
  -d '{"text":"Testing one two three.","model_id":"eleven_multilingual_v2"}' -o /tmp/t.mp3

ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=2 -i /tmp/t.mp3 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest /tmp/smoke.mp4 && ffprobe /tmp/smoke.mp4
```

## Before shipping

- [ ] Cursor visible and moves before each click
- [ ] Captions small, single-line, bottom edge, not covering the UI
- [ ] `ffprobe` shows an aac stream
- [ ] Scene order matches the script; no error toasts on screen
- [ ] Wait-heavy scenes hold ≥ audio, nothing cut mid-sentence
- [ ] No secrets spoken or left on screen
- [ ] `SCRIPT.md` saved alongside the MP4

## Notes

- Keys go through env only. If one lands in chat, tell the user to rotate it.
- Use demo data, not production accounts.
- Keep `DEMO_OUT` outside the repo so recordings never reach git.
