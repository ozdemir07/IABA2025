# make_manifest.py
# Scans assets/* subfolders and writes data/manifest.json with all images.

import json, os, pathlib

# Where your assets live (adjust if needed)
ASSETS = pathlib.Path("assets")
OUT    = pathlib.Path("data/manifest.json")

# Map manifest keys -> folder names under assets/
GROUPS = {
    "plans":         "plans",
    "sections":      "sections",
    # keep BOTH spellings in case your app expects either
    "siteplans":     "site-plans",
    "sitePlans":     "site-plans",
    "diagrams":      "diagrams",
    "perspectives":  "perspectives",
    "mockups":       "mockups",
}

# file extensions we will include
EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

def list_files(folder: pathlib.Path):
    if not folder.exists():
        return []
    items = []
    for name in sorted(os.listdir(folder)):
        p = folder / name
        if p.is_file() and p.suffix.lower() in EXTS:
            # write web-friendly forward slashes
            items.append(str(p.as_posix()))
    return items

def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    manifest = {}
    for key, sub in GROUPS.items():
        manifest[key] = list_files(ASSETS / sub)

    # Pretty JSON for easy diffing
    OUT.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"✅ Wrote {OUT} with:")
    for k in GROUPS:
        print(f"  - {k}: {len(manifest[k])} files")

if __name__ == "__main__":
    main()
