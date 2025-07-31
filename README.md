# ✨ Blink: A Lightning-Fast Feed Aggregator

Blink is a minimalist, Python-powered aggregator for your favorite RSS and YouTube feeds. It's designed for speed and simplicity, generating a clean, single-page HTML file that puts **today's content** front and center.

Tired of cluttered feed readers? Blink keeps your daily reading fast and focused. Past updates are neatly tucked away in collapsible sections, ensuring your view is always clean and loads instantly.

![GitHub Actions Workflow](https://github.com/user/repo/actions/workflows/main.yml/badge.svg) <!-- Replace with your actual badge URL -->

## Key Features

-   **📰 Unified Feed:** Combines RSS and YouTube channels into a single, streamlined view.
-   **📺 Smart YouTube Integration:** Automatically converts YouTube channel URLs into RSS feeds—no more hunting for hidden feed links!
-   **🗓️ Focus on Today:** The main view only shows items from the last 24 hours. Older content is collapsed into expandable sections for the previous four days.
-   **⚡ Blazing Fast:** By generating a static HTML file and prioritizing today's content, Blink loads instantly, even with hundreds of feeds.
-   **🎨 Clean & Simple UI:** A minimalist, readable interface with expandable summaries and embedded YouTube video previews.
-   **📱 Progressive Web App (PWA):** Install Blink on your desktop or mobile device for an app-like experience, complete with an icon and offline access.
-   **🚀 Automated & Self-Hosted:** Deploy your personalized feed to GitHub Pages for free and keep it updated automatically with the included GitHub Actions workflow.

## How It Works

1.  **📝 Add Your Feeds:**  
    Populate the `feeds.txt` file with your favorite RSS and YouTube channel URLs, organized under the `#rss` and `#youtube` sections.

2.  **⚙️ Fetch & Process:**  
    Run the main Python script: `python3 scripts/fetch_feeds.py`.
    - It automatically converts YouTube URLs to their corresponding RSS feeds.
    - It fetches content from all sources and groups items by date (based on your configured timezone).

3.  **📄 Generate the Page:**  
    The script injects the fresh content into the `index.template.html` and generates the final `index.html`, ready for viewing.

## Self-Hosting on GitHub Pages (with Automation)

Host your personal Blink feed on GitHub Pages and let GitHub Actions keep it updated automatically.

### 1. Prepare Your Repository

-   Push your project to a new GitHub repository.
-   Customize `feeds.txt` with your desired sources.

### 2. Enable GitHub Pages

-   In your repository, go to **Settings > Pages**.
-   Under "Build and deployment," set the **Source** to **GitHub Actions**. The workflow included in `.github/workflows/main.yml` will handle the rest.

### 3. Access Your Feed

After the workflow runs for the first time, your feed will be live at:
`https://<your-username>.github.io/<your-repo-name>/`

The workflow is configured to run on a schedule (e.g., every 6 hours) and can also be triggered manually from the **Actions** tab in your repository.

