# blink

blink is a Python-powered RSS and YouTube feed aggregator focused on speed and simplicity. It fetches and parses RSS and YouTube channel feeds, then generates an HTML index that highlights today’s items, with expandable sections for the previous four days. This design keeps your daily reading fast and clutter-free.

## Features

- **RSS & YouTube Support:** Add any RSS feed or YouTube channel; YouTube channels are automatically converted to RSS.
- **Daily Focus:** Only today’s items are shown by default; previous days are hidden but easily expandable.
- **Fast Loading:** By limiting the initial display to today’s items, page loads are quick even with many feeds.
- **Simple Web Interface:** Clean, readable HTML output for easy browsing.

## How It Works

1. **Feed List:**  
   Add your RSS and YouTube channel URLs to `feeds.txt`, using `#rss` and `#youtube` sections.

2. **Fetching & Parsing:**  
   Run the main script (`fetch_feeds.py`).  
   - YouTube channel URLs are converted to RSS feed URLs automatically.
   - All feeds are fetched and parsed.
   - Items are grouped by date (using your configured timezone).

3. **HTML Generation:**  
   - Only today’s items are shown at first.
   - Each of the previous four days appears as a collapsible section at the bottom.
   - Clicking a day expands to show its items.

## Self-Hosting on GitHub Pages (Automated with GitHub Actions)

You can host your .blink feed on GitHub Pages and automate the feed fetching and HTML generation using GitHub Actions.

### 1. Prepare Your Repository

- Push your project to a GitHub repository.
- Update your feeds.txt

### 2. Add a GitHub Actions Workflow

File `.github/workflows/blink.yml` change for desired refresh interval.


### 3. Enable GitHub Pages

- Go to your repository’s **Settings > Pages**.
- Set the source branch to `gh-pages` and the folder to `/ (root)`.

### 4. Access Your Feed

After the workflow runs, your latest `index.html` will be available at:

```
https://<your-username>.github.io/<your-repo>/
```

### Notes

- You can also trigger it manually from the Actions tab.
- Make sure your script outputs `index.html` and any assets (CSS/JS) to the repository root or the correct publish directory.

---

## File Structure

- `feeds.txt` — Your list of RSS and YouTube feeds.
- `yt.log` — Log of YouTube channel IDs and names.
- `index.html` — The generated feed page.
- `scripts/fetch_feeds.py` — Main script for fetching and generating the feed.
- `js/main.js` — Handles expand/collapse for previous days and summaries.
- `css/style.css` — Styles for the HTML output.
