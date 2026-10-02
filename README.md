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
  - **Ottelu (Report):** deserved result, game flow, goals with video links, shot map with filters, Game MVP based on game score, goalie GSAx, bonus stats, period selector, full lineup.
  - **Live:** shown from 10 minutes before puck drop while a SaiPa game is on. Refreshes itself (15 s, 60 s in intermissions): score header with power plays, intermission clock and an event history, win probability, xG, pressure, best player, goalie, periods table, ice time, and the parts of the report that are useful during a game. Optional: delete `live.js` and its script tag to remove it.
  - Test mode for the live view: `?game=GAME_ID&tab=live&replay=1` replays a played game with a time slider.
  - Deep link: `?game=GAME_ID&tab=preview|report|live`.
- **Kausi (Season)** (`?view=season&tab=overview|players|goalies|team|league`): season highlights, luck meter (xG/60 vs. goals/60), skater and goalie tables, season trend, streaks and form, lines and pairs, league speed and shot lists, deserved standings (expected points), splits by period and game state, team shot profile against the league, goalie maps.
- **Historia (History)** (`?view=history`): this day in SaiPa history, all-time top lists, attendance by season and this season.
- **Pelaaja (Player):** opened by clicking a name (`?player=PLAYER_ID`). Skaters: season numbers, game score per game, league percentiles, personal shot map, game log. Goalies: cumulative GSAx, league comparison, periods, conceded-goals map, game log.
- **Mittarit (Metrics)** (`?view=metrics`): how every number is computed, and an abbreviation glossary.

## Data files

`data/saipa-alltime.js` holds SaiPa's all-time totals for completed seasons (generated from the liiga.fi API, see the file header). Everything else is fetched live.

## Configuration

All in `app.js`:
- `W`: game score weights
- `SEASON`: season (2027 = 2026–27)
- `MIN_TOI_MAX`, `MIN_TOI_PER_GAME`: minimum ice time for season lists

## Data

All data comes from the liiga.fi API (unofficial and undocumented, may change without notice). This is an unofficial fan site with no affiliation to Liiga or SaiPa.

## Publishing

Pushing to `main` publishes the site with GitHub Actions (`.github/workflows/pages.yml`). The workflow stamps the commit id into the `?v=` of every script and stylesheet so browsers never mix cached old files with new ones. One-time setup: repository Settings → Pages → Source: GitHub Actions.
