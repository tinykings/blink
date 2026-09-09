# Blink

<p align="center">
  <img src="images/icon-192.png" alt="Blink Logo" width="120" />
</p>

<h3 align="center">A minimal RSS reader hosted on GitHub Pages.</h3>
<h4 align="center">https://tinykings.github.io/blink/</h4>

---

Blink is a client-side RSS reader that runs entirely in the browser. Fork it, add your feeds, enable GitHub Pages, and you have a personal feed reader that refreshes on demand — no server required.

**Note:** A GitHub Gist is required to use Blink. Your Gist stores unread items, read state, and stars across devices.

## Features

- **RSS & YouTube** — Add, edit, copy, and remove subscriptions from Blink. YouTube channel URLs are automatically converted to RSS feeds.
- **Starred items** — Star items to save them permanently. Recent unstarred items are pruned after a configurable number of days.
- **Gist sync** — Sync starred items across devices using a private GitHub Gist.
- **Read-state controls** — Mark all new items read from the feed, or refresh feeds independently from the footer.
- **Keyboard navigation** — Browse and interact without leaving the keyboard.
- **PWA** — Installable as a Progressive Web App with offline support via Service Worker.
- **Dark/light mode** — Follows system preference.

## Quick Start

1. **Fork** this repository.
2. Edit `feeds.txt` to add initial RSS feeds and YouTube channels (see [Configuration](#configuration) below).
3. Go to **Settings → Pages** in your fork and set the source to **GitHub Actions**.
4. Add repository variable `GIST_AUTH_URL` with shared OAuth Worker URL.
5. Use the refresh button in Blink to fetch your feeds and deploy the updated site.

Your reader will be live at `https://<your-username>.github.io/blink/`.

## Setup

On first visit, select **Connect GitHub** and authorize Gist access. Blink finds your app Gist or creates private Gist automatically.

Blink loads read state and stars from `blink-data.json` on startup and merges changes on tab focus and network reconnect. Every save fetches and merges remote state first. Read and star changes have separate timestamps so starring does not mark an item read.

The view button switches between **Unread** and **All**, not a read-only archive. Each item shows its read status and a read/unread button. Opening a link or playing a video does not mark it read. **Mark all N unread items as read** includes items you have not scrolled to. An undo button restores those read states during the current session, without undoing later read changes or star changes.

## Configuration

### feeds.txt

Use the Feeds button beside the seen/unseen control to manage subscriptions in Blink. Saving commits `feeds.txt` through GitHub. Use the footer refresh button when you want to fetch subscriptions and reload the reader. You can also edit `feeds.txt` directly. Add RSS feeds under `#rss` and YouTube channels under `#youtube`. Comments starting with `#` (other than the section headers) are used as channel labels.

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

The feed fetcher includes items from the last 5 days by default. To change this window, set `ITEMS_RETENTION_DAYS` in `scripts/fetch_feeds.py`.

Once Blink loads an item, it saves unread content in `blink-data.json`. Unread items survive later refreshes even if a feed fails, removes an entry, or ages it out of the fetch window. Items merge by ID, newest publication first. Refresh saves the backlog before fetching and will not reload if saving fails.

Marking an item read removes its saved content on the next save, unless it is starred. Compact read markers remain so older tabs cannot restore those items as unread. Starred content stays indefinitely. Bulk undo can restore content from the current tab.

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

Local development bypasses GitHub OAuth and Gist sync. Read state stays in browser storage; feed changes write directly to local `feeds.txt`.

```bash
git clone https://github.com/<your-username>/blink.git
cd blink
pip install -r requirements.txt
python scripts/fetch_feeds.py   # initial index.html
python scripts/dev_server.py    # http://127.0.0.1:8000
```

Use `scripts/dev_server.py`, not `python -m http.server`, when testing feed management. **Save** writes `feeds.txt`; the footer refresh button runs `scripts/fetch_feeds.py` and reloads Blink.

`js/config.local.js` is not needed. Localhost always uses local development mode; deployed Pages builds inject GitHub configuration during deployment.

## How It Works

`scripts/fetch_feeds.py` reads `feeds.txt`, fetches all feeds in parallel, and embeds the results as JSON in `index.html`. The browser-side JavaScript reads this data and renders the UI. There is no backend — everything runs at build time via GitHub Actions and then client-side in the browser.

The GitHub Actions workflow (`.github/workflows/main.yml`) runs on demand from the footer refresh button, generates the updated `index.html`, and deploys it to Pages.
