# Raw File Storage

A small static web app that turns any file into direct `raw.githubusercontent.com` links.

Files are uploaded to a GitHub repository through the Contents API. When a file is larger than the configured chunk size (default 20 MB, safely below GitHub's ~100 MB per-file limit) it is split into multiple chunks, each uploaded as its own file, plus a `manifest.json` that records the original name, size and chunk order.

## Features

- Drag & drop or browse to select a file
- Configurable chunk size (1–90 MB)
- Progress tracking per chunk
- One raw link per chunk plus a manifest link
- Client-side reconstruction download (fetches chunks and merges them)
- Settings persisted in `localStorage`
- No backend required — runs entirely in the browser

## Usage

1. Create a GitHub personal access token with **Contents: Read & Write** on a storage repository.
2. Open the site, enter the token, `owner/repo`, branch and optional folder prefix.
3. Click **Test connection**.
4. Select a file and **Upload to GitHub**.
5. Copy the raw links or download the reconstructed file.

## Deploy (GitHub Pages)

This repo includes a workflow that publishes the site to GitHub Pages on push to `main`.

You can also serve it locally:

```bash
python -m http.server 8080
```

## Notes

- GitHub's Contents API has practical per-file limits; keep chunk sizes at or below ~90 MB.
- Very large files produce many chunks and many API calls; respect GitHub rate limits.
- Tokens are stored only in your browser's `localStorage`.