<p align="center">
  <img src="images/icon.png" alt="Blink Logo" width="120" />
</p>

<h1 align="center">Blink</h1>

Blink is a minimalist, static feed reader that blends your favorite RSS sources and YouTube channels into one fast page. A small Python script builds a single `index.html`; a lightweight front‑end adds starring, a "new items" divider, and installable PWA support.

## Features

- 📰 Unified feed: Mix plain RSS and YouTube channels in one view.
- 📺 YouTube auto‑RSS: Paste channel URLs — Blink resolves them to RSS and records channel names.
- ⭐ Starring + filter: Sync stars across devices using Github Gist, or use local browser storage.
- ⬆️ Handy controls: Back‑to‑top, refresh, and a footer timestamp with retention days.
- ▶️ Lazy videos: YouTube embeds load only when you click, keeping the page light.
- ⏰ Leaving soon: Labels items nearing the rolling retention window (default 5 days).
- 🤖 Automated updates: GitHub Actions fetches feeds on a schedule and commits updated `index.html` and a normalized `feeds.txt`.

## Quick Start

1) Requirements

- Python 3.x
- `pip install feedparser beautifulsoup4 lxml requests pytz`

2) Add feeds

- Edit `feeds.txt` and place URLs under the `#rss` and `#youtube` headers.
- You can paste full YouTube channel URLs or existing YouTube RSS URLs — Blink will normalize them.

3) Build the page

- Run: `python3 scripts/fetch_feeds.py`
- Output: `index.html` is generated from `index.template.html` with items injected and JSON data embedded.
- Open `index.html` in your browser.

## Usage Notes

- Starred items are stored in your browser and persist across visits. Use the star button in the footer to filter.
- A "^ New ^" divider appears between items you haven’t seen and ones you have (tracked via `localStorage`).
- YouTube thumbnails are shown; clicking plays the embed inline. Other feeds show a thumbnail if one can be extracted.
- The UI intentionally omits per‑item dates and feed titles to stay compact.

## Configuration

Tune behavior at the top of `scripts/fetch_feeds.py`:

- `TIMEZONE`: Timezone used for timestamps and the footer.
- `ITEMS_RETENTION_DAYS`: Rolling window for items included and for the "Leaving soon" label.
- `REQUEST_TIMEOUT`, `USER_AGENT`: Network fetch tuning.

When you run the script:

- YouTube channel URLs are converted to RSS; `feeds.txt` is rewritten in a normalized format and annotated with channel names.

## Deploy

### GitHub Pages (automated)

This repo includes `.github/workflows/main.yml`:

- Fetches feeds and regenerates `index.html` on a schedule (hourly by default via cron).
- Commits changes to `index.html` and `feeds.txt` and pushes them.

Steps:

1) Push this project to GitHub.
2) In the repo, open Settings → Pages and set Source to GitHub Actions.
3) Visit `https://<username>.github.io/<repo>/` once the action completes.

## Star Gist Sync

- Create a private Gist at `gist.github.com`
- File name `starred.json`
- Save the gist ID
- Create a personal access token (classic), with Gist access

When loading the page for the first time on a device enter the ID and token to add the device to the sync group.

## File Map

- `feeds.txt`: Your sources (`#rss`, `#youtube`).
- `scripts/fetch_feeds.py`: Fetch/convert/normalize feeds, generate HTML + JSON, write `index.html`.
- `index.template.html`: HTML shell with placeholders.
- `index.html`: Built page (committed by CI).
- `js/main.js`: Starring, filtering, lazy YouTube embeds, PWA registration.
- `css/style.css`: UI styles, light/dark, iOS PWA fixes.

## FAQ

- Can I paste a YouTube channel URL? Yes. The script resolves it to an RSS feed and rewrites `feeds.txt` accordingly.
- Where do starred items live? In your browser (`localStorage`) — they don’t sync between devices.
- Why don’t I see dates/feed names on cards? The layout is intentionally compact; the footer shows last updated time and retention window.
