# batch_contrast_videos.py
# Requires: ffmpeg in PATH  (https://ffmpeg.org/)
# Usage: python batch_contrast_videos.py

import os
import subprocess
from pathlib import Path

# -------- Settings --------
INPUT_DIR       = Path("media")          # your source folder
OUTPUT_DIR      = Path("media_contrast") # output folder (non-destructive)
CONTRAST_GAIN   = 1.20                   # e.g. 1.0=no change, 1.2 = +20%
OVERWRITE_ALL   = True                   # overwrite outputs if exist
VIDEO_EXTS      = {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"}  # add if needed

# Optional: set None to process top-level only; or set True to recurse
RECURSIVE       = False

# Codec map per extension so we keep the same container/extension
# (Filters require re-encode; these are broadly compatible defaults.)
CODEC_FOR_EXT = {
    ".mp4":  ("libx264", ["-pix_fmt", "yuv420p"]),
    ".m4v":  ("libx264", ["-pix_fmt", "yuv420p"]),
    ".mov":  ("libx264", ["-pix_fmt", "yuv420p"]),
    ".mkv":  ("libx264", ["-pix_fmt", "yuv420p"]),
    ".avi":  ("libx264", ["-pix_fmt", "yuv420p"]),
    ".webm": ("libvpx-vp9", []),  # stays webm
}

def build_ffmpeg_cmd(src: Path, dst: Path) -> list:
    ext = src.suffix.lower()
    vcodec, extra_v = CODEC_FOR_EXT.get(ext, ("libx264", ["-pix_fmt", "yuv420p"]))
    # eq filter: contrast only
    vf = f"eq=contrast={CONTRAST_GAIN}"
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-y" if OVERWRITE_ALL else "-n",
        "-i", str(src),
        "-vf", vf,
        "-c:v", vcodec, *extra_v,
        "-c:a", "copy",        # keep original audio
        "-movflags", "+faststart" if ext in (".mp4", ".m4v", ".mov") else "",  # safe no-op otherwise
        "-threads", "0",
        str(dst)
    ]
    # Remove potential empty arg caused by movflags for non-mp4/mov
    return [a for a in cmd if a != ""]

def main():
    if not INPUT_DIR.exists():
        print(f"❌ INPUT_DIR not found: {INPUT_DIR}")
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Gather inputs
    files = []
    if RECURSIVE:
        for p in INPUT_DIR.rglob("*"):
            if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
                files.append(p)
    else:
        for p in INPUT_DIR.iterdir():
            if p.is_file() and p.suffix.lower() in VIDEO_EXTS:
                files.append(p)

    if not files:
        print(f"⚠️  No video files found in {INPUT_DIR}")
        return

    print(f"🔧 Processing {len(files)} videos with contrast={CONTRAST_GAIN} …\n")

    ok = 0
    for src in files:
        rel = src.relative_to(INPUT_DIR)
        out_path = OUTPUT_DIR / rel
        out_path.parent.mkdir(parents=True, exist_ok=True)

        cmd = build_ffmpeg_cmd(src, out_path)
        try:
            subprocess.run(cmd, check=True)
            ok += 1
            print(f"✔ {rel} → {out_path.relative_to(OUTPUT_DIR)}")
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed: {rel}\n   cmd: {' '.join(cmd)}\n   error: {e}")

    print(f"\n✅ Done. {ok}/{len(files)} videos saved to {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
