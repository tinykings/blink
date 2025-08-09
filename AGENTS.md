# Repository Guidelines

## Project Structure & Module Organization
- `scripts/`: Python builder (`fetch_feeds.py`) that normalizes `feeds.txt` and generates `index.html` from `index.template.html`.
- `js/`: Front‑end logic (`main.js`) for starring, filtering, lazy YouTube embeds, and PWA registration.
- `css/`: Styles (`style.css`).
- Root assets: `index.html` (built), `index.template.html`, `feeds.txt`, `manifest.json`, `sw.js`, `images/`.
- CI: `.github/workflows/main.yml` schedules hourly feed rebuilds and commits changes.

## Build, Test, and Development Commands
- Install deps: `pip install feedparser beautifulsoup4 lxml requests pytz`.
- Build locally: `python3 scripts/fetch_feeds.py` (updates `index.html`, rewrites `feeds.txt` with normalized YouTube RSS).
- Serve locally: `python3 -m http.server 8000` then open `http://localhost:8000/index.html`.
- Trigger CI manually: push to default branch; action will rebuild and push if content changed.

## Coding Style & Naming Conventions
- Python: PEP 8, 4‑space indent, type hints where practical; prefer `logging` over `print`. Keep functions small and pure; isolate I/O.
- JavaScript: ES6+, semicolons, single quotes, early returns; avoid global leaks. Keep DOM selectors stable (e.g., `.feed-item`, `data-item-id`).
- Naming: Python files/use snake_case; web assets lower‑kebab or simple lowercase (`main.js`, `style.css`).

## Testing Guidelines
- No formal test suite yet. Validate locally after changes:
  - Run builder, open `index.html`, check console for errors.
  - Verify: starring persists, “^ New ^” divider appears, YouTube lazy‑load works, and footer timestamp matches timezone/retention.
- If adding parsing logic, prefer small helper functions with deterministic inputs that are easy to unit test later.

## Commit & Pull Request Guidelines
- Commits: concise, imperative mood (e.g., `scripts: normalize YouTube URLs`, `css: tweak card spacing`). Many existing commits are short (e.g., “Update feeds”).
- PRs: include a clear description, motivation, before/after screenshots for UI changes, and note config changes (e.g., TIMEZONE, retention days). Link related issues.

## Security & Configuration Tips
- Network calls use a generic `USER_AGENT` and timeouts; avoid embedding secrets—none are required.
- If hosting under a sub‑path, ensure `manifest.json` `start_url/scope` and Service Worker path in `js/main.js` match your deployment.
