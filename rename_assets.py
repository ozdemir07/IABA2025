#!/usr/bin/env python3
"""
Batch renamer for IABA2025 assets.

Folders (any that exist under ROOT) are mapped to prefixes:
  plans -> p, sections -> s, site-plans -> sp, diagrams -> d,
  perspectives -> r, mockup/mockups -> m

Examples:
  assets/plans/anything.png        -> assets/plans/p001.jpg   (if --jpg)
  assets/site-plans/abc.webp       -> assets/site-plans/sp017.webp (default)
  assets/mockup/img (1).JPG        -> assets/mockup/m003.JPG (kept ext)

Dry-run by default. Use --apply to actually rename.
Writes rename_log.csv with old_path,new_path for undo/reference.
"""

from __future__ import annotations
import os, sys, csv, uuid
from pathlib import Path
from typing import Dict, List, Tuple

# ----------------------- Config -----------------------
ROOT = Path("assets")  # folder containing your group folders
FOLDER_PREFIX: Dict[str, str] = {
    "plans": "p",
    "sections": "s",
    "site-plans": "sp",
    "diagrams": "d",
    "perspectives": "r",
    "mockups": "m",  
}

# File types to rename
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}

# Numbering starts at 1; zero-padding auto-scales with count (min 3)
START_INDEX = 1
MIN_PAD = 3

# Behavior flags (can be overridden by CLI)
DRY_RUN = True          # default is dry-run; use --apply to actually rename
FORCE_JPG = False       # if True, output uses .jpg for everything (lowercase)
PRESERVE_CASE = False   # if True, keep the original extension case

LOG_FILE = "rename_log.csv"
# ------------------------------------------------------


def gather_files(folder: Path) -> List[Path]:
    files = []
    for p in folder.iterdir():
        if p.is_file():
            ext = p.suffix.lower()
            if ext in ALLOWED_EXT:
                files.append(p)
    # stable order
    files.sort(key=lambda x: x.name.lower())
    return files


def pad_width(n_items: int) -> int:
    return max(MIN_PAD, len(str(START_INDEX + max(0, n_items - 1))))


def temp_name(p: Path) -> Path:
    return p.with_name(f"__tmp__{uuid.uuid4().hex}__{p.name}")


def compute_target_name(folder: Path, prefix: str, idx: int, original: Path) -> Path:
    if FORCE_JPG:
        ext = ".jpg"
    else:
        ext = original.suffix if PRESERVE_CASE else original.suffix.lower()
    return folder / f"{prefix}{idx:0{pad_width_in_folder[folder]}d}{ext}"


def plan_moves() -> List[Tuple[Path, Path]]:
    moves: List[Tuple[Path, Path]] = []
    for folder_name, prefix in FOLDER_PREFIX.items():
        folder = ROOT / folder_name
        if not folder.exists() or not folder.is_dir():
            continue

        files = gather_files(folder)
        n = len(files)
        if n == 0:
            continue

        pad = pad_width(n)
        pad_width_in_folder[folder] = pad

        idx = START_INDEX
        for f in files:
            target = compute_target_name(folder, prefix, idx, f)
            idx += 1
            if f.resolve() == target.resolve():
                continue  # already correct
            moves.append((f, target))
    return moves


def ensure_unique_targets(moves: List[Tuple[Path, Path]]) -> None:
    # If any target collides with an existing *different* file, we’ll two-phase rename
    # (temp all sources first, then to final names). We don’t need to modify the list here.
    pass


def perform_moves(moves: List[Tuple[Path, Path]], dry_run: bool) -> None:
    if not moves:
        print("Nothing to rename.")
        return

    # Phase 0: create CSV log header
    if not dry_run:
        with open(LOG_FILE, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["old_path", "new_path"])

    # Phase 1: rename all sources to unique temp names (avoid collisions)
    temp_paths: Dict[Path, Path] = {}
    if not dry_run:
        for src, _ in moves:
            tmp = temp_name(src)
            src.rename(tmp)
            temp_paths[src] = tmp

    # Phase 2: move temps to final targets
    for src, dst in moves:
        if dry_run:
            print(f"[dry-run] {src}  ->  {dst}")
        else:
            tmp = temp_paths[src]
            # Ensure folder exists
            dst.parent.mkdir(parents=True, exist_ok=True)
            # If a file with the final name exists, remove it (rare—likely our own temp)
            if dst.exists() and dst != tmp:
                dst.unlink()
            tmp.rename(dst)
            with open(LOG_FILE, "a", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow([str(src), str(dst)])

    if dry_run:
        print("\n(Dry-run) No files changed. Re-run with --apply to rename.")
    else:
        print(f"\nDone. Log written to {LOG_FILE}")


def parse_args():
    global DRY_RUN, FORCE_JPG, PRESERVE_CASE
    args = sys.argv[1:]
    if "--apply" in args:
        DRY_RUN = False
    if "--jpg" in args:
        FORCE_JPG = True
    if "--preserve-ext-case" in args:
        PRESERVE_CASE = True
    if "--help" in args or "-h" in args:
        print(
            "Usage:\n"
            "  py rename_assets.py [--apply] [--jpg] [--preserve-ext-case]\n\n"
            "Options:\n"
            "  --apply               Perform the rename (default is dry-run).\n"
            "  --jpg                 Force all outputs to .jpg extension.\n"
            "  --preserve-ext-case   Keep original extension case (e.g., .JPG).\n"
        )
        sys.exit(0)


# pad cache per folder (computed from file count)
pad_width_in_folder: Dict[Path, int] = {}

def main():
    parse_args()

    if not ROOT.exists():
        print(f"ERROR: ROOT folder not found: {ROOT.resolve()}")
        sys.exit(1)

    moves = plan_moves()
    ensure_unique_targets(moves)
    perform_moves(moves, dry_run=DRY_RUN)


if __name__ == "__main__":
    main()
