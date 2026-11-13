# SaiPa Data

A SaiPa-focused hockey analytics site built on liiga.fi data. It is a static site: data is fetched in the browser directly from the liiga.fi API, so no server is needed.

The site UI is in Finnish.

## Run locally

Open `index.html` in a browser.

If the browser blocks data loading from a local file, start a local web server in this folder and open http://localhost:8000:

```
python3 -m http.server 8000
```

## Views

- **Ottelu (Game):** pick any SaiPa game, including the next one. Each game has these sub-views:
  - **Ennakko (Preview):** team comparison with league ranks, form, period profiles, forecast with backtest, key matchups, net-front comparison, lineups, hot/cold players, goaltending and head-to-head history. For played games it is rebuilt from the data that existed before the game.
  - **Ottelu (Report):** deserved result, game flow, goals with video links, shot map with filters, Game MVP based on game score, goalie GSAx, team metrics side by side incl. own-model xG (with each team's season average and league rank on hover), bonus stats, period selector, full lineup.
- **Live** (`?view=live`, `?view=live&id=ID`): every Liiga game of the day (or the next game day) with score and clock; a game opens from 10 minutes before puck drop with the same live view as SaiPa's games. Other teams' games are shown neutrally: both teams' win probability, xG, best player and goalies side by side, no good/bad colouring. SaiPa's games open in the game view's Live tab from SaiPa's point of view, with the opponent's best player and goalie in the hovers. In both, ice time and the report's player cards and tables (stars, bonus stats, skaters, goalies) have a team switch. Team colours (`TEAM_COLORS` / `pairColors()` in app.js; the away team falls back to its second colour when the two are too close) mark the teams in the tiles, the pressure bars and the win-probability chart, whose area above 50 % is the focus team's colour and below the other team's.
  - **Live:** shown from 10 minutes before puck drop while a SaiPa game is on. Refreshes itself (15 s; 30 s in intermissions until three minutes before the estimated restart): score header with power plays, intermission clock and an event history, win probability, xG, pressure, best player, goalie, periods table, ice time, team metrics side by side, and the parts of the report that are useful during a game. Optional: delete `live.js` and its script tag to remove it.
  - Test mode for the live view: `?game=GAME_ID&tab=live&replay=1` replays a played game with a time slider.
  - Deep link: `?game=GAME_ID&tab=preview|report|live`.
- **Kausi (Season)** (`?view=season&tab=overview|players|goalies|team|league`): season highlights, team metrics with league ranks (whole season or SaiPa's last 20/10/5 games), hottest players and goalies of each calendar month across the league (SaiPa highlighted), luck meter (xG/60 vs. goals/60), skater and goalie tables, SaiPa goalies side by side over each goalie's own last 1–30 games in liiga.fi's format with league ranks and a per-game toggle (a compact version in the preview), season trend, streaks and form, home attendance scenarios against the 3 700 target (selectable comparison seasons), lines and pairs (exact on-ice goals), lineup editor (expected goal differential of edited lines and pairs), season forecast (simulated table with a what-if for SaiPa's next games and a date picker), league speed and shot lists, expected goals by game situation for every team (score state, manpower, game phase, score- and venue-adjusted 5v5 xG% and CF%), deserved standings (expected points), splits by period and game state, team shot profile against the league (NHL EDGE zones in metres), rebounds and quick attacks for and against with SaiPa players' rebound, rush and off-wing shots, goalie maps and rebound control (RB/100).
- **Historia (History)** (`?view=history`): this day in SaiPa history, all-time top lists, expected goals by season for SaiPa and the whole league from 2015–16 with the site's own xG model, attendance by season and this season.
  - `?view=history&date=YYYY-MM-DD` shows "this day in history" as if it were that day (not linked from the UI).
- **Pelaaja (Player):** opened by clicking a name (`?player=PLAYER_ID`). Skaters: season numbers, game score per game, league percentiles, personal shot map, game log. Goalies: cumulative GSAx, league comparison, periods, conceded-goals map, game log.
- **Mittarit (Metrics)** (`?view=metrics`): how every number is computed, and an abbreviation glossary.

## Data files

`data/saipa-alltime.js` holds SaiPa's all-time totals for completed seasons (generated from the liiga.fi API, see the file header). `data/xg-history.js` holds every team's own-model xG by season 2015–16 to 2025–26. `xgmodel.js` is the own xG model (coefficients and the per-shot function). Everything else is fetched live.

## Configuration

All in `app.js`:
- `W`: game score weights
- `SEASON`: season (2027 = 2026–27)
- `MIN_TOI_MAX`, `MIN_TOI_PER_GAME`: minimum ice time for season lists

## Data

All data comes from the liiga.fi API (unofficial and undocumented, may change without notice). This is an unofficial fan site with no affiliation to Liiga or SaiPa.

## Publishing

Pushing to `main` publishes the site with GitHub Actions (`.github/workflows/pages.yml`). The workflow stamps the commit id into the `?v=` of every script and stylesheet so browsers never mix cached old files with new ones. One-time setup: repository Settings → Pages → Source: GitHub Actions.

Forecast tracking: `.github/workflows/forecast-snapshot.yml` runs every hour and saves the pre-game forecast of each upcoming game (`scripts/forecast-snapshot.mjs`, using the site's own `forecast.js`). The saved file lives on the `forecasts` branch, so the automatic saves never touch `main`; the publish workflow copies it to `data/forecasts.json`. The Mittarit page compares the saved forecasts with the results.
