#!/usr/bin/env bash
# Concatenate paced narration + burn ASS captions + mux final MP4.
#
# Usage:
#   export DEMO_OUT=/tmp/demo-artifacts
#   bash mux.sh
#
# Expects:
#   $DEMO_OUT/audio/manifest.json
#   $DEMO_OUT/silent.webm          (from record-demo.mjs)
#   $DEMO_OUT/captions.ass

set -euo pipefail

DEMO_OUT="${DEMO_OUT:-/tmp/demo-artifacts}"
AUDIO="$DEMO_OUT/audio"
MANIFEST="$AUDIO/manifest.json"
WEBM="$DEMO_OUT/silent.webm"
ASS="$DEMO_OUT/captions.ass"
OUT_MP4="${1:-$DEMO_OUT/feature-tutorial.mp4}"

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need ffmpeg
need ffprobe
need python3

[[ -f "$MANIFEST" ]] || { echo "missing $MANIFEST" >&2; exit 1; }
[[ -f "$WEBM" ]] || { echo "missing $WEBM" >&2; exit 1; }
[[ -f "$ASS" ]] || { echo "missing $ASS" >&2; exit 1; }

# 250ms silence to match recorder breath between segments
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.25 \
  -q:a 9 -acodec libmp3lame "$AUDIO/silence250.mp3" </dev/null

python3 - <<PY
import json
from pathlib import Path
audio = Path("$AUDIO")
manifest = json.loads((audio / "manifest.json").read_text())
lines = []
for i, m in enumerate(manifest):
    lines.append(f"file '{m['file']}'")
    if i < len(manifest) - 1:
        lines.append(f"file '{audio / 'silence250.mp3'}'")
(audio / "concat-paced.txt").write_text("\n".join(lines) + "\n")
print(f"concat entries: {len(lines)}")
PY

ffmpeg -y -f concat -safe 0 -i "$AUDIO/concat-paced.txt" -c copy "$AUDIO/narration.mp3" </dev/null

echo "video:  $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$WEBM")s"
echo "audio:  $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$AUDIO/narration.mp3")s"

ffmpeg -y \
  -i "$WEBM" \
  -i "$AUDIO/narration.mp3" \
  -vf "ass=$ASS" \
  -c:v libx264 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -af apad -shortest \
  -movflags +faststart \
  "$OUT_MP4" </dev/null

echo "Wrote $OUT_MP4"
ffprobe -v error -show_entries stream=codec_type,codec_name \
  -show_entries format=duration -of default=noprint_wrappers=1 \
  "$OUT_MP4"
