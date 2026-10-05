// Saves the pre-game forecast of every upcoming Liiga regular-season game, so its accuracy can be measured
// honestly later (forecasts made before the game, not recomputed afterwards). Run by
// .github/workflows/forecast-snapshot.yml every hour; usage: node scripts/forecast-snapshot.mjs <file.json>
// A game's forecast is refreshed on every run until puck drop (new results change it) and frozen after that.
import fs from 'node:fs';
import vm from 'node:vm';

const API = 'https://liiga.fi/api/v2', TOURNAMENT = 'runkosarja', WINDOW_H = 36;
const file = process.argv[2] || 'forecasts.json';
const now = new Date();
const SEASON = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();   // season = year it ends

// The site's own model code, run as is with the two helpers it needs
const ctx = vm.createContext({
  teamNum: key => Number(String(key || '').split(':')[0]),
  poisson: (l, k) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; },
});
vm.runInContext(fs.readFileSync(new URL('../forecast.js', import.meta.url), 'utf8') + '\n;globalThis.__fc = { fcReplay };', ctx);
const { fcReplay } = ctx.__fc;

const get = async path => { const r = await fetch(API + path); if (!r.ok) throw new Error(`${r.status} ${path}`); return r.json(); };
const [prev, cur] = await Promise.all([SEASON - 1, SEASON].map(y => get(`/schedule?tournament=${TOURNAMENT}&season=${y}`)));

const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8') || '{}') : {};
const saved = store[SEASON] || (store[SEASON] = {});
const r4 = x => Math.round(x * 1e4) / 1e4, r2 = x => Math.round(x * 100) / 100;
let n = 0;
for (const g of cur) {
  const t = new Date(g.start);
  if (g.started || g.ended || t <= now || t - now > WINDOW_H * 3600e3) continue;
  const r = fcReplay(prev, cur.filter(x => x.start < g.start));
  if (!r) continue;
  const p = r.predict(ctx.teamNum(g.homeTeamId), ctx.teamNum(g.awayTeamId));
  const rec = { s: g.start, h: g.homeTeamName, a: g.awayTeamName, H: r4(p.H), T: r4(p.T), A: r4(p.A), lh: r2(p.lh), la: r2(p.la) };
  const old = saved[g.id];
  if (!old || old.H !== rec.H || old.T !== rec.T || old.A !== rec.A) { saved[g.id] = { ...rec, at: now.toISOString() }; n++; }
}
fs.writeFileSync(file, JSON.stringify(store));
console.log(`Season ${SEASON}: ${n} forecasts saved or updated, ${Object.keys(saved).length} in total.`);
