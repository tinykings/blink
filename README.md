# Blink

<p align="center">
  <img src="images/icon-192.png" alt="Blink Logo" width="120" />
</p>

<h3 align="center">A minimal RSS reader hosted on GitHub Pages.</h3>
<h4 align="center">https://tinykings.github.io/blink/</h4>

---

Blink is a client-side RSS reader that runs entirely in the browser. Fork it, add your feeds, enable GitHub Pages, and you have a personal feed reader refreshed hourly by GitHub Actions — no server required.

**Note:** A GitHub Gist is required to use Blink. Your Gist stores unread items, read state, and stars across devices.

## Features

- **RSS & YouTube** — Manage subscriptions by editing `feeds.txt` on GitHub. YouTube channel URLs are automatically converted to RSS feeds.
- **Starred items** — Star items to save them permanently. Recent unstarred items are pruned after a configurable number of days.
- **Gist sync** — Sync starred items across devices using a private GitHub Gist.
- **Inbox reset** — Mark all current unstarred items read with one button; scheduled builds fetch new items hourly.
- **Keyboard navigation** — Browse and interact without leaving the keyboard.
- **PWA** — Installable as a Progressive Web App with offline support via Service Worker.
- **Dark/light mode** — Follows system preference.

## Quick Start

1. **Fork** this repository.
2. Edit `feeds.txt` to add initial RSS feeds and YouTube channels (see [Configuration](#configuration) below).
3. Go to **Settings → Pages** in your fork and set the source to **GitHub Actions**.
4. Add repository variable `GIST_AUTH_URL` with shared OAuth Worker URL.
5. Wait for the hourly workflow, or run it once by pushing a commit, to fetch feeds and deploy the site.

Your reader will be live at `https://<your-username>.github.io/blink/`.

## Setup

On first visit, select **Connect GitHub** and authorize Gist access. Blink finds your app Gist or creates private Gist automatically.

Blink loads read state and stars from `blink-data.json` on startup and merges changes after network reconnect. Every save fetches and merges remote state first. Read and star changes have separate timestamps so starring does not mark an item read.

Blink shows unread and starred items only. Opening a link or playing a video does not mark it read. **Mark current items read** marks all current unstarred items read, including items you have not scrolled to. Those items disappear immediately, while starred items stay visible. New or updated items arrive with the next hourly deployment. When there is nothing left to mark read, the same button triggers the feed workflow, reports its status, and reloads when the refresh finishes. There is no read-item archive or view toggle.

## Configuration

### feeds.txt

Manage subscriptions by editing `feeds.txt` directly on GitHub; the next hourly workflow applies changes. The GitHub button in the left footer opens the project repository (automatically pointing to your fork when deployed with GitHub Actions). There are no in-app settings. Use the footer checkmark button to mark current unstarred items read, or to trigger a feed refresh when nothing is unread. Add RSS feeds under `#rss` and YouTube channels under `#youtube`. Comments starting with `#` (other than the section headers) are used as channel labels.

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

YouTube channel URLs (`@handle` format) are automatically resolved to their RSS feeds by the fetch script. Set `include_youtube_shorts=true` under `#settings` in `feeds.txt` to include Shorts in the regular feed, using the same player and read/star controls as other videos. Shorts are excluded by default.

### Retention

The feed fetcher includes items from the last 5 days by default. To change this window, set `ITEMS_RETENTION_DAYS` in `scripts/fetch_feeds.py`.

Once Blink loads an item, it saves unread content in `blink-data.json`. Unread items survive reloads and sync until you mark them read. Items merge by ID, newest publication first.

Marking current items read saves every current unstarred item as read and removes it from view. Starred content stays indefinitely. Compact read markers remain so older tabs cannot restore read items as unread. Feed fetching and site deployment run hourly from the scheduled GitHub Actions workflow. Clicking the checkmark with nothing unread dispatches that workflow immediately and reloads after it completes.

Backlog capture starts when this version loads successfully. It cannot recover entries already missing from both the page and Gist. Entries published and removed between visits are not captured. Local development uses browser storage instead of Gist. Unread content and read markers increase storage use over time.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` | Next item |
| `k` | Previous item |
| `s` | Star / unstar |
| `o` | Open in new tab |
| `?` | Show help |

## Local Development

Local development bypasses GitHub OAuth and Gist sync. Read state stays in browser storage. Edit local `feeds.txt` directly to change subscriptions.

```bash
git clone https://github.com/<your-username>/blink.git
cd blink
pip install -r requirements.txt
python scripts/fetch_feeds.py   # initial index.html
python scripts/dev_server.py    # http://127.0.0.1:8000
```

Run `python scripts/fetch_feeds.py` again after editing `feeds.txt` or whenever you need fresh local feed data.

`js/config.local.js` is not needed. Localhost always uses local development mode; deployed Pages builds inject GitHub configuration during deployment.

## How It Works

`scripts/fetch_feeds.py` reads `feeds.txt`, fetches all feeds in parallel, and embeds the results as JSON in `index.html`. The browser-side JavaScript reads this data and renders the UI. There is no backend — everything runs at build time via GitHub Actions and then client-side in the browser.

The GitHub Actions workflow (`.github/workflows/main.yml`) runs hourly at 17 minutes past the hour, generates updated `index.html`, and deploys it to Pages. It also runs after relevant pushes.
