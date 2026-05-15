#!/usr/bin/env python3
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Error: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = (SCRIPT_DIR / "..").resolve()
PHOTOS_DIR = REPO_ROOT / "photos"
THUMBS_DIR = PHOTOS_DIR / "_thumbs"
MANIFEST_PATH = SCRIPT_DIR / "photos.json"
INLINE_PATH = SCRIPT_DIR / "photos-inline.js"
SETTINGS_PATH = SCRIPT_DIR / "photo-settings.json"

ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_THUMB_WIDTH = 600


def load_settings():
    defaults = {"favorites": [], "hiddenPhotos": [], "collectionDates": {}, "privateGroups": []}
    if not SETTINGS_PATH.exists():
        return defaults
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Warning: failed to read {SETTINGS_PATH}: {e}", file=sys.stderr)
        return defaults
    return {
        "favorites": [str(v) for v in data.get("favorites", []) if v],
        "hiddenPhotos": [str(v) for v in data.get("hiddenPhotos", []) if v],
        "collectionDates": {
            str(k): str(v)
            for k, v in (data.get("collectionDates", {}) or {}).items()
            if k and v
        },
        "privateGroups": [str(v) for v in data.get("privateGroups", []) if v],
    }


def clean_group_name(name: str) -> str:
    pretty = name.replace("_", " ").strip()
    return re.sub(r"\s+(?:[SsFfWw]\s*)?\d{2}'?$", "", pretty).strip() or pretty


def format_collection_date(value: str) -> str:
    if not value:
        return ""
    try:
        return datetime.strptime(value, "%Y-%m").strftime("%B %Y")
    except ValueError:
        return value


def ensure_thumbnail(src: Path, dst: Path):
    try:
        img = Image.open(src)
        img = ImageOps.exif_transpose(img)
        orig_w, orig_h = img.size

        scale = MAX_THUMB_WIDTH / orig_w if orig_w > MAX_THUMB_WIDTH else 1.0
        new_w = round(orig_w * scale)
        new_h = round(orig_h * scale)

        needs_write = not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime
        if needs_write:
            dst.parent.mkdir(parents=True, exist_ok=True)
            thumb = img.resize((new_w, new_h), Image.LANCZOS)
            thumb.convert("RGB").save(dst, "JPEG", quality=80)

        return {"width": orig_w, "height": orig_h, "thumbWidth": new_w, "thumbHeight": new_h}
    except Exception as e:
        print(f"Warning: failed thumbnail for {src}: {e}", file=sys.stderr)
        return None


PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
THUMBS_DIR.mkdir(parents=True, exist_ok=True)

groups = []
settings = load_settings()
hidden_photos = set(settings["hiddenPhotos"])
private_groups = set(settings["privateGroups"])
collection_dates = settings["collectionDates"]
for group_dir in sorted(PHOTOS_DIR.iterdir()):
    if not group_dir.is_dir() or group_dir.name == "_thumbs":
        continue

    files = sorted(
        [f for f in group_dir.iterdir() if f.is_file() and f.suffix.lower() in ALLOWED_EXTS],
        key=lambda f: f.name,
    )

    items, rel_photos, rel_thumbs = [], [], []
    for f in files:
        rel = f"photos/{group_dir.name}/{f.name}"
        if rel in hidden_photos:
            continue
        rel_photos.append(rel)

        thumb_path = THUMBS_DIR / group_dir.name / (f.stem + ".jpg")
        meta = ensure_thumbnail(f, thumb_path)
        thumb_rel = str(thumb_path.relative_to(REPO_ROOT)).replace(os.sep, "/")
        rel_thumbs.append(thumb_rel)

        items.append({
            "src": rel,
            "thumb": thumb_rel,
            "name": f.stem,
            "width": meta["width"] if meta else None,
            "height": meta["height"] if meta else None,
        })

    groups.append({
        "id": group_dir.name,
        "name": clean_group_name(group_dir.name),
        "collectionDate": format_collection_date(collection_dates.get(group_dir.name, "")),
        "collectionMonth": collection_dates.get(group_dir.name, ""),
        "visibility": "private" if group_dir.name in private_groups else "public",
        "cover": rel_photos[0] if rel_photos else None,
        "coverThumb": rel_thumbs[0] if rel_thumbs else None,
        "photos": rel_photos,
        "thumbs": rel_thumbs,
        "items": items,
    })

manifest = {
    "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "thumbWidth": MAX_THUMB_WIDTH,
    "favorites": [src for src in settings["favorites"] if src not in hidden_photos],
    "hiddenPhotos": settings["hiddenPhotos"],
    "groups": groups,
    "locations": [],
}

json_str = json.dumps(manifest, indent=2, ensure_ascii=False)
MANIFEST_PATH.write_text(json_str, encoding="utf-8")
print(f"Wrote manifest to {MANIFEST_PATH}")

INLINE_PATH.write_text(f"window.__PHOTOSHARE_MANIFEST__ = {json_str};", encoding="utf-8")
print(f"Wrote inline manifest to {INLINE_PATH}")
