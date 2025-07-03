# RSS Feed Project

This project fetches items from a list of RSS feeds and displays them on a static HTML page. The feeds are updated automatically using GitHub Actions.

## How it works

1.  **`feeds.txt`**: A list of RSS feed URLs is maintained in this file, with one URL per line.
2.  **`scripts/fetch_feeds.py`**: A Python script reads the URLs from `feeds.txt`, fetches the feed items, sorts them by date, and injects them directly into `index.html`.
3.  **`index.html`**: This is the main page that displays the feed items.
4.  **`.github/workflows/main.yml`**: A GitHub Actions workflow runs the `fetch_feeds.py` script on a schedule to keep the feeds up-to-date.

## Usage

1.  Add your desired RSS feed URLs to `feeds.txt`, one URL per line.
2.  Push the changes to your GitHub repository.
3.  The GitHub Actions workflow will automatically update the `index.html` file.
4.  Open `index.html` in your browser to view the feeds.
