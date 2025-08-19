# make_video_manifest.py
import json, os, pathlib

VID_DIR = pathlib.Path("media")   # folder now named 'media'
OUT = pathlib.Path("data/videos.json")
OUT.parent.mkdir(parents=True, exist_ok=True)

# ✅ generate "media/..." instead of "videos/..."
videos = [f"media/{n}" for n in sorted(os.listdir(VID_DIR)) if n.lower().endswith(".mp4")]

OUT.write_text(json.dumps({"videos": videos}, indent=2), encoding="utf-8")
print(f"wrote {OUT} ({len(videos)} items)")
