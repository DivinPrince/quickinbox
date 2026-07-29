#!/usr/bin/env python3
"""Generate ElevenLabs narration segments + manifest.json for tutorial demos.

Usage:
  export ELEVEN_API_KEY=sk_...
  export ELEVEN_VOICE_ID=Xb7hH8MSUJpSbSDYk0k2   # optional (Alice)
  export ELEVEN_MODEL=eleven_multilingual_v2     # optional
  python3 gen-narration.py --script scenes.json --out ./audio

scenes.json format (see assets/scenes.example.json):
  [
    {"id": "01-intro", "caption": "Welcome", "text": "Spoken narration..."},
    ...
  ]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import urllib.error
import urllib.request
from pathlib import Path


def duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
    ).strip()
    return float(out)


def tts(text: str, dest: Path, *, key: str, voice_id: str, model: str) -> None:
    body = json.dumps(
        {
            "text": text,
            "model_id": model,
            "voice_settings": {
                "stability": 0.4,
                "similarity_boost": 0.8,
                "style": 0.35,
                "use_speaker_boost": True,
            },
        }
    ).encode()
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        data=body,
        headers={
            "xi-api-key": key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            dest.write_bytes(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"ElevenLabs HTTP {e.code}: {detail}") from e


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--script", required=True, help="Path to scenes.json")
    parser.add_argument("--out", required=True, help="Output audio directory")
    args = parser.parse_args()

    key = os.environ.get("ELEVEN_API_KEY")
    if not key:
        raise SystemExit("Set ELEVEN_API_KEY")

    voice_id = os.environ.get("ELEVEN_VOICE_ID", "Xb7hH8MSUJpSbSDYk0k2")
    model = os.environ.get("ELEVEN_MODEL", "eleven_multilingual_v2")

    scenes = json.loads(Path(args.script).read_text())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    manifest = []
    for i, seg in enumerate(scenes, 1):
        for field in ("id", "caption", "text"):
            if field not in seg:
                raise SystemExit(f"scene {i} missing '{field}'")
        mp3 = out / f"{seg['id']}.mp3"
        print(f"[{i}/{len(scenes)}] {seg['id']} …", flush=True)
        tts(seg["text"], mp3, key=key, voice_id=voice_id, model=model)
        dur = duration(mp3)
        item = {
            **seg,
            "file": str(mp3.resolve()),
            "durationSec": round(dur, 3),
        }
        manifest.append(item)
        print(f"  {dur:.2f}s — {seg['caption']}", flush=True)

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    total = sum(m["durationSec"] for m in manifest)
    print(f"Total narration: {total:.1f}s → {out / 'manifest.json'}")


if __name__ == "__main__":
    main()
