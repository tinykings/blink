# Blink

<p align="center">
  <img src="images/icon-192.png" alt="Blink Logo" width="120" />
</p>

<h3 align="center">A minimal RSS reader hosted on GitHub Pages.</h3>
<h4 align="center">https://tinykings.github.io/blink/</h4>

---

Blink is a client-side RSS reader that runs entirely in the browser. Fork it, add your feeds, enable GitHub Pages, and you have a personal feed reader that updates hourly — no server required.

**Note:** A GitHub Gist is required to use Blink. Your Gist stores your starred items and enables sync across devices.

## Features

- **RSS & YouTube** — Subscribe to any RSS/Atom feed or YouTube channel. YouTube channel URLs are automatically converted to RSS feeds.
- **Starred items** — Star items to save them permanently. Recent unstarred items are pruned after a configurable number of days.
- **Gist sync** — Sync starred items across devices using a private GitHub Gist.
- **Keyboard navigation** — Browse and interact without leaving the keyboard.
- **PWA** — Installable as a Progressive Web App with offline support via Service Worker.
- **Dark/light mode** — Follows system preference.

## Quick Start

1. **Fork** this repository.
2. Edit `feeds.txt` to add your RSS feeds and YouTube channels (see [Configuration](#configuration) below).
3. Go to **Settings → Pages** in your fork and set the source to **GitHub Actions**.
4. GitHub Actions will fetch your feeds hourly and deploy the updated site automatically.
5. **Create a GitHub Gist** — This is required to use Blink. See [Setup](#setup) below.

Your reader will be live at `https://<your-username>.github.io/blink/`.

## Setup

On first visit, you will be prompted to enter your GitHub Gist credentials:

1. **Create a GitHub Gist** at [gist.github.com](https://gist.github.com) (can be private — the content doesn't matter).
2. **Create a Personal Access Token** at [github.com/settings/tokens](https://github.com/settings/tokens) with the `gist` scope.
3. Enter your **Gist ID** (the long alphanumeric string in your Gist's URL) and **GitHub Token** in the setup form.

Blink will sync automatically on startup, on tab focus, and after reconnecting to the network.

## Configuration

### feeds.txt

`feeds.txt` is the only file you need to edit. Add RSS feeds under `#rss` and YouTube channels under `#youtube`. Comments starting with `#` (other than the section headers) are used as channel labels.

```
#rss
https://www.reddit.com/r/sysadmin/top.rss?t=week
https://hnrss.org/frontpage

#youtube
# Apple
https://www.youtube.com/@Apple
# Some Channel (direct feed also works)
https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxxx
```

YouTube channel URLs (`@handle` format) are automatically resolved to their RSS feeds by the fetch script.

### Retention

Items are kept for 2 days by default. To change this, set `ITEMS_RETENTION_DAYS` in `scripts/fetch_feeds.py`. Starred items are kept indefinitely.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` | Next item |
| `k` | Previous item |
| `s` | Star / unstar |
| `o` | Open in new tab |
| `?` | Show help |

## Local Development

```bash
git clone https://github.com/<your-username>/blink.git
cd blink
pip install -r requirements.txt
python scripts/fetch_feeds.py   # fetches feeds and writes index.html
python -m http.server            # serve at http://localhost:8000
```

## How It Works

`scripts/fetch_feeds.py` reads `feeds.txt`, fetches all feeds in parallel, and embeds the results as JSON in `index.html`. The browser-side JavaScript reads this data and renders the UI. There is no backend — everything runs at build time via GitHub Actions and then client-side in the browser.

The GitHub Actions workflow (`.github/workflows/main.yml`) runs hourly, commits the updated `index.html`, and triggers a Pages deployment.
