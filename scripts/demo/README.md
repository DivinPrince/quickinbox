# Silent demo (no auto-zoom)

Records a product walkthrough with a larger custom cursor and top-right
slide-in caption chips (not bottom subtitles). No narration, no camera zoom.
Starts in **light mode** at 1920×1080 (2× screenshots). Mux uses CRF 14 / slow.
Also writes PNG screenshots per beat under `$DEMO_OUT/shots`.

Uses the `demo-video` skill patterns from DivinPrince/dpskills.

## Prerequisites

```bash
cp .dev.vars.example .dev.vars
# Set:
#   RESEND_API_KEY=demo_local
#   DEMO_MAIL_DOMAIN=your.domain
npm install
npm run db:migrate:local
npm run dev
```

In another shell:

```bash
mkdir -p /tmp/demo-video && cd /tmp/demo-video
npm init -y && npm i playwright-core

export DEMO_OUT=/tmp/demo-artifacts
export DEMO_APP_URL=http://127.0.0.1:5173
export DEMO_MAIL_DOMAIN=your.domain
export DEMO_LOCAL_PART=hello
export DEMO_NAME="Demo User"
export DEMO_PASSWORD=demopass123

cd /path/to/quickmail
# Fresh local DB recommended before recording
node scripts/demo/record-cinematic.mjs
bash scripts/demo/mux-silent.sh
```

Cursor asset: `scripts/demo/assets/cursor.svg`

Output: `$DEMO_OUT/quickmail-cinematic-demo.mp4`
