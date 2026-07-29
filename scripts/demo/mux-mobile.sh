#!/usr/bin/env bash
# Encode mobile silent recording to WhatsApp-friendly vertical MP4 (1080×1920).
#
# Usage:
#   DEMO_OUT=/tmp/demo-mobile bash scripts/demo/mux-mobile.sh
set -euo pipefail

DEMO_OUT="${DEMO_OUT:-/tmp/demo-mobile}"
WEBM="$DEMO_OUT/silent.webm"
OUT_MP4="${1:-$DEMO_OUT/quickmail-mobile-demo.mp4}"

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need ffmpeg
need ffprobe

[[ -f "$WEBM" ]] || { echo "missing $WEBM" >&2; exit 1; }

# Upscale phone capture to 1080×1920 for WhatsApp Status / chat sharing.
ffmpeg -y \
  -i "$WEBM" \
  -vf "scale=1080:1920:flags=lanczos,unsharp=3:3:0.35:3:3:0.0" \
  -c:v libx264 -pix_fmt yuv420p -preset slow -crf 16 -tune film \
  -profile:v high -level 4.2 \
  -an \
  -movflags +faststart \
  "$OUT_MP4" </dev/null

echo "Wrote $OUT_MP4"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height \
  -show_entries format=duration,size -of default=noprint_wrappers=1 \
  "$OUT_MP4"

if [[ -d "$DEMO_OUT/shots" ]]; then
  echo "Shots:"
  ls -1 "$DEMO_OUT/shots"
fi
