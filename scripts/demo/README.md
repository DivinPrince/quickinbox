# Cinematic demo (silent)

Records a quick product walkthrough with a visible cursor, a spring follow-cam
that tracks the mouse (not discrete zoom in/out), light parallax tilt, and small
burned-in captions. No narration.

Uses the `demo-video` skill patterns from DivinPrince/dpskills, adapted for a
silent cinematic cut. The camera keeps a resting scale and eases a layout-space
focus point so the subject stays near the frame center as the cursor moves.

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
npx playwright-core install ffmpeg   # optional helper; system Chrome + ffmpeg also work

export DEMO_OUT=/tmp/demo-artifacts
export DEMO_APP_URL=http://127.0.0.1:5173
export DEMO_MAIL_DOMAIN=your.domain
export DEMO_LOCAL_PART=hello
export DEMO_NAME="Demo User"
export DEMO_PASSWORD=demopass123

# Fresh local DB recommended before recording
cd /path/to/quickmail
node scripts/demo/record-cinematic.mjs
bash scripts/demo/mux-silent.sh
```

Output: `$DEMO_OUT/quickmail-cinematic-demo.mp4`
