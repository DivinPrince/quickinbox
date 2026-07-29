#!/usr/bin/env bash
# Burn ASS captions into the silent cinematic recording and emit h264 MP4.
#
# Usage:
#   DEMO_OUT=/tmp/demo-artifacts bash scripts/demo/mux-silent.sh
set -euo pipefail

DEMO_OUT="${DEMO_OUT:-/tmp/demo-artifacts}"
WEBM="$DEMO_OUT/silent.webm"
ASS="$DEMO_OUT/captions.ass"
OUT_MP4="${1:-$DEMO_OUT/quickmail-cinematic-demo.mp4}"

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need ffmpeg
need ffprobe

[[ -f "$WEBM" ]] || { echo "missing $WEBM" >&2; exit 1; }
[[ -f "$ASS" ]] || { echo "missing $ASS" >&2; exit 1; }

# Escape ASS path for ffmpeg filtergraph
ASS_ESC="${ASS//\:/\\:}"
ASS_ESC="${ASS_ESC//\'/\\\'}"

# Light grade only — no centered vignette (it fights the mouse follow-cam).
ffmpeg -y \
  -i "$WEBM" \
  -vf "ass=${ASS_ESC},eq=contrast=1.03:saturation=1.04" \
  -c:v libx264 -pix_fmt yuv420p -preset medium -crf 18 \
  -an \
  -movflags +faststart \
  "$OUT_MP4" </dev/null

echo "Wrote $OUT_MP4"
ffprobe -v error -show_entries stream=codec_type,codec_name \
  -show_entries format=duration -of default=noprint_wrappers=1 \
  "$OUT_MP4"
