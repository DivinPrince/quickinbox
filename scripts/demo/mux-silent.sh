#!/usr/bin/env bash
# Encode the silent recording to h264 MP4.
# Captions are burned into the WebM already (on-screen top-right chips).
#
# Usage:
#   DEMO_OUT=/tmp/demo-artifacts bash scripts/demo/mux-silent.sh
set -euo pipefail

DEMO_OUT="${DEMO_OUT:-/tmp/demo-artifacts}"
WEBM="$DEMO_OUT/silent.webm"
OUT_MP4="${1:-$DEMO_OUT/quickmail-cinematic-demo.mp4}"

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need ffmpeg
need ffprobe

[[ -f "$WEBM" ]] || { echo "missing $WEBM" >&2; exit 1; }

ffmpeg -y \
  -i "$WEBM" \
  -c:v libx264 -pix_fmt yuv420p -preset medium -crf 18 \
  -an \
  -movflags +faststart \
  "$OUT_MP4" </dev/null

echo "Wrote $OUT_MP4"
ffprobe -v error -show_entries stream=codec_type,codec_name \
  -show_entries format=duration -of default=noprint_wrappers=1 \
  "$OUT_MP4"

if [[ -d "$DEMO_OUT/shots" ]]; then
  echo "Shots:"
  ls -1 "$DEMO_OUT/shots"
fi
