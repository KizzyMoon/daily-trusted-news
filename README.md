# Daily Trusted News Web App

A mobile-first static web app for a calm daily briefing from trusted public news feeds. It is built with plain HTML, CSS, and JavaScript so it can be hosted on GitHub Pages and added to an iPhone Home Screen.

## What It Does

- Shows a daily briefing across Top Stories, World, UK, Science & Tech, Health, and Business / Economy.
- Uses public RSS or Atom feeds from BBC, The Guardian, NPR, Al Jazeera English, and WHO.
- Uses GitHub Actions to generate a static `news.json` file, avoiding most browser RSS/CORS problems on GitHub Pages.
- Ranks stories higher when they appear across multiple trusted sources or contain major-news keywords.
- Deduplicates similar headlines into one story group.
- Shows source transparency, including "Also reported by" when related stories are grouped.
- Lets you mark stories as read and hide them.
- Includes a refresh button, loading state, last updated time, and feed error messages.
- Installs as a lightweight PWA on iPhone and caches the app shell for reopening.

## Files

- `index.html` - App structure and PWA meta tags.
- `styles.css` - Mobile-first dark interface.
- `app.js` - Feed loading, ranking, deduplication, read state, and rendering.
- `manifest.webmanifest` - PWA manifest.
- `service-worker.js` - Offline app shell cache.
- `icon.svg` - App icon.
- `scripts/update-news.mjs` - GitHub-side RSS fetcher and briefing generator.
- `.github/workflows/update-news.yml` - Scheduled GitHub Action that refreshes `news.json`.
- `.nojekyll` - Keeps GitHub Pages serving files directly.

## Run Locally

You can open `index.html` directly in a browser, but service workers and some browser features work best from a local server.

With Python installed:

```powershell
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Publish To GitHub Pages

1. Create a new GitHub repository.
2. Upload these web app files and folders to the repository root:
   - `.github/workflows/update-news.yml`
   - `.gitignore`
   - `.nojekyll`
   - `app.js`
   - `icon.svg`
   - `index.html`
   - `manifest.webmanifest`
   - `README.md`
   - `scripts/update-news.mjs`
   - `service-worker.js`
   - `styles.css`
3. In GitHub, open the repository settings.
4. Go to `Pages`.
5. Under `Build and deployment`, choose `Deploy from a branch`.
6. Select the `main` branch and `/root`.
7. Save.
8. Open the GitHub Pages URL when deployment finishes.

## Turn On Automatic News Refresh

The included GitHub Action runs at about 06:15, 12:15, and 18:15 UTC each day, plus whenever you trigger it manually.

1. Push this project to GitHub.
2. Open the repository on GitHub.
3. Go to `Actions`.
4. If GitHub asks you to enable workflows, approve it.
5. Open `Update News Briefing`.
6. Click `Run workflow`.

That first run creates `news.json`. After that, the app loads `news.json` directly from GitHub Pages. If `news.json` is missing, the app still tries live RSS in the browser as a fallback.

The manifest uses relative paths, so it works both at a root domain and at a project URL like:

```text
https://your-username.github.io/your-repo-name/
```

## Add To iPhone Home Screen

1. Open the GitHub Pages URL in Safari on your iPhone.
2. Tap the Share button.
3. Tap `Add to Home Screen`.
4. Confirm the name `Daily Brief`.

When opened from the Home Screen, it should feel like a simple standalone app.

## RSS And CORS Notes

Static GitHub Pages sites cannot add server-side CORS headers. The primary path is therefore:

1. GitHub Actions fetches RSS feeds from GitHub's servers.
2. The action writes `news.json`.
3. GitHub Pages serves `news.json` to the app.

If `news.json` is missing, the browser fallback tries:

1. Direct feed fetch.
2. AllOrigins public CORS fallback.
3. CodeTabs public CORS fallback.

If a publisher or public fallback blocks a feed, the app keeps working with the feeds that loaded and shows an error message. For maximum reliability later, add a tiny serverless RSS proxy with Cloudflare Workers, Netlify Functions, or GitHub Actions that periodically writes a static `news.json` file.

Reuters and AP are not included by default because their freely accessible RSS options are inconsistent and may not be reliable from a static browser app. They can be added in `app.js` if you confirm stable public feed URLs.

## Customise Sources

Edit the `FEEDS` array in `app.js`. Each source needs:

```js
{ source: "Source Name", category: "world", url: "https://example.com/feed.xml" }
```

Supported categories are:

- `world`
- `uk`
- `science-tech`
- `health`
- `business`

## Important Limitation

This is not an editorial newsroom or an AI fact-checker. It is a transparent briefing interface over selected reputable public feeds. Always click through to the original reporting for full context.
