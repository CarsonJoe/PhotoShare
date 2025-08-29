# PhotoShare (Static GitHub Pages)

A minimal, no-build photo gallery: drop photos into folders under `photos/`, double‑click `publish.bat`, and your GitHub Pages site updates.

## Structure

- `app/` — static app (HTML/CSS/JS) and generated `photos.json`
- `photos/` — your photo albums, one folder per album
- `publish.bat` — generates manifest and pushes to Git
- `.nojekyll` — created automatically to keep GitHub Pages from Jekyll processing

Example:

```
/photos
  /my_trip_2024
    img_001.jpg
    img_002.jpg
/app
  index.html
  album.html
  main.js
  styles.css
```

Underscores in folder names are shown as spaces (e.g. `my_trip_2024` → `my trip 2024`).

## Use

1) Add or update folders in `photos/` with images (`.jpg/.jpeg/.png/.gif/.webp`).
2) Double‑click `publish.bat`.
   - Scans `photos/`, writes `app/photos.json`, commits, and pushes.
3) Enable GitHub Pages (repo Settings → Pages → Deploy from branch: `main`, folder: `/ (root)`).
4) Visit your Pages URL. `app/index.html` lists albums; click a album to view and download images.

Tip: Right‑click a photo to save, or click “Download” to trigger a download.

## Notes

- Keep it simple: no frameworks, no build step. The only “generation” is the manifest JSON.
- If `publish.bat` fails to push, ensure Git is installed, a remote `origin` exists, and you’re authenticated.
- If you prefer a custom domain, add a `CNAME` file at repo root with your domain and re‑publish.

## Privacy

This is a public site. Anyone with the URL can view and download your images.


## Thumbnails & Lightbox

- `publish.bat` calls `app/generate_manifest.ps1`, which also creates JPEG thumbnails (~600px wide) under `photos/_thumbs/<album>/<name>.jpg` for faster gallery loading.
- Album covers and grid images use these thumbnails; clicking an image opens a lightbox with next/prev controls that loads the original file in full resolution.
- RAW files (e.g., `.RW2`) are currently ignored; export to JPEG/PNG to include them.
