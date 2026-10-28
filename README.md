# My Teams — Stremio addon

Adds a **My Teams** row to Stremio with one tile per team. Click a team to see:

- 🔴 live games with the current score and clock (refreshed every 30 seconds)
- the last 5 results (W/L/D with score) and the next 5 games, in your time zone
- for each game: **Search Stremio** buttons, which search all your installed addons
  (including Sport Streams), plus the ESPN game page and the official broadcasters

Data comes from ESPN's free public API. No account or API key is needed.

## Change your teams

Edit `teams.js`. It has instructions for finding a team's league and id.

## Run on your computer

Requires Node.js 18 or newer.

```bash
npm start
```

Then in Stremio, open **Addons**, paste `http://127.0.0.1:7000/manifest.json` into the search box, and install it.

## Deploy for free on Render (works on TV and phone)

1. Create a free account at https://github.com and make a new repository, e.g. `my-teams-addon`.
   Choose **uploading an existing file**, drag in `server.js`, `teams.js`, `package.json`, `README.md`, and commit.
2. Create a free account at https://render.com, click **New → Web Service**, and connect that repository.
3. Use these settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
   - Optional environment variable `TIMEZONE` (default `America/Chicago`), e.g. `America/New_York`
4. When it's live, open the URL Render gives you (e.g. `https://my-teams-addon.onrender.com`)
   and click **Install in Stremio**, or paste `https://<your-app>.onrender.com/manifest.json`
   into Stremio's addon search box.

Because the addon is installed under your Stremio account, it shows up on every device you sign in to.

**Note:** Render's free tier sleeps after about 15 minutes without requests, so the first
open after a while can take 30–60 seconds to load. Later opens are fast.

## Notes

- Live scores update when you open or reopen a team page. Stremio doesn't auto-refresh an open page.
- Manchester United shows Premier League games only (not cups or Europe).

---

This repository also contains **[Data Removal](data-removal/README.md)**, a separate,
self-hosted app for removing your personal information from people-search sites and data brokers.
