#!/usr/bin/env bash
# Encode the silent recording to high-quality h264 MP4.
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

# High quality: slow preset, low CRF, film tune, yuv420p for broad playback.
ffmpeg -y \
  -i "$WEBM" \
  -vf "scale=1920:1080:flags=lanczos,unsharp=3:3:0.4:3:3:0.0" \
  -c:v libx264 -pix_fmt yuv420p -preset slow -crf 14 -tune film \
  -profile:v high -level 4.2 \
  -an \
  -movflags +faststart \
  "$OUT_MP4" </dev/null

echo "Wrote $OUT_MP4"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,bit_rate \
  -show_entries format=duration,size,bit_rate -of default=noprint_wrappers=1 \
  "$OUT_MP4"

if [[ -d "$DEMO_OUT/shots" ]]; then
  echo "Shots:"
  ls -1 "$DEMO_OUT/shots"
fi
