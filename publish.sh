#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="$REPO_ROOT/staging"
PHOTOS_DIR="$REPO_ROOT/photos"

# ── Step 0: Import staged photos ─────────────────────────────────────────────
echo "[0/3] Importing staged edits (if any)..."

if [[ -d "$STAGING_DIR" ]]; then
  for album_dir in "$STAGING_DIR"/*/; do
    [[ -d "$album_dir" ]] || continue
    album="$(basename "$album_dir")"
    dst="$PHOTOS_DIR/$album"
    mkdir -p "$dst"

    for file in "$album_dir"*; do
      [[ -f "$file" ]] || continue
      ext="${file##*.}"
      case "${ext,,}" in
        jpg|jpeg|png|gif|webp) ;;
        *) continue ;;
      esac
      base="$(basename "${file%.*}")"
      target="$dst/$base.$ext"
      n=0
      while [[ -e "$target" ]]; do
        (( n++ ))
        target="$dst/${base}_${n}.$ext"
      done
      mv "$file" "$target"
    done

    # Remove empty album dir
    [[ -z "$(ls -A "$album_dir")" ]] && rmdir "$album_dir"
  done

  # Remove empty staging dir
  [[ -z "$(ls -A "$STAGING_DIR")" ]] && rmdir "$STAGING_DIR"
fi

# ── Step 1: Generate photo manifest ──────────────────────────────────────────
echo "[1/3] Generating photo manifest..."
python3 "$REPO_ROOT/app/generate_manifest.py" || {
  echo "Failed to generate manifest."
  exit 1
}

[[ -f "$REPO_ROOT/.nojekyll" ]] || touch "$REPO_ROOT/.nojekyll"

# ── Step 2: Commit ────────────────────────────────────────────────────────────
echo "[2/3] Adding and committing changes..."
git -C "$REPO_ROOT" add -A

if ! git -C "$REPO_ROOT" diff --cached --quiet; then
  TS="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "Committing with message: Publish: $TS"
  git -C "$REPO_ROOT" commit -m "Publish: $TS"
else
  echo "No changes to commit."
fi

# ── Step 3: Push ──────────────────────────────────────────────────────────────
echo "[3/3] Pushing to origin..."
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "Current branch: ${BRANCH:-main}"
git -C "$REPO_ROOT" push origin "${BRANCH:-main}" || {
  echo "Push failed. Ensure the remote is set and you are logged in."
  exit 1
}

echo "Done. If not already, enable GitHub Pages (Settings > Pages > Deploy from main, root)."
