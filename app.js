/* SaiPa Data: SaiPa-focused analytics built on liiga.fi data.
 * All data is fetched in the browser directly from the liiga.fi API (CORS is open). */

const API = 'https://liiga.fi/api/v2';
const SEASON = 2027;                 // season 2026–27
const TOURNAMENT = 'runkosarja';
const SAIPA = '933686567';           // numeric part of SaiPa's teamId
const MIN_TOI_MAX = 60 * 60;         // minimum ice time (s) for season lists, full threshold
const MIN_TOI_PER_GAME = 8 * 60;     // early season: threshold = 8 min × games played
let MIN_TOI_SEASON = MIN_TOI_MAX;
let SEASON_SK = [];                   // season skaters (for cards that load later)

// Game score weights. Tune the metric here.
const W = {
  goal: 0.75, a1: 0.70, a2: 0.55,
  shot: 0.075, ixg: 0.5,
  corsi: 0.05, evGoal: 0.15,
  block: 0.05,
  foWon: 0.01, foLost: -0.01, minor: -0.15,
  gsax: 0.75, save: 0.02,
};

// Weight as Finnish decimal for the component formulas shown in hovers
const wf = x => String(x).replace('.', ',');
const COMPONENTS = [
  { key: 'tulos', label: 'Tulos', d: 'maalit, syötöt', tip: `${wf(W.goal)} × G + ${wf(W.a1)} × A1 + ${wf(W.a2)} × A2`, color: 'var(--c-tulos)' },
  { key: 'tuotanto', label: 'Tuotanto', d: 'laukaukset, xG', tip: `${wf(W.shot)} × SOG + ${wf(W.ixg)} × xG`, color: 'var(--c-tuotanto)' },
  { key: 'hallinta', label: 'Hallinta', d: 'Corsi, maaliero kentällä', tip: `${wf(W.corsi)} × (CF − CA) + ${wf(W.evGoal)} × (GF − GA)`, color: 'var(--c-hallinta)' },
  { key: 'puolustus', label: 'Puolustus', d: 'blokit', tip: `${wf(W.block)} × BLK`, color: 'var(--c-puolustus)' },
  { key: 'muut', label: 'Muut', d: 'aloitukset, jäähyt', tip: `${wf(W.foWon)} × FOW − ${wf(-W.foLost)} × (FO − FOW) − ${wf(-W.minor)} × PIM / 2`, color: 'var(--c-muut)' },
];

/* ---------- helpers ---------- */
// Address parameters are in English. Old Finnish links (?peli, ?osio, ?nakyma, ?pelaaja) still open.
const URL_TAB = { ennakko: 'preview', ottelu: 'report', live: 'live', yleis: 'overview', pelaajat: 'players', mv: 'goalies', joukkue: 'team', liiga: 'league' };
const TAB_FI = Object.fromEntries(Object.entries(URL_TAB).map(([k, v]) => [v, k]));
const URL_VIEW = { kausi: 'season', historia: 'history', info: 'metrics', live: 'live' };
const VIEW_FI = { season: 'kausi', history: 'historia', metrics: 'info', kausi: 'kausi', historia: 'historia', mittarit: 'info', live: 'live' };
function urlState() {
  const q = new URLSearchParams(location.search);
  const tab = q.get('tab') || q.get('osio');
  return { id: q.get('id'), game: q.get('game') || q.get('peli'), player: q.get('player') || q.get('pelaaja'),
    view: VIEW_FI[q.get('view') || q.get('nakyma')] || 'ottelu', tab: tab ? (TAB_FI[tab] || tab) : null };
}
// Position codes in English (NHL style) for the stat tables
const POS_EN = { VL: 'LW', OL: 'RW', KH: 'C', H: 'F', P: 'D', VP: 'LD', OP: 'RD', MV: 'G' };
const posEn = r => String(r || '').replace(/\b(VL|OL|KH|VP|OP|MV|H|P)\b/, m => POS_EN[m]);
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 1) => (n == null || !isFinite(n)) ? '–' : n.toLocaleString('fi-FI', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n, d = 1) => (n == null || !isFinite(n)) ? '–' : (n > 0 ? '+' : '') + num(n, d);
const pct = (n, d = 1) => (n == null || !isFinite(n)) ? '–' : num(n * 100, d) + ' %';
const mmss = s => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const kmh = ms => ms ? num(ms * 3.6, 1) + ' km/h' : '–';
const isSaipa = teamId => String(teamId || '').startsWith(SAIPA);
const fiDate = iso => new Date(iso).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', timeZone: 'Europe/Helsinki' });
const cls = n => n > 0.0001 ? 'pos-num' : n < -0.0001 ? 'neg-num' : '';

// Runs fn once, when the first of the elements comes into view (hidden tabs count once they are shown).
// Heavy league-wide data is fetched only for the cards a viewer actually opens.
function whenVisible(els, fn) {
  els = (Array.isArray(els) ? els : [els]).filter(Boolean);
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '300px' });
  els.forEach(el => io.observe(el));
}
const cache = new Map();
async function getJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(API + path).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return r.json();
    }).then(j => path.includes('/shotmap/') ? fixShotmap(path, j) : j));
  }
  return cache.get(path);
}
// The league's shot map sometimes lists shots twice (seen in KalPa–SaiPa 2.10.2026: 186 rows for 94 shots).
// The extra copy always has xg = null. A row is dropped only when it has no xg AND
//  - another row with xg has the same period, second, team, shooter, coordinates and event type, or
//  - it is a goal and the same team already has a goal with xg at that same second (copy with a wrong shooter).
// Real shots never match these (one shooter cannot shoot twice from the same spot in the same second), and
// in 2025–26 and the rest of 2026–27 no row is removed. The copy's blockerId fills in a missing one.
// Shot map rows for a game, cleaned and with goal scorers matched to the official goal events
async function fixShotmap(path, sm) {
  const clean = cleanShotmap(sm);
  const [, season, id] = path.match(/\/shotmap\/(\d+)\/(\d+)/) || [];
  const g = id ? await getJSON(`/games/${season}/${id}`).catch(() => null) : null;
  return shotContext(g ? shotmapScorers(clean, g) : clean, g);
}
// Context for every shot of one game, used by season stats, previews and player pages:
//  reb  = rebound: the same team's saved shot at most REB_S seconds earlier in the same period
//  rebAllowed (on that saved shot) = the save gave the rebound
//  rush = quick attack: at most RUSH_S seconds after the opponent's attempt in the same period, with no own
//         attempt between; not a rebound and not right after the opponent's goal (faceoff at centre)
//  hand = shooter's stick hand 'L' / 'R' from the game roster
const REB_S = 3, RUSH_S = 10;
function shotContext(sm, g) {
  if (!Array.isArray(sm)) return sm;
  const hand = new Map([...(g?.homeTeamPlayers || []), ...(g?.awayTeamPlayers || [])].filter(p => p.handedness).map(p => [p.id, p.handedness[0]]));
  const seq = [...sm].sort((x, y) => x.gameTime - y.gameTime);
  seq.forEach((s, i) => {
    s.hand = hand.get(s.shooterId) || null; s.reb = false; s.rush = false;
    let src = null;
    for (let j = i - 1; j >= 0 && s.gameTime - seq[j].gameTime <= REB_S; j--) {
      const p = seq[j];
      if (p.period === s.period && p.shootingTeamId === s.shootingTeamId && p.eventType === 'GOALIE_BLOCKED') { src = p; break; }
    }
    if (src) { s.reb = true; src.rebAllowed = true; return; }
    const prev = seq[i - 1];
    s.rush = !!prev && prev.period === s.period && prev.shootingTeamId !== s.shootingTeamId && prev.eventType !== 'GOAL' && s.gameTime - prev.gameTime <= RUSH_S;
  });
  return sm;
}
// The shot map keeps the original shooter when the league later changes the scorer (e.g. a tip, seen in
// SaiPa–Ässät 23.9.2026: map Fridrich, official Tauslahti). Each goal row takes the scorer of the official goal
// by the same team within 5 seconds; each official goal is used once. The shot's location is kept as it is.
function shotmapScorers(sm, g) {
  if (!Array.isArray(sm) || !g?.game) return sm;
  const ev = [g.game.homeTeam, g.game.awayTeam].flatMap(t => (t.goalEvents || [])
    .filter(e => !e.cancelled && e.scorerPlayerId)
    .map(e => ({ team: Number(String(t.teamId).split(':')[0]), t: e.gameTime, id: e.scorerPlayerId, used: false })));
  // Names for the correction note: the shooter the league's map had
  const nameOf = new Map([...(g.homeTeamPlayers || []), ...(g.awayTeamPlayers || [])].map(p => [p.id, `${p.firstName} ${p.lastName}`]));
  for (const s of sm.filter(x => x.eventType === 'GOAL')) {
    const e = ev.filter(x => !x.used && x.team === s.shootingTeamId && Math.abs(x.t - s.gameTime) <= 5)
      .sort((a, b) => Math.abs(a.t - s.gameTime) - Math.abs(b.t - s.gameTime))[0];
    if (!e) continue;
    e.used = true;
    if (s.shooterId !== e.id) { s.mapShooterId = s.shooterId; s.mapShooter = nameOf.get(s.shooterId) || null; s.shooterId = e.id; }
  }
  return sm;
}
function cleanShotmap(sm) {
  if (!Array.isArray(sm)) return sm;
  const key = s => [s.period, s.gameTime, s.shootingTeamId, s.shooterId, s.shotX, s.shotY, s.eventType, s.type].join('|');
  const goalKey = s => [s.period, s.gameTime, s.shootingTeamId].join('|');
  const byKey = new Map(), goals = new Set();
  for (const s of sm) if (s.xg != null) { byKey.set(key(s), s); if (s.eventType === 'GOAL') goals.add(goalKey(s)); }
  return sm.filter(s => {
    if (s.xg != null) return true;
    const twin = byKey.get(key(s));
    if (twin) { if (!twin.blockerId && s.blockerId) twin.blockerId = s.blockerId; return false; }
    return !(s.eventType === 'GOAL' && goals.has(goalKey(s)));
  });
}

/* ---------- hover tooltips ----------
 * Every element with a data-tip attribute, an SVG <title> child or a title attribute gets a styled tooltip.
 * Line breaks in the text ("\n") become separate lines. Touch shows the tooltip on tap. */
const tipEl = document.createElement('div');
tipEl.className = 'tip';
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(tipEl));
function tipTarget(el) {
  for (let n = el; n && n !== document; n = n.parentNode) {
    if (!n.getAttribute) continue;
    if (n.hasAttribute('data-tip')) return n;
    const t = [...(n.children || [])].find(c => c.tagName && c.tagName.toLowerCase() === 'title');
    if (t) { n.setAttribute('data-tip', t.textContent); t.remove(); return n; }
    if (n.hasAttribute('title') && n.getAttribute('title')) { n.setAttribute('data-tip', n.getAttribute('title')); n.removeAttribute('title'); return n; }
  }
  return null;
}
function showTip(e) {
  const t = tipTarget(e.target);
  if (!t) { tipEl.style.display = 'none'; return; }
  // First line = heading. "label\tvalue" lines become aligned rows; other lines are split at " · " into rows.
  const [head, ...rest] = t.getAttribute('data-tip').split('\n');
  const parts = head.split(' · ');
  const rows = [...parts.slice(1), ...rest.flatMap(l => l.includes('\t') ? [l] : l.split(' · '))];
  // If any value is long, every row stacks (label above value) so the rows stay consistent
  const long = rows.some(l => (l.split('\t')[1] || '').length > 22);
  tipEl.innerHTML = `<b>${esc(parts[0])}</b>` + rows.map(l => l.includes('\t')
    ? (([k, v]) => `<div class="tr${long ? ' long' : ''}"><span>${esc(k)}</span><em>${esc(v)}</em></div>`)(l.split('\t')) : `<div class="tr txt"><span>${esc(l)}</span></div>`).join('');
  tipEl.style.display = 'block';
  const p = e.touches ? e.touches[0] : e;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = p.clientX + 14, y = p.clientY + 14;
  if (x + w > innerWidth - 8) x = p.clientX - w - 14;
  if (y + h > innerHeight - 8) y = p.clientY - h - 14;
  tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = Math.max(8, y) + 'px';
}
document.addEventListener('mouseover', showTip);
document.addEventListener('mousemove', e => { if (tipEl.style.display === 'block') showTip(e); });
document.addEventListener('touchstart', showTip, { passive: true });
document.addEventListener('scroll', () => { tipEl.style.display = 'none'; }, { passive: true });
// Invisible full-height columns around each data point of a chart, so hovering anywhere above a point shows its tooltip
function hoverCols(xs, top, bottom, tips) {
  return xs.map((x, i) => {
    const l = i === 0 ? x - (xs[1] - x || 40) / 2 : (xs[i - 1] + x) / 2, r = i === xs.length - 1 ? x + (x - (xs[i - 1] ?? x - 40)) / 2 : (x + xs[i + 1]) / 2;
    return `<g class="hcol" data-tip="${esc(tips[i])}"><rect x="${l}" y="${top}" width="${r - l}" height="${bottom - top}"/><line x1="${x}" x2="${x}" y1="${top}" y2="${bottom}"/></g>`;
  }).join('');
}

/* ---------- zero muting ----------
 * Table cells whose value is zero or empty get class "z" so the non-zero numbers stand out when scanning. */
const ZERO_RE = /^([+−-]?0([,.]0+)?( %| p)?|0:00|–|0\/0|0–0)$/;
function muteZeros(root) {
  for (const td of root.querySelectorAll('td')) {
    if (td.children.length > 1 || td.cellIndex === 0) continue;
    td.classList.toggle('z', ZERO_RE.test(td.textContent.trim()));
  }
}
document.addEventListener('DOMContentLoaded', () => {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; muteZeros(document.querySelector('main')); });
  }).observe(document.querySelector('main'), { childList: true, subtree: true });
});

/* ---------- game analysis ---------- */
// Disallowed goals (VT0 = overturned on video review) and shootout goals (period 5) are not game goals.
const validGoal = e => !(e.goalTypes || []).includes('VT0') && (e.period || 0) <= 4;
const SAIPA_NUM = Number(SAIPA);
// Whose point of view a game is analysed from: SaiPa in SaiPa's games, otherwise the home team (live view of
// other games). Shared by the game report, the live view and the shot map.
const focusNum = g => {
  const h = teamNum(g.game.homeTeam.teamId), a = teamNum(g.game.awayTeam.teamId);
  if (h === SAIPA_NUM || a === SAIPA_NUM) return SAIPA_NUM;
  const pick = typeof FOCUS_PICK !== 'undefined' ? FOCUS_PICK.get(String(g.game.id)) : null;   // live view's team switch
  return pick === a ? a : h;
};
const focusName = g => teamNum(g.game.homeTeam.teamId) === focusNum(g) ? g.game.homeTeam.teamName : g.game.awayTeam.teamName;
let GAME_FOCUS = SAIPA_NUM;   // focus team of the game report on screen (set by renderGame)
const isSog = s => s.eventType === 'GOAL' || s.eventType === 'GOALIE_BLOCKED';

async function loadRaw(id) {
  const [g, st, sm] = await Promise.all([
    getJSON(`/games/${SEASON}/${id}`),
    getJSON(`/games/stats/${SEASON}/${id}`),
    getJSON(`/shotmap/${SEASON}/${id}`).catch(() => []),
  ]);
  const ctx = { sm: Array.isArray(sm) ? sm : [], sogFallback: null };
  if (!ctx.sm.length) {
    // No shot map: take shots on goal (saves + goals) from the players' game logs
    const side = teamNum(g.game.homeTeam.teamId) === focusNum(g) ? 'home' : 'away';
    const ids = [...new Set((st[`${side}Team`] || []).flatMap(p => (p.periodPlayerStats || []).map(x => x.playerId)))];
    const logs = await Promise.all(ids.map(pid => getJSON(`/players/info/${pid}/games/${SEASON}`).catch(() => null)));
    ctx.sogFallback = new Map();
    ids.forEach((pid, i) => {
      const r = (logs[i]?.regular || []).find(x => x.gameId === Number(id));
      if (r) ctx.sogFallback.set(pid, (r.goals || 0) + (r.shotsSaved || 0));
    });
  }
  return { g, st, ctx };
}

async function loadGame(id) {
  const { g, st, ctx } = await loadRaw(id);
  return analyzeGame(g, st, null, ctx);
}

// only = period number, or null for the whole game; focus = team number to analyse (default: focusNum(g))
function analyzeGame(g, st, only = null, ctx = { sm: [], sogFallback: null }, focus = null) {
  const F = focus ?? focusNum(g), home = teamNum(g.game.homeTeam.teamId) === F;
  const side = home ? 'home' : 'away';
  const team = home ? g.game.homeTeam : g.game.awayTeam;
  const opp = home ? g.game.awayTeam : g.game.homeTeam;
  const roster = new Map((home ? g.homeTeamPlayers : g.awayTeamPlayers).map(p => [p.id, p]));
  const periods = (st[`${side}Team`] || []).filter(per => only == null || per.period === only);
  const extra = new Map((st[`${side}TeamGamePlayerStats`] || []).map(p => [p.playerId, p]));

  const a1 = {}, a2 = {};
  for (const e of (team.goalEvents || []).filter(e => validGoal(e) && (only == null || e.period === only))) {
    const [x, y] = e.assistantPlayerIds || [];
    if (x) a1[x] = (a1[x] || 0) + 1;
    if (y) a2[y] = (a2[y] || 0) + 1;
  }

  const sk = new Map();
  const gk = new Map();
  for (const per of periods) {
    for (const s of per.periodPlayerStats || []) {
      const q = s.period || {};
      const t = sk.get(s.playerId) || blankSkater(s.playerId);
      t.g += q.goals || 0; t.a += q.assists || 0; t.shots += q.shots || 0;
      t.toi += q.timeofice || 0; t.blk += q.blockedShots || 0;
      t.cf += q.corsiFor || 0; t.ca += q.corsiAgainst || 0;
      t.gf += q.fsTeamGoals || 0; t.ga += q.fsTeamGoalsAgainst || 0;
      t.sf += q.fsTeamShots || 0; t.sa += q.fsTeamShotsAgainst || 0;
      t.fot += q.faceoffsTotal || 0; t.fow += q.faceoffsWon || 0;
      t.pim += q.penaltyminutes || 0; t.pm += q.plusminus || 0;
      t.ixg += s.expectedGoalsPlayer || 0; t.xgf += s.expectedGoalsTeam || 0; t.xga += s.expectedGoalsAgainst || 0;
      t.dist += s.distance || 0; t.passes += s.totalPasses || 0; t.passOk += s.successfulPasses || 0;
      t.pressOk += s.playerSuccessfulPassesUnderPressure || 0;
      t.press += s.playerPassesUnderPressure || 0; t.hpress += s.playerPassesUnderHighPressure || 0; t.hpressOk += s.playerSuccessfulPassesUnderHighPressure || 0;
      t.plus += q.plus || 0; t.minus += q.minus || 0;
      t.ppg += q.powerplayGoals || 0; t.shg += q.shortHandedGoals || 0; t.ppa += q.powerplayAssists || 0; t.pka += q.penaltykillAssists || 0;
      t.eng += q.goalsToEmptyGoal || 0; t.gwg += q.winningGoal || 0;
      t.foO += q.faceoffsOffenceTotal || 0; t.foOw += q.faceoffsOffenceWon || 0; t.foC += q.faceoffsCenterTotal || 0; t.foCw += q.faceoffsCenterWon || 0;
      t.foD += q.faceoffsDefenceTotal || 0; t.foDw += q.faceoffsDefenceWon || 0;
      t.zsO += q.fsZoneStartsOz || 0; t.zsD += q.fsZoneStartsDz || 0;
      t.toiP[per.period] = (t.toiP[per.period] || 0) + (q.timeofice || 0);
      sk.set(s.playerId, t);
    }
    for (const s of per.goaliePeriodStats || []) {
      const q = s.period || {};
      const t = gk.get(s.playerId) || { id: s.playerId, toi: 0, saves: 0, ga: 0, xga: 0, xgaSog: 0, sog: 0 };
      t.toi += q.timeofice || 0; t.saves += q.saves || 0; t.ga += q.goalsAllowed || 0;
      t.xga += s.expectedGoalsAgainst || 0; t.xgaSog += s.expectedGoalsAgainstShotOnGoal || 0; t.sog += q.shotsOnGoal || 0;
      gk.set(s.playerId, t);
    }
  }

  // Shots on goal: from the shot map (goals + saves), or from game logs when the shot map is missing
  const sm = ctx.sm || [];
  const sogBy = {}, missBy = {}, blkdBy = {};
  for (const x of sm) if (x.shootingTeamId === F && (only == null || x.period === only)) {
    if (x.eventType === 'MISSED' || x.eventType === 'MISS') missBy[x.shooterId] = (missBy[x.shooterId] || 0) + 1;
    if (x.eventType === 'PLAYER_BLOCKED') blkdBy[x.shooterId] = (blkdBy[x.shooterId] || 0) + 1;
  }
  let sogKnown = true;
  if (sm.length) {
    for (const x of sm) if (x.shootingTeamId === F && isSog(x) && (only == null || x.period === only)) sogBy[x.shooterId] = (sogBy[x.shooterId] || 0) + 1;
  } else if (only == null && ctx.sogFallback) {
    for (const [k, v] of ctx.sogFallback) sogBy[k] = v;
  } else sogKnown = false;

  // Corsi coverage check: league-recorded attempts vs. even-strength attempts in the shot map
  const cfCredits = (st[`${side}Team`] || []).reduce((acc, per) => acc + (per.periodPlayerStats || []).reduce((a, x) => a + (x.period?.corsiFor || 0), 0), 0);
  const smEv = sm.filter(x => x.shootingTeamId === F && x.type === 'EvenStrengthShot').length;
  const corsiOk = !sm.length || smEv < 10 || cfCredits / 5 >= 0.6 * smEv;

  const people = [];
  for (const t of sk.values()) {
    if (!t.toi) continue;
    t.a1 = a1[t.id] || 0; t.a2 = a2[t.id] || 0;
    t.sog = sogKnown ? (sogBy[t.id] || 0) : null;
    t.miss = sm.length ? (missBy[t.id] || 0) : null; t.shBlk = sm.length ? (blkdBy[t.id] || 0) : null;
    t.corsiOk = corsiOk;
    const p = roster.get(t.id) || {};
    Object.assign(t, person(p), extraOf(extra.get(t.id)));
    t.comp = skaterComponents(t);
    t.gs = sum(t.comp);
    people.push(t);
  }
  // Goalie role over the whole game: started / came in / backup
  const gkStatus = {};
  for (const per of st[`${side}Team`] || []) {
    for (const s of per.goaliePeriodStats || []) {
      const played = (s.period?.timeofice || 0) > 0;
      const cur = gkStatus[s.playerId];
      if (per.period === 1 && played) gkStatus[s.playerId] = 'Aloitti';
      else if (played && cur !== 'Aloitti') gkStatus[s.playerId] = 'Tuli vaihtoon';
      else if (!cur) gkStatus[s.playerId] = 'Varalla';
    }
  }
  const goalies = [];
  for (const t of gk.values()) {
    const p = roster.get(t.id) || {};
    // Role from the league lineup: line 1 = starter (1. MV), line 2 = backup (2. MV)
    const fallback = gkStatus[t.id] === 'Aloitti' ? 1 : 2;
    t.mvNo = (p.line === 1 || p.line === 2) ? p.line : fallback;
    t.status = `${t.mvNo}. MV`;
    goalies.push(t);
    if (!t.toi) { Object.assign(t, person(p), { goalie: true, played: false }); continue; }
    t.played = true;
    Object.assign(t, person(p), extraOf(extra.get(t.id)), { goalie: true });
    t.gsax = t.xga - t.ga;
    t.comp = { tulos: W.gsax * t.gsax, puolustus: W.save * t.saves };
    t.gs = sum(t.comp);
    people.push(t);
  }
  people.sort((a, b) => b.gs - a.gs);

  // Full dressed lineup (skaters), including players without ice time in the selected period
  const lineupIds = new Set([
    ...[...roster.values()].filter(p => p.line != null && p.roleCode !== 'MV').map(p => p.id),
    ...(st[`${side}Team`] || []).flatMap(per => (per.periodPlayerStats || []).map(x => x.playerId)),
  ]);
  const playedById = new Map(people.filter(p => !p.goalie).map(p => [p.id, p]));
  const lineup = [...lineupIds].map(id => {
    if (playedById.has(id)) return Object.assign(playedById.get(id), { played: true });
    const t = sk.get(id) || blankSkater(id);
    return Object.assign(t, person(roster.get(id) || {}), { played: false, gs: null, a1: 0, a2: 0, sog: null, corsiOk });
  });

  return {
    lineup,
    quality: { sogKnown, sogSource: sm.length ? 'shotmap' : (ctx.sogFallback ? 'log' : 'none'), corsiOk, shotmapMissing: !sm.length },
    id: g.game.id, start: g.game.start, home, ended: g.game.ended, focus: F,
    saipa: team, opp, people,
    goalies: goalies.sort((a, b) => a.mvNo - b.mvNo),
    teamXg: team.expectedGoals, oppXg: opp.expectedGoals,
    spectators: g.game.spectators, rink: g.game.iceRink?.name,
    finishedType: g.game.finishedType,
  };
}

function blankSkater(id) {
  return { id, g: 0, a: 0, shots: 0, toi: 0, blk: 0, cf: 0, ca: 0, gf: 0, ga: 0, sf: 0, sa: 0, fot: 0, fow: 0, pim: 0, pm: 0, ixg: 0, xgf: 0, xga: 0, dist: 0, passes: 0, passOk: 0, pressOk: 0,
    plus: 0, minus: 0, ppg: 0, shg: 0, ppa: 0, pka: 0, eng: 0, gwg: 0,
    foO: 0, foOw: 0, foC: 0, foCw: 0, foD: 0, foDw: 0, press: 0, hpress: 0, hpressOk: 0, zsO: 0, zsD: 0, toiP: {} };
}
function person(p) {
  return { first: p.firstName || '', last: p.lastName || '?', jersey: p.jersey, role: p.roleCode || '', pic: p.pictureUrl };
}
function extraOf(e) { return { topSpeed: e?.topSpeed || 0, hardestShot: e?.hardestShot || 0 }; }
function sum(o) { return Object.values(o).reduce((s, v) => s + v, 0); }
function skaterComponents(t) {
  return {
    tulos: W.goal * t.g + W.a1 * t.a1 + W.a2 * t.a2,
    tuotanto: W.shot * (t.sog || 0) + W.ixg * t.ixg,
    hallinta: W.corsi * (t.cf - t.ca) + W.evGoal * (t.gf - t.ga),
    puolustus: W.block * t.blk,
    muut: W.foWon * t.fow + W.foLost * (t.fot - t.fow) + W.minor * (t.pim / 2),
  };
}

/* ---------- game view ---------- */
let saipaGames = [];

let nextGameRow = null;

async function initGames() {
  const sched = await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`);
  const mine = sched.filter(g => isSaipa(g.homeTeamId) || isSaipa(g.awayTeamId));
  saipaGames = mine.filter(g => g.ended).sort((a, b) => b.start.localeCompare(a.start));
  nextGameRow = mine.filter(g => !g.ended).sort((a, b) => a.start.localeCompare(b.start))[0] || null;
  const sel = $('#gameSelect');
  const weekday = iso => new Date(iso).toLocaleDateString('fi-FI', { weekday: 'short', timeZone: 'Europe/Helsinki' });
  sel.innerHTML = (nextGameRow ? `<option value="${nextGameRow.id}">Seuraava: ${weekday(nextGameRow.start)} ${fiDate(nextGameRow.start)} ${esc(nextGameRow.homeTeamName)}–${esc(nextGameRow.awayTeamName)}</option>` : '')
    + saipaGames.map(g => `<option value="${g.id}">${fiDate(g.start)} ${esc(g.homeTeamName)}–${esc(g.awayTeamName)} ${g.homeTeamGoals}–${g.awayTeamGoals}</option>`).join('');
  const qs = new URLSearchParams(location.search);
  const want = urlState().game;
  const known = id => (nextGameRow && String(nextGameRow.id) === id) || saipaGames.some(g => String(g.id) === id);
  // Default: the next game's preview from midnight (Finnish time) on game day, until then the latest game's report
  const latest = saipaGames[0];
  const fiDay = d => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });  // YYYY-MM-DD
  const gameDay = nextGameRow && fiDay(nextGameRow.start) <= fiDay(Date.now());
  sel.value = want && known(want) ? want : String((nextGameRow && (gameDay || !latest)) ? nextGameRow.id : latest?.id);
  // Re-check once a minute so the Live tab appears at puck drop without a reload
  if (typeof liveGameId === 'function' && nextGameRow) setInterval(() => { const on = liveGameId() === sel.value; const has = !!document.querySelector('.stab[data-s="live"]'); if (on !== has && urlState().view === 'ottelu') renderHub(sel.value, on ? 'live' : urlState().tab); }, 60000);
  sel.onchange = () => renderHub(sel.value);
  if (sel.value) renderHub(sel.value, urlState().tab);
  else $('#gameContent').innerHTML = '<p class="muted">Ei otteluita otteluohjelmassa.</p>';
}

// Game hub: every game has a Preview and (once played) a Report sub-view
function renderHub(id, section) {
  const ended = saipaGames.some(g => String(g.id) === String(id));
  // Live view (live.js, optional add-on): available while the game is on
  const live = typeof liveGameId === 'function' && liveGameId() === String(id);
  const sec = live ? (section === 'ennakko' ? 'ennakko' : 'live') : ended ? (section === 'ennakko' ? 'ennakko' : 'ottelu') : 'ennakko';
  const u = `?${new URLSearchParams({ game: id, tab: URL_TAB[sec], ...(new URLSearchParams(location.search).get('replay') === '1' ? { replay: 1 } : {}) })}`;
  if (!urlState().player && urlState().view === 'ottelu') history.replaceState(null, '', u);
  LAST_HUB = u;
  const box = $('#gameContent');
  box.innerHTML = `<div class="subtabs" role="tablist">
      <button class="stab ${sec === 'ennakko' ? 'active' : ''}" data-s="ennakko">Ennakko</button>
      ${live ? `<button class="stab ${sec === 'live' ? 'active' : ''}" data-s="live"><span class="lv-dot"></span>Live</button>` : `<button class="stab ${sec === 'ottelu' ? 'active' : ''}" data-s="ottelu" ${ended ? '' : 'disabled title="Ottelua ei ole vielä pelattu"'}>Ottelu</button>`}
    </div>
    <div id="hubBody"></div>`;
  box.querySelectorAll('.stab').forEach(b => b.onclick = () => { if (!b.disabled) renderHub(id, b.dataset.s); });
  if (sec === 'ennakko') renderPreview(id, $('#hubBody'));
  else if (sec === 'live') renderLive(id, $('#hubBody'));
  else renderGame(id, $('#hubBody'));
}

const PERIOD_LABEL = n => n <= 3 ? `${n}. erä` : n === 4 ? 'Jatkoaika' : 'Voittolaukaukset';
const PERIOD_SHORT = n => n <= 3 ? `${n}.` : n === 4 ? 'JA' : 'VL';

function playedPeriods(st, side) {
  return (st[`${side}Team`] || [])
    .filter(per => (per.periodPlayerStats || []).some(s => s.period?.timeofice > 0))
    .map(per => per.period)
    .sort((a, b) => a - b);
}

// Period summary: goals, xG, shot attempts and puck control for both teams
function periodSummary(g, st, home) {
  const side = home ? 'home' : 'away', oside = home ? 'away' : 'home';
  const team = home ? g.game.homeTeam : g.game.awayTeam;
  const opp = home ? g.game.awayTeam : g.game.homeTeam;
  const find = (s, n) => (st[`${s}Team`] || []).find(p => p.period === n) || {};
  const xgOf = per => (per.periodPlayerStats || []).reduce((s, p) => s + (p.expectedGoalsPlayer || 0), 0);
  const goalsIn = (t, n) => (t.goalEvents || []).filter(e => validGoal(e) && e.period === n).length;
  return playedPeriods(st, side).map(n => {
    const a = find(side, n), b = find(oside, n);
    const puck = (st.puckStats || []).find(p => p.periodNumber === n);
    return {
      n,
      sg: goalsIn(team, n), og: goalsIn(opp, n),
      sxg: xgOf(a), oxg: xgOf(b),
      ssh: a.shots || 0, osh: b.shots || 0,
      spk: puck ? (home ? puck.homeTeamControlDuration : puck.awayTeamControlDuration) : null,
      opk: puck ? (home ? puck.awayTeamControlDuration : puck.homeTeamControlDuration) : null,
    };
  });
}

async function renderGame(id, box = $('#gameContent')) {
  box.innerHTML = '<p class="loading">Ladataan ottelua…</p>';
  try {
    const { g, st, ctx } = await loadRaw(id);
    const full = analyzeGame(g, st, null, ctx);
    const rd = reportData(g, st, ctx.sm);
    const home = full.home;
    PV_SWAP = !home;
    GAME_FOCUS = full.focus;
    GAME_SM = ctx.sm || [];   // shared head-to-head helpers (preview.js): home team on the left
    const periods = playedPeriods(st, home ? 'home' : 'away');
    const summary = periodSummary(g, st, home);
    const perBest = periods.map(n => ({ n, p: analyzeGame(g, st, n, ctx).people[0] }));

    const homeName = home ? full.saipa.teamName : full.opp.teamName;
    const awayName = home ? full.opp.teamName : full.saipa.teamName;
    const hg = home ? full.saipa.goals : full.opp.goals, ag = home ? full.opp.goals : full.saipa.goals;
    const suffix = full.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME' ? ' JA' : full.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION' ? ' VL' : '';
    const hxg = home ? full.teamXg : full.oppXg, axg = home ? full.oppXg : full.teamXg;

    box.innerHTML = `
      <div class="scoreboard">
        <div class="team ${home && full.focus === SAIPA_NUM ? 'saipa' : ''}">${esc(homeName)}</div>
        <div class="score">${hg}–${ag}${suffix}</div>
        <div class="team away ${!home && full.focus === SAIPA_NUM ? 'saipa' : ''}">${esc(awayName)}</div>
        <div class="meta">
          <span>${fiDate(full.start)}</span>
          <span>xG <b>${num(hxg, 2)}–${num(axg, 2)}</b></span>
          <span>Yleisö <b>${(full.spectators || 0).toLocaleString('fi-FI')}</b></span>
          <span>${esc(full.rink || '')}</span>
        </div>
      </div>

      ${dataNotes(full.quality)}
      ${deservedHtml(rd, (() => { const gk = full.goalies.filter(x => x.played); return gk.map(x => x.last).join(' / '); })(), full.opp.teamName)}
      ${flowHtml(rd, full.opp.teamName)}
      ${goalsHtml(rd, id, SEASON)}
      ${shotMapCard(ctx.sm, g, full.opp.teamName)}

      <div class="card live-hide">
        <h2>Erä erältä</h2>
        ${periodVsGame(summary, full.saipa.teamName, full.opp.teamName, home, { sxg: full.teamXg, oxg: full.oppXg })}
        <div class="erastars"><div class="es-k">⭐ Erän tähti</div>${perBest.filter(x => x.p).map(x => `<div class="es"><span>${PERIOD_LABEL(x.n)}</span><b>${esc(x.p.first + ' ' + x.p.last)}</b><small>${num(x.p.gs, 2)} pelipistettä</small></div>`).join('')}</div>
      </div>

      <div class="periodbar" role="tablist" aria-label="Valitse erä">
        <button class="pbtn active" data-p="all">Koko peli</button>
        ${periods.map(n => `<button class="pbtn" data-p="${n}">${PERIOD_LABEL(n)}</button>`).join('')}
      </div>
      <div id="periodContent"></div>`;

    const setShotPeriod = initShotMap(box, ctx.sm, g, full.opp.teamName);
    const draw = sel => {
      setShotPeriod(sel === 'all' ? null : Number(sel));
      const a = sel === 'all' ? full : analyzeGame(g, st, Number(sel), ctx);
      box.querySelectorAll('.pbtn').forEach(b => b.classList.toggle('active', b.dataset.p === String(sel)));
      drawPeriodContent($('#periodContent'), a, sel === 'all' ? null : Number(sel), full);
    };
    box.querySelectorAll('.pbtn').forEach(b => b.onclick = () => draw(b.dataset.p));
    draw('all');
  } catch (e) {
    box.innerHTML = `<p class="neg-num">Ottelun lataus epäonnistui: ${esc(e.message)}</p>`;
  }
}

function dataNotes(q) {
  const notes = [];
  if (!q.corsiOk) notes.push('Liigan Corsi-data puutteellinen (merkitty *). Päivittyy, kun Liiga korjaa datan.');
  if (q.shotmapMissing && q.sogSource === 'log') notes.push('Laukauskartta puuttuu. Laukaukset maalia kohti pelaajien ottelulokeista, ei eräkohtaisesti.');
  if (q.shotmapMissing && q.sogSource === 'none') notes.push('Laukaukset maalia kohti puuttuvat.');
  return notes.length ? `<div class="datanote"><b>Datahuomio</b>${notes.map(n => `<p>${n}</p>`).join('')}</div>` : '';
}

// Skater stat sets shared by the game report and the season view. rows may be scaled copies (per game / per 60)
// with the original in _raw; relative stats always use the original totals.
function skaterSets(rows, opt = {}) {
  const gsPart = (p, k) => p['c_' + k] ?? p.comp?.[k] ?? 0;
  const v = x => x == null ? x : Number.isInteger(x) ? x : num(x, 2);
  const ratio = (x, n, d = 0) => n ? pct(x / n, d) : '';
  // NHL-style abbreviations. The hover shows the English name and a short Finnish explanation.
  // Tip title is "ABBR = English name"; a Finnish column label without an abbreviation passes en = null and gets its label only
  const C = (k, l, en, fi, f, sv, g) => ({ k, l, t: en ? `${en}${fi ? '\n' + fi : ''}` : fi, f, s: sv, ...(g ? { g } : {}) });
  const dash0 = v => v == null ? '–' : v;
  const fo = (w, n) => n ? `${w}/${n}` : '';
  const foS = (w, n) => n ? w / n : -1;
  // Team totals for relative stats: every on-ice attempt is credited to the five skaters on the ice
  const sks = rows.filter(p => p.played !== false && p.toi).map(p => p._raw || p);
  const tCF = sks.reduce((t, p) => t + p.cf, 0) / 5, tCA = sks.reduce((t, p) => t + p.ca, 0) / 5;
  const corRel = q => { const p = q._raw || q; const on = p.cf + p.ca, offF = tCF - p.cf, offA = tCA - p.ca; return on && (offF + offA) > 0 ? p.cf / on - offF / (offF + offA) : null; };
  const xgRel = q => { const p = q._raw || q; if (opt.teamXg == null) return null; const on = p.xgf + p.xga, offF = opt.teamXg - p.xgf, offA = opt.oppXg - p.xga; return on && (offF + offA) > 0 ? p.xgf / on - offF / (offF + offA) : null; };
  const evPts = p => (p.g - p.ppg - p.shg) + (p.a - p.ppa - p.pka);
  const per60 = (v, p) => p.toi ? v / p.toi * 3600 : null;
  const relCell = v => v == null ? '' : `<span class="${cls(v)}">${v > 0 ? '+' : ''}${num(v * 100, 1)}</span>`;
  const SETS = {
    perus: ['Perustilastot', 'gs', [
      C('toi', 'TOI', 'Time on Ice', 'Peliaika kaikissa tilanteissa', p => mmss(p.toi), p => p.toi),
      C('g', 'G', 'Goals', 'Maalit', p => v(p.g), p => p.g),
      C('a', 'A', 'Assists', 'Syötöt', p => v(p.a), p => p.a),
      C('pts', 'P', 'Points', 'Pisteet: maalit + syötöt', p => v(p.g + p.a), p => p.g + p.a),
      C('pm', '+/-', 'Plus/Minus', 'Joukkueen maaliero pelaajan ollessa jäällä, ei ylivoimamaaleja', p => `<span class="${cls(p.pm)}">${signed(p.pm, Number.isInteger(p.pm) ? 0 : 2)}</span>`, p => p.pm),
      C('sog', 'SOG', 'Shots on Goal', 'Laukaukset maalia kohti', p => dash0(v(p.sog)), p => p.sog ?? -1),
      C('ixg', 'xG', 'Expected Goals', 'Maaliodottama: montako maalia pelaaja olisi laukaustensa laadulla todennäköisesti tehnyt', p => num(p.ixg, 2), p => p.ixg),
      C('blk', 'BLK', 'Blocked Shots', 'Blokatut vastustajan laukaukset', p => v(p.blk), p => p.blk),
      C('pim', 'PIM', 'Penalty Minutes', 'Rangaistusminuutit', p => v(p.pim), p => p.pim),
    ]],
    gs: ['Pelipisteet', 'gs', [
      ...COMPONENTS.map(c => C('c_' + c.key, c.label, null, c.tip,
        q => { const v = gsPart(q, c.key); return `<span class="gs-sw" style="background:${c.color}"></span>${num(v, 2)}`; }, q => gsPart(q, c.key), 'GS = Tulos + Tuotanto + Hallinta + Puolustus + Muut')),
    ]],
    maalit: ['Maalit ja syötöt', 'pts', [
      C('pts', 'P', 'Points', 'Pisteet: maalit + syötöt', p => v(p.g + p.a), p => p.g + p.a),
      C('p1', 'P1', 'Primary Points', 'Maalit + ykkössyötöt. Kertoo pisteitä paremmin, kuka ratkaisee', p => v(p.g + p.a1), p => p.g + p.a1),
      C('g', 'G', 'Goals', 'Maalit', p => v(p.g), p => p.g, 'Maalit'),
      C('ppg', 'PPG', 'Power Play Goals', 'Ylivoimamaalit', p => v(p.ppg), p => p.ppg, 'Maalit'),
      C('shg', 'SHG', 'Short-Handed Goals', 'Alivoimamaalit', p => v(p.shg), p => p.shg, 'Maalit'),
      C('eng', 'ENG', 'Empty Net Goals', 'Maalit tyhjään maaliin', p => v(p.eng), p => p.eng, 'Maalit'),
      C('gwg', 'GWG', 'Game-Winning Goals', 'Voittomaali: maali, joka teki eron voittaneen ja hävinneen välille', p => v(p.gwg), p => p.gwg, 'Maalit'),
      C('a', 'A', 'Assists', 'Syötöt', p => v(p.a), p => p.a, 'Syötöt'),
      C('a1', 'A1', 'Primary Assists', 'Ykkössyötöt: viimeinen saman joukkueen pelaaja ennen maalintekijää', p => v(p.a1), p => p.a1, 'Syötöt'),
      C('a2', 'A2', 'Secondary Assists', 'Kakkossyötöt: ykkössyöttäjää edeltänyt pelaaja', p => v(p.a2), p => p.a2, 'Syötöt'),
      C('ppa', 'PPA', 'Power Play Assists', 'Ylivoimasyötöt', p => v(p.ppa), p => p.ppa, 'Syötöt'),
      C('pka', 'SHA', 'Short-Handed Assists', 'Alivoimasyötöt', p => v(p.pka), p => p.pka, 'Syötöt'),
      C('ipp', 'IPP', 'Individual Points Percentage', 'Pelaajan tasakentin pisteet / joukkueen tasakentin maalit pelaajan ollessa jäällä', p => p.gf ? pct(Math.min(1, evPts(p) / p.gf), 0) : '', p => p.gf ? evPts(p) / p.gf : -1, 'Kentällä'),
      C('plus', '+', 'Plus', 'Tasakentin ja alivoimalla tehdyt maalit pelaajan ollessa jäällä', p => v(p.plus), p => p.plus, 'Kentällä'),
      C('minus', '−', 'Minus', 'Tasakentin ja ylivoimalla päästetyt maalit pelaajan ollessa jäällä', p => v(p.minus), p => p.minus, 'Kentällä'),
      C('pm', '+/-', 'Plus/Minus', '', p => `<span class="${cls(p.pm)}">${signed(p.pm, Number.isInteger(p.pm) ? 0 : 2)}</span>`, p => p.pm, 'Kentällä'),
    ]],
    laukaukset: ['Laukaukset', 'shots', [
      C('shots', 'iCF', 'Individual Corsi For', 'Laukausyritykset: maalia kohti, ohi ja blokatut yhteensä', p => v(p.shots), p => p.shots),
      C('sog', 'SOG', 'Shots on Goal', 'Laukaukset maalia kohti', p => dash0(v(p.sog)), p => p.sog ?? -1),
      C('miss', 'MS', 'Missed Shots', 'Ohi, yli, tolppaan tai ylärimaan', p => dash0(v(p.miss)), p => p.miss ?? -1),
      C('shBlk', 'SB', 'Shots Blocked', 'Pelaajan laukaukset, jotka vastustaja blokkasi', p => dash0(v(p.shBlk)), p => p.shBlk ?? -1),
      C('shPct', 'SH%', 'Shooting Percentage', 'Maalit / laukaukset maalia kohti', p => p.sog ? pct(p.g / p.sog, 0) : '', p => p.sog ? p.g / p.sog : -1),
      C('ixg', 'xG', 'Expected Goals', 'Maaliodottama', p => num(p.ixg, 2), p => p.ixg),
      C('xgPer', 'xG/iCF', 'Expected Goals per Shot Attempt', 'Laukausyritysten keskimääräinen laatu', p => p.shots ? num(p.ixg / p.shots, 2) : '', p => p.shots ? p.ixg / p.shots : -1),
      C('fin', 'G−xG', 'Goals minus Expected Goals', 'Plussalla viimeistely yli odotusten', p => `<span class="${cls(p.g - p.ixg)}">${signed(p.g - p.ixg, 2)}</span>`, p => p.g - p.ixg),
      C('hardestShot', 'Max Shot', 'Hardest Shot', 'Koko ottelun kovin laukaus, km/h', p => p.hardestShot ? num(p.hardestShot * 3.6, 1) : '', p => p.hardestShot),
    ]],
    syotot: ['Syötöt', 'passOk', [
      C('passes', 'Att', 'Pass Attempts', 'Syöttöyritykset', p => v(p.passes), p => p.passes, 'Kaikki'),
      C('passOk', 'Cmp', 'Completed Passes', 'Onnistuneet syötöt', p => v(p.passOk), p => p.passOk, 'Kaikki'),
      C('passPct', 'Cmp%', 'Completion Percentage', 'Onnistuneiden syöttöjen osuus', p => ratio(p.passOk, p.passes), p => p.passes ? p.passOk / p.passes : -1, 'Kaikki'),
      C('press', 'Att', 'Pass Attempts under Pressure', 'Syöttöyritykset paineen alla', p => v(p.press), p => p.press, 'Paineen alla'),
      C('pressOk', 'Cmp', 'Completed Passes under Pressure', 'Onnistuneet syötöt paineen alla', p => v(p.pressOk), p => p.pressOk, 'Paineen alla'),
      C('pressPct', 'Cmp%', 'Completion Percentage under Pressure', 'Onnistumisprosentti paineen alla', p => ratio(p.pressOk, p.press), p => p.press ? p.pressOk / p.press : -1, 'Paineen alla'),
      C('hpress', 'Att', 'Pass Attempts under High Pressure', 'Syöttöyritykset kovan paineen alla', p => v(p.hpress), p => p.hpress, 'Kova paine'),
      C('hpressOk', 'Cmp', 'Completed Passes under High Pressure', 'Onnistuneet syötöt kovan paineen alla', p => v(p.hpressOk), p => p.hpressOk, 'Kova paine'),
      C('hpressPct', 'Cmp%', 'Completion Percentage under High Pressure', 'Onnistumisprosentti kovan paineen alla', p => ratio(p.hpressOk, p.hpress), p => p.hpress ? p.hpressOk / p.hpress : -1, 'Kova paine'),
    ]],
    aloitukset: ['Aloitukset', 'fot', [
      C('fot', 'FO', 'Faceoffs', 'Aloitukset', p => p.fot ? v(p.fot) : '', p => p.fot, 'Kaikki'),
      C('fow', 'FOW', 'Faceoffs Won', 'Voitetut aloitukset', p => p.fot ? v(p.fow) : '', p => p.fot ? p.fow : -1, 'Kaikki'),
      C('foPct', 'FO%', 'Faceoff Percentage', 'Voitetut / kaikki aloitukset', p => ratio(p.fow, p.fot), p => foS(p.fow, p.fot), 'Kaikki'),
      C('foO', 'FO', 'Faceoffs, Offensive Zone', 'Aloitukset, hyökkäysalue', p => p.foO ? v(p.foO) : '', p => p.foO, 'Hyökkäysalue'),
      C('foOw', 'FOW', 'Faceoffs Won, Offensive Zone', 'Voitetut aloitukset, hyökkäysalue', p => p.foO ? v(p.foOw) : '', p => p.foO ? p.foOw : -1, 'Hyökkäysalue'),
      C('foOp', 'FO%', 'Faceoff Percentage, Offensive Zone', 'Voitetut / kaikki aloitukset, hyökkäysalue', p => ratio(p.foOw, p.foO), p => foS(p.foOw, p.foO), 'Hyökkäysalue'),
      C('foC', 'FO', 'Faceoffs, Neutral Zone', 'Aloitukset, keskialue', p => p.foC ? v(p.foC) : '', p => p.foC, 'Keskialue'),
      C('foCw', 'FOW', 'Faceoffs Won, Neutral Zone', 'Voitetut aloitukset, keskialue', p => p.foC ? v(p.foCw) : '', p => p.foC ? p.foCw : -1, 'Keskialue'),
      C('foCp', 'FO%', 'Faceoff Percentage, Neutral Zone', 'Voitetut / kaikki aloitukset, keskialue', p => ratio(p.foCw, p.foC), p => foS(p.foCw, p.foC), 'Keskialue'),
      C('foD', 'FO', 'Faceoffs, Defensive Zone', 'Aloitukset, puolustusalue', p => p.foD ? v(p.foD) : '', p => p.foD, 'Puolustusalue'),
      C('foDw', 'FOW', 'Faceoffs Won, Defensive Zone', 'Voitetut aloitukset, puolustusalue', p => p.foD ? v(p.foDw) : '', p => p.foD ? p.foDw : -1, 'Puolustusalue'),
      C('foDp', 'FO%', 'Faceoff Percentage, Defensive Zone', 'Voitetut / kaikki aloitukset, puolustusalue', p => ratio(p.foDw, p.foD), p => foS(p.foDw, p.foD), 'Puolustusalue'),
    ]],
    peliajat: ['Peliajat', 'toi', [
      C('toi', 'TOI', 'Time on Ice', 'Peliaika kaikissa tilanteissa', p => mmss(p.toi), p => p.toi),
      ...[1, 2, 3, 4].filter(n => rows.some(p => p.toiP?.[n])).map(n => C(`toi${n}`, ['1st', '2nd', '3rd', 'OT'][n - 1], `Time on Ice, ${['1st Period', '2nd Period', '3rd Period', 'Overtime'][n - 1]}`, `Peliaika, ${n < 4 ? n + '. erä' : 'jatkoaika'}`, p => p.toiP?.[n] ? mmss(p.toiP[n]) : '', p => p.toiP?.[n] || 0, 'TOI')),
    ]],
    edistyneet: ['Edistyneet', 'corsi', [
      C('corsi', 'C+/-', 'Corsi Differential', 'Tasakentin omat miinus vastustajan laukausyritykset pelaajan ollessa jäällä', p => `<span class="${cls(p.cf - p.ca)}">${signed(p.cf - p.ca, Number.isInteger(p.cf - p.ca) ? 0 : 2)}</span>${p.corsiOk === false ? '*' : ''}`, p => p.cf - p.ca, 'Corsi'),
      C('cf', 'CF–CA', 'Corsi For – Corsi Against', 'Tasakentin omat–vastustajan laukausyritykset pelaajan ollessa jäällä', p => `${v(p.cf)}–${v(p.ca)}`, p => p.cf, 'Corsi'),
      C('cfp', 'CF%', 'Corsi For Percentage', 'Oman joukkueen osuus tasakentin laukausyrityksistä pelaajan ollessa jäällä', p => ratio(p.cf, p.cf + p.ca), p => (p.cf + p.ca) ? p.cf / (p.cf + p.ca) : -1, 'Corsi'),
      C('corRel', 'CF% Rel', 'Relative Corsi For Percentage', 'Pelaajan CF% miinus joukkueen CF% hänen ollessaan vaihdossa, prosenttiyksikköinä. Plussalla joukkue on parempi pelaajan ollessa jäällä.', p => relCell(corRel(p)), p => corRel(p) ?? -9, 'Corsi'),
      C('xgf', 'xGF–xGA', 'Expected Goals For – Against', 'Omat–vastustajan maalipaikat pelaajan ollessa jäällä, kaikki tilanteet', p => `${num(p.xgf, 2)}–${num(p.xga, 2)}`, p => p.xgf - p.xga, 'Maaliodottama kentällä'),
      C('xgp', 'xGF%', 'Expected Goals For Percentage', 'Oman joukkueen osuus maaliodottamasta pelaajan ollessa jäällä', p => ratio(p.xgf, p.xgf + p.xga), p => (p.xgf + p.xga) ? p.xgf / (p.xgf + p.xga) : -1, 'Maaliodottama kentällä'),
      C('xgRel', 'xGF% Rel', 'Relative Expected Goals For Percentage', 'Pelaajan xGF% miinus joukkueen xGF% hänen ollessaan vaihdossa, prosenttiyksikköinä. Vain koko ottelusta.', p => relCell(xgRel(p)), p => xgRel(p) ?? -9, 'Maaliodottama kentällä'),
      C('zsO', 'OZS', 'Offensive Zone Starts', 'Joukkueen hyökkäyspään aloitukset tasakentin pelaajan ollessa jäällä', p => v(p.zsO), p => p.zsO, 'Aloituspaikat'),
      C('zsD', 'DZS', 'Defensive Zone Starts', 'Joukkueen puolustuspään aloitukset tasakentin pelaajan ollessa jäällä', p => v(p.zsD), p => p.zsD, 'Aloituspaikat'),
      C('zsP', 'OZS%', 'Offensive Zone Start Percentage', 'Hyökkäyspään aloitusten osuus. Iso luku: valmentaja antaa hyökkäysvastuuta. Pieni: pelaaja laitetaan oman pään aloituksiin.', p => ratio(p.zsO, p.zsO + p.zsD), p => (p.zsO + p.zsD) ? p.zsO / (p.zsO + p.zsD) : -1, 'Aloituspaikat'),
    ]],
    per60: ['Per 60 min', 'p60', [
      C('toi', 'TOI', 'Time on Ice', 'Peliaika', p => mmss(p.toi), p => p.toi),
      C('p60', 'P/60', 'Points per 60', 'Pisteet 60 peliminuuttia kohden', p => num(per60(p.g + p.a, p), 2), p => per60(p.g + p.a, p) ?? -1),
      C('g60', 'G/60', 'Goals per 60', 'Maalit 60 peliminuuttia kohden', p => num(per60(p.g, p), 2), p => per60(p.g, p) ?? -1),
      C('p160', 'P1/60', 'Primary Points per 60', 'Maalit + ykkössyötöt 60 peliminuuttia kohden', p => num(per60(p.g + p.a1, p), 2), p => per60(p.g + p.a1, p) ?? -1),
      C('ly60', 'iCF/60', 'Shot Attempts per 60', 'Laukausyritykset 60 peliminuuttia kohden', p => num(per60(p.shots, p), 1), p => per60(p.shots, p) ?? -1),
      C('xg60', 'xG/60', 'Expected Goals per 60', 'Maaliodottama 60 peliminuuttia kohden', p => num(per60(p.ixg, p), 2), p => per60(p.ixg, p) ?? -1),
    ]],
    luistelu: ['Luistelu', 'dist', [
      C('dist', 'DIST', 'Skating Distance', 'Luistelumatka metreinä', p => p.dist ? Math.round(p.dist).toLocaleString('fi-FI') : '', p => p.dist),
      C('distMin', 'DIST/min', 'Skating Distance per Minute', 'Luistelumatka peliminuuttia kohden, metreinä', p => p.dist && p.toi ? Math.round(p.dist / (p.toi / 60)) : '', p => p.toi ? p.dist / p.toi : -1),
      C('topSpeed', 'Max Speed', 'Top Skating Speed', 'Koko ottelun huippuvauhti, km/h', p => p.topSpeed ? num(p.topSpeed * 3.6, 1) : '', p => p.topSpeed),
    ]],
  };
  if (!opt.per60) delete SETS.per60;
  return SETS;
}

let SK_SET = 'perus';
let GK_SET = 'perus';
let GAME_SM = [];       // shot map of the game on screen (for goalie splits)   // selected stat set in the skater table, kept across period switches
function drawPeriodContent(el, a, period, full) {
  const top = a.people.slice(0, 3);
  const skaters = a.people.filter(p => !p.goalie);
  const goalies = a.people.filter(p => p.goalie);
  const fullSk = full.people.filter(p => !p.goalie);
  const best = (arr, f) => arr.length ? arr.reduce((m, p) => (f(p) > f(m) ? p : m), arr[0]) : null;
  const fast = best(fullSk, p => p.topSpeed);
  const hard = best(fullSk, p => p.hardestShot);
  const far = best(skaters, p => p.dist);
  const pass = best(skaters, p => p.passOk);
  const blocker = best(skaters, p => p.blk);
  const title = period == null ? 'Ottelun tähdet' : `${PERIOD_LABEL(period)}: erän tähdet`;

  el.innerHTML = `
    <div class="card live-hide">
      <h2><span class="tag">${title}</span></h2>
      ${top.length ? `<div class="podium">${top.map((p, i) => mvpCard(p, i)).join('')}</div>${legend()}` : '<p class="muted">Ei dataa tältä erältä.</p>'}
    </div>

    <div class="card live-hide">
      <h2>Bonustilastot${period == null ? '' : ` · ${PERIOD_LABEL(period)}`}</h2>
      <div class="tiles" data-n="${5 + goalies.length}">
        ${fast?.topSpeed ? tile('⚡', 'Huippuvauhti', num(fast.topSpeed * 3.6, 1), 'km/h', fast, period == null ? '' : 'koko ottelu', '', period == null ? '' : 'Liiga antaa huippuvauhdin vain koko ottelulta, ei eräkohtaisesti') : tile('⚡', 'Huippuvauhti', '–', '', null, 'ei dataa')}
        ${hard?.hardestShot ? tile('💥', 'Laukaus', num(hard.hardestShot * 3.6, 1), 'km/h', hard, period == null ? '' : 'koko ottelu', '', period == null ? '' : 'Liiga antaa laukausnopeuden vain koko ottelulta, ei eräkohtaisesti') : tile('💥', 'Laukaus', '–', '', null, 'ei dataa')}
        ${far?.dist ? tile('🏃', 'Luistelu', num(far.dist / 1000, 2), 'km', far) : tile('🏃', 'Luistelu', '–', '', null, 'ei dataa')}
        ${pass?.passOk ? tile('🎯', 'Syötöt', `${pass.passOk}/${pass.passes}`, '', pass, '', '', 'Eniten onnistuneita syöttöjä\nOnnistuneet / kaikki syötöt') : tile('🎯', 'Syötöt', '0', '', null, 'ei onnistuneita')}
        ${blocker?.blk ? tile('🛡️', 'Blokit', blocker.blk, '', blocker) : tile('🛡️', 'Blokit', '0', '', null, 'ei blokkeja')}
        ${goalies.map(gk => tile('🧤', 'Maalivahti', signed(gk.gsax, 2), 'GSAx', gk, '', gk.gsax >= 0 ? 'pos' : 'neg', `Goals Saved Above Expected\nTorjunnat\t${gk.saves}\nPäästetyt\t${gk.ga}\nxGA\t${num(gk.xga, 2)}`)).join('')}
      </div>
    </div>

    <div class="card">
      <h2>Kenttäpelaajat${period == null ? '' : ` · ${PERIOD_LABEL(period)}`}</h2>
      <div class="setbar" id="skSets" role="tablist" aria-label="Tilastot"></div>
      <div class="tablewrap" id="gameTable"></div>
    </div>

    <div class="card">
      <h2>Maalivahdit${period == null ? '' : ` · ${PERIOD_LABEL(period)}`}</h2>
      <div class="setbar" id="gkSets" role="tablist" aria-label="Maalivahtitilastot"></div>
      <div class="tablewrap" id="gkGameTable"></div>
    </div>`;

  const dash = (p, v) => p.played ? v : '–';
  // Saves by situation and by zone, from the shot map (shots on goal the goalie faced)
  const faced = new Map();
  for (const x of GAME_SM) {
    if (x.shootingTeamId === GAME_FOCUS || !isSog(x) || (period != null && x.period !== period)) continue;
    const n = normShot(x), f = faced.get(x.blockerId) || [];
    f.push(n); faced.set(x.blockerId, f);
  }
  const svBy = (p, test) => {
    const f = (faced.get(p.id) || []).filter(test), sv = f.filter(x => !x.goal).length;
    return { n: f.length, sv, pct: f.length ? sv / f.length : null };
  };
  const svCol = (k, l, t, test) => ({ k, l, t, f: p => { const r = svBy(p, test); return dash(p, r.n ? `${pct(r.pct, 0)} <small class="muted">${r.sv}/${r.n}</small>` : '–'); }, s: p => p.played ? (svBy(p, test).pct ?? -1) : -1 });

  const gkName = { k: 'last', l: 'Maalivahti', f: p => `${plink(p, `${esc(p.first)} ${esc(p.last)}`)}<span class="pos-chip">#${p.jersey ?? ''}</span>`, s: p => p.last };
  const gkRole = { k: 'status', l: 'G#', t: 'Goalie Number\n1. = aloittava maalivahti, 2. = varamaalivahti', f: p => `${p.mvNo}.`, s: p => -p.mvNo };
  const G = (k, l, en, fi, f, sv, g) => ({ k, l, t: `${en}${fi ? '\n' + fi : ''}`, f, s: sv, ...(g ? { g } : {}) });
  const svG = (k, l, en, fi, test, g) => ({ ...svCol(k, l, `${en}\n${fi}`, test), ...(g ? { g } : {}) });
  const sa = p => p.saves + p.ga;
  const GK_SETS = {
    perus: ['Perustilastot', 'status', [
      G('toi', 'TOI', 'Time on Ice', 'Peliaika', p => dash(p, mmss(p.toi)), p => p.toi),
      G('sa', 'SA', 'Shots Against', 'Vastustajan laukaukset maalia kohti', p => dash(p, sa(p)), p => p.played ? sa(p) : -1),
      G('saves', 'SV', 'Saves', 'Torjunnat', p => dash(p, p.saves), p => p.played ? p.saves : -1),
      G('ga', 'GA', 'Goals Against', 'Päästetyt maalit', p => dash(p, p.ga), p => p.played ? p.ga : -1),
      G('sv', 'SV%', 'Save Percentage', 'Torjunnat / laukaukset maalia kohti', p => dash(p, pct(sa(p) ? p.saves / sa(p) : null, 1)), p => p.played && sa(p) ? p.saves / sa(p) : -1),
      G('gsax', 'GSAx', 'Goals Saved Above Expected', 'Torjutut maalit yli odotusten: xGA − päästetyt maalit', p => dash(p, `<span class="${cls(p.gsax)}">${signed(p.gsax, 2)}</span>`), p => p.played ? p.gsax : -99),
    ]],
    xg: ['Maaliodottama', 'gsax', [
      G('xga', 'xGA', 'Expected Goals Against', 'Päästetty maaliodottama kaikista vastustajan laukausyrityksistä', p => dash(p, num(p.xga, 2)), p => p.played ? p.xga : -1, 'Kaikki laukausyritykset'),
      G('gsax', 'GSAx', 'Goals Saved Above Expected', 'xGA − päästetyt maalit', p => dash(p, `<span class="${cls(p.gsax)}">${signed(p.gsax, 2)}</span>`), p => p.played ? p.gsax : -99, 'Kaikki laukausyritykset'),
      G('xgaSog', 'xGA', 'Expected Goals Against, Shots on Goal', 'Vain maalia kohti tulleista laukauksista. Mittaa maalivahtia reilummin, koska ohi menneet eivät ole mukana.', p => dash(p, num(p.xgaSog, 2)), p => p.played ? p.xgaSog : -1, 'Laukaukset maalia kohti'),
      G('gsaxSog', 'GSAx', 'Goals Saved Above Expected, Shots on Goal', 'Maalia kohti tulleiden laukausten xGA − päästetyt maalit', p => dash(p, `<span class="${cls(p.xgaSog - p.ga)}">${signed(p.xgaSog - p.ga, 2)}</span>`), p => p.played ? p.xgaSog - p.ga : -99, 'Laukaukset maalia kohti'),
      G('xgaPer', 'xGA/SA', 'Expected Goals Against per Shot', 'Vastustajan laukausten keskimääräinen vaarallisuus', p => dash(p, sa(p) ? num(p.xgaSog / sa(p), 3) : '–'), p => p.played && sa(p) ? p.xgaSog / sa(p) : -1, 'Laukaukset maalia kohti'),
    ]],
    tilanne: ['Tilanteittain', 'svEv', [
      svG('svEv', 'EV SV%', 'Even Strength Save Percentage', 'Torjuntaprosentti tasakentin', x => x.situ === 'TV'),
      svG('svPk', 'SH SV%', 'Short-Handed Save Percentage', 'Torjuntaprosentti alivoimalla', x => x.situ === 'YV'),
      svG('svPp', 'PP SV%', 'Power Play Save Percentage', 'Torjuntaprosentti ylivoimalla (vastustajan alivoimalaukaukset)', x => x.situ === 'AV'),
    ]],
    alue: ['Alueittain', 'svSlot', [
      svG('svSlot', 'HD SV%', 'High-Danger Save Percentage', 'Torjuntaprosentti maalin edustalta (NHL:n High-Danger: enintään 8,8 m maalin keskeltä)', x => x.zone === 'slot'),
      svG('svWing', 'Wing SV%', 'Save Percentage from the Wings', 'Torjuntaprosentti laidoilta (sivulinjojen ulkopuolelta)', x => x.zone === 'wing'),
      svG('svMid', 'MR SV%', 'Mid-Range Save Percentage', 'Torjuntaprosentti keskietäisyydeltä (8,8–13,1 m maalin keskeltä)', x => x.zone === 'mid'),
      svG('svLong', 'LR SV%', 'Long-Range Save Percentage', 'Torjuntaprosentti kaukaa (yli 13,1 m maalin keskeltä)', x => x.zone === 'long'),
      svG('svBehind', 'Behind SV%', 'Save Percentage from Behind the Net', 'Torjuntaprosentti maaliviivan takaa', x => x.zone === 'behind'),
    ]],
  };
  if (!GAME_SM.length) { delete GK_SETS.tilanne; delete GK_SETS.alue; }
  const gkBar = $('#gkSets', el);
  const drawGk = key => {
    GK_SET = key;
    gkBar.querySelectorAll('.sbtn').forEach(b => b.classList.toggle('active', b.dataset.k === key));
    const [, sortKey, cols] = GK_SETS[key];
    sortableTable($('#gkGameTable', el), a.goalies || [], [gkName, gkRole, ...cols, { k: 'gs', l: 'GS', t: 'Game Score\nPelipisteet: SaiPa-datan oma kokonaisarvio', f: p => dash(p, `<b>${num(p.gs, 2)}</b>`), s: p => p.played ? p.gs : -99 }], sortKey, p => p.played ? '' : 'idle');
  };
  gkBar.innerHTML = Object.entries(GK_SETS).map(([k, [l]]) => `<button class="sbtn" data-k="${k}">${l}</button>`).join('');
  gkBar.querySelectorAll('.sbtn').forEach(b => b.onclick = () => drawGk(b.dataset.k));
  drawGk(GK_SETS[GK_SET] ? GK_SET : 'perus');

  const noToi = p => !p.played;
  const lineupCols = cols => cols.map(c => c.k === 'last'
 ? c
    : { ...c, f: p => noToi(p) ? '<span class="muted">–</span>' : c.f(p), s: p => noToi(p) ? -999 : c.s(p) });
  const name = { k: 'last', l: 'Pelaaja', f: p => `${plink(p, `${esc(p.first)} ${esc(p.last)}`)}<span class="pos-chip">#${p.jersey ?? ''} ${esc(posEn(p.role))}</span>`, s: p => p.last };
  const gsCol = { k: 'gs', l: 'GS', t: 'Game Score\nPelipisteet: SaiPa-datan oma kokonaisarvio pelaajan ottelusta', f: p => `<b>${num(p.gs, 2)}</b>`, s: p => p.gs };
  const SETS = skaterSets(a.lineup || skaters, { teamXg: period == null ? full.teamXg : null, oppXg: period == null ? full.oppXg : null, per60: true });
  const setBar = $('#skSets', el);
  const drawSet = key => {
    SK_SET = key;
    setBar.querySelectorAll('.sbtn').forEach(b => b.classList.toggle('active', b.dataset.k === key));
    const [, sortKey, cols] = SETS[key];
    sortableTable($('#gameTable', el), a.lineup || skaters, lineupCols([name, gsCol, ...cols]), sortKey, p => noToi(p) ? 'idle' : '');
  };
  setBar.innerHTML = Object.entries(SETS).map(([k, [l]]) => `<button class="sbtn" data-k="${k}">${l}</button>`).join('');
  setBar.querySelectorAll('.sbtn').forEach(b => b.onclick = () => drawSet(b.dataset.k));
  drawSet(SETS[SK_SET] ? SK_SET : 'perus');
}

function mvpCard(p, i) {
  const pos = COMPONENTS.map(c => ({ ...c, v: Math.max(0, p.comp[c.key] || 0) }));
  const tot = pos.reduce((s, c) => s + c.v, 0) || 1;
  const kv = p.goalie
    ? [['SV', p.saves], ['GA', p.ga], ['xGA', num(p.xga, 2)], ['GSAx', signed(p.gsax, 2)]]
    : [['G+A', `${p.g}+${p.a}`], [p.sog == null ? 'iCF' : 'SOG', p.sog == null ? p.shots : p.sog], ['xG', num(p.ixg, 2)], ['C+/-', signed(p.cf - p.ca, 0) + (p.corsiOk === false ? '*' : '')], ['TOI', mmss(p.toi)]];
  return `<div class="mvp ${i === 0 ? 'first' : ''}">
    <div class="rank">${i + 1}.</div>
    <div class="name">${plink(p, `${esc(p.first)} ${esc(p.last)}`)}</div>
    <div class="pos">#${p.jersey ?? ''} ${esc(p.role)}</div>
    <div class="big">${num(p.gs, 2)} <small>pelipistettä</small></div>
    <div class="bar">${pos.filter(c => c.v > 0).map(c => `<span style="width:${(c.v / tot) * 100}%;background:${c.color}" title="${c.label} ${num(c.v, 2)}"></span>`).join('')}</div>
    <div class="mvp-kv">${kv.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
  </div>`;
}
function legend() {
  return `<div class="legend">${COMPONENTS.map(c => `<span><i style="background:${c.color}"></i><b>${c.label}</b>&nbsp;${c.d}</span>`).join('')}</div>`;
}
function tile(icon, k, v, unit, p, sub = '', tone = '', tip = '') {
  return `<div class="tile ${tone}"${tip ? ` data-tip="${esc(tip)}"` : ''}>
    <div class="t-top"><span class="t-ic">${icon}</span><span class="k">${k}</span></div>
    <div class="v">${v}${unit ? `<small>${unit}</small>` : ''}</div>
    <div class="who">${p ? `<b>${esc(p.first + ' ' + p.last)}</b>` : ''}</div>
    ${sub ? `<div class="t-sub">${sub}</div>` : ''}
  </div>`;
}

/* ---------- season view ---------- */
let seasonDone = false;
async function renderSeason() {
  if (seasonDone) return;
  seasonDone = true;
  const box = $('#seasonContent');
  try {
    if (!saipaGames.length) await initGames();
    const games = await Promise.all(saipaGames.map(g => loadGame(g.id)));
    const chrono = [...games].sort((a, b) => a.start.localeCompare(b.start));
    const SUM = Object.keys(blankSkater(0)).filter(k => k !== 'id' && k !== 'toiP');
    const agg = new Map();
    for (const gm of chrono) {
      for (const p of gm.people) {
        const t = agg.get(p.id) || { ...person({}), ...blankSkater(p.id), goalie: p.goalie, gp: 0, gsSum: 0, gsBest: -99, topSpeed: 0, hardestShot: 0,
          a1: 0, a2: 0, sog: 0, sogGp: 0, miss: 0, shBlk: 0, smGp: 0, saves: 0, gaG: 0, xgaG: 0, xgaSog: 0, gsog: 0, starts: [] };
        Object.assign(t, { first: p.first, last: p.last, jersey: p.jersey, role: p.role, pic: p.pic });
        t.gp++; t.gsSum += p.gs; t.gsBest = Math.max(t.gsBest, p.gs);
        t.topSpeed = Math.max(t.topSpeed, p.topSpeed || 0); t.hardestShot = Math.max(t.hardestShot, p.hardestShot || 0);
        if (p.goalie) {
          t.goalie = true; t.toi += p.toi; t.saves += p.saves; t.gaG += p.ga; t.xgaG += p.xga; t.xgaSog += p.xgaSog || 0; t.gsog += p.sog;
          if (p.mvNo === 1 || (p.mvNo == null && p.toi >= 1800)) t.starts.push({ sa: p.saves + p.ga, sv: p.saves });
        } else {
          for (const k of SUM) t[k] += p[k] || 0;
          for (const c of COMPONENTS) t['c_' + c.key] = (t['c_' + c.key] || 0) + (p.comp?.[c.key] || 0);
          t.a1 += p.a1 || 0; t.a2 += p.a2 || 0;
          for (const [n, v] of Object.entries(p.toiP || {})) t.toiP[n] = (t.toiP[n] || 0) + v;
          if (p.sog != null) { t.sog += p.sog; t.sogGp++; }
          if (p.miss != null) { t.miss += p.miss; t.shBlk += p.shBlk || 0; t.smGp++; }
        }
        agg.set(p.id, t);
      }
    }
    MIN_TOI_SEASON = Math.min(MIN_TOI_MAX, MIN_TOI_PER_GAME * games.length);
    const all = [...agg.values()];
    const sk = all.filter(p => !p.goalie);
    const gks = all.filter(p => p.goalie);
    const streak = new Map(streaksData(chrono).map(x => [x.id, x]));
    for (const p of sk) {
      p.ssog = p.sog;
      if (!p.sogGp) p.sog = null;
      if (!p.smGp) { p.miss = null; p.shBlk = null; }
      p.pts = p.g + p.a;
      p.gs = p.gsSum;
      p.gsGp = p.gsSum / p.gp;
      p.fin = p.g - p.ixg;
      p.xgfPct = (p.xgf + p.xga) ? p.xgf / (p.xgf + p.xga) : null;
      p.cfPct = (p.cf + p.ca) ? p.cf / (p.cf + p.ca) : null;
      p.ixg60 = p.toi ? p.ixg / p.toi * 3600 : 0;
      p.g60 = p.toi ? p.g / p.toi * 3600 : 0;
      p.p60 = p.toi ? p.pts / p.toi * 3600 : 0;
      p.qual = p.toi >= MIN_TOI_SEASON;
      const st = streak.get(p.id) || {};
      p.l5 = st.l5pts || 0; p.l5gp = (st.l5 || []).length; p.drought = st.dry || 0; p.lastPtDate = [...(st.log || [])].reverse().find(x => x.pts)?.date;
    }
    // Quality start (Rob Vollman): a start with save % at least the league average, or at least .885 on 20 shots or fewer
    const lgGk = await getJSON(`/players/stats/summed/${SEASON}/${SEASON}/${TOURNAMENT}/true?dataType=basicStatsGk`).catch(() => []);
    const lgSv = (() => { const sv = lgGk.reduce((a, x) => a + (x.blockedOrSavedShots || 0), 0), ga = lgGk.reduce((a, x) => a + (x.goalsAgainst || 0), 0); return sv + ga ? sv / (sv + ga) : null; })();
    for (const p of gks) {
      p.gsGp = p.gsSum / p.gp; p.gsax = p.xgaG - p.gaG; p.sa = p.saves + p.gaG; p.svPct = p.sa ? p.saves / p.sa : null;
      p.gs_n = p.starts.length;
      p.qs = lgSv == null ? null : p.starts.filter(x => x.sa && (x.sv / x.sa >= lgSv || (x.sa <= 20 && x.sv / x.sa >= 0.885))).length;
      p.qsPct = p.qs != null && p.gs_n ? p.qs / p.gs_n : null;
    }
    for (const p of sk) p.badge = badge(p);
    const team = { xgf: games.reduce((a, g) => a + (g.teamXg || 0), 0), xga: games.reduce((a, g) => a + (g.oppXg || 0), 0) };

    // Highlights: the same names and rules as the preview's key players. Each tile shows the real leader of its
    // category (a player can lead more than one), and the hover lists the top three.
    const q = sk.filter(p => p.qual);
    const top9 = new Set([...sk].sort((a, b) => b.toi / b.gp - a.toi / a.gp).slice(0, 9).map(p => p.id));
    const nm = p => `${p.first} ${p.last}`;
    const HL = [
      ['⭐', 'Kauden kovin', 'GS/GP', sk.filter(p => p.gp >= 3).sort((a, b) => b.gsGp - a.gsGp), p => num(p.gsGp, 2), p => `${p.gp} ottelua`, 'Pelipisteet ottelua kohden, vähintään 3 ottelua'],
      ['🏆', 'Kultakypärä', 'P', [...sk].sort((a, b) => b.pts - a.pts || b.g - a.g), p => p.pts, p => `${p.g}+${p.a} · ${p.gp} ottelua`, 'Eniten pisteitä'],
      ['🔥', 'Kuumin juuri nyt', 'P', sk.filter(p => p.l5 >= 2).sort((a, b) => b.l5 - a.l5 || b.pts - a.pts), p => p.l5, p => `5 viime ottelua · kausi ${p.pts} P`, 'Eniten pisteitä viidessä viime ottelussa'],
      ['📈', 'Maalit vielä tulossa', 'G−xG', q.filter(p => p.ixg - p.g >= 0.5).sort((a, b) => a.fin - b.fin), p => signed(p.fin, 1), p => `xG ${num(p.ixg, 1)} · ${p.g} G`, 'Eniten maaleja alle maaliodottaman'],
      ['🎯', 'Viimeistelee yli odotusten', 'G−xG', q.filter(p => p.fin >= 1).sort((a, b) => b.fin - a.fin), p => signed(p.fin, 1), p => `${p.g} G · xG ${num(p.ixg, 1)}`, 'Eniten maaleja yli maaliodottaman'],
      ['⚡', 'Isoin maaliuhka', 'xG', sk.filter(p => p.ixg >= 1).sort((a, b) => b.ixg - a.ixg), p => num(p.ixg, 1), p => `${p.shots} iCF · ${p.g} G`, 'Eniten maaliodottamaa (xG) omista laukauksista'],
      ['🥶', 'Kylmä putki', 'GP', sk.filter(p => top9.has(p.id) && p.drought >= 3).sort((a, b) => b.drought - a.drought), p => p.drought, p => p.lastPtDate ? `viimeisin piste ${fiDate(p.lastPtDate)}` : 'ei pisteitä tällä kaudella', 'Pisin meneillään oleva putki ilman pisteitä, joukkueen 9 eniten pelaavaa'],
      ['🧤', 'Maalivahti', 'GSAx', [...gks].sort((a, b) => b.gsax - a.gsax), p => signed(p.gsax, 2), p => `SV% ${pct(p.svPct, 1)} · ${p.gp} GP`, 'Eniten torjuttuja maaleja yli odotusten'],
    ];
    const hl = HL.filter(h => h[3].length).map(([ic, k, unit, list, val, sub, rule]) => {
      const p = list[0];
      const tip = [`${ic} ${k}`, rule, ...list.slice(0, 3).map((x, i) => `${i + 1}. ${nm(x)}\t${val(x)} ${unit}`)].join('\n');
      return tile(ic, k, val(p), unit, p, sub(p), unit === 'GSAx' ? (p.gsax >= 0 ? 'pos' : 'neg') : '', tip);
    });
    const n = games.length;
    const sec = (k, html) => `<section class="ssec" data-s="${k}">${html}</section>`;

    box.innerHTML = `
      <div class="setbar season-tabs" id="seasonTabs" role="tablist" aria-label="Kauden osiot"></div>
      ${sec('yleis', `
      <div class="card">
        <h2><span class="tag">Kauden nostot</span> <span class="h2-sub">${n} ottelua${n < 10 ? ' · pieni otos' : ''}</span></h2>
        <div class="tiles s-hl" data-n="${hl.length}">${hl.join('')}</div>
      </div>
      <div class="card" id="trendCard"><h2>Kauden kulku</h2><p class="loading">Lasketaan…</p></div>
      <div class="card" id="streakCard"><h2>Putket ja vire</h2><p class="loading">Lasketaan…</p></div>
      <div class="card" id="attFcCard"><h2>Yleisöennuste</h2><p class="loading">Lasketaan…</p></div>`)}
      ${sec('pelaajat', `
      <div class="card">
        <h2>Kenttäpelaajat</h2>
        <div class="setbar" id="ssSets" role="tablist" aria-label="Tilastot"></div>
        <div class="setbar mode" id="ssMode" role="tablist" aria-label="Laskentatapa"></div>
        <div class="tablewrap" id="seasonTable"></div>
        <p class="muted small">Harmaa = alle ${Math.round(MIN_TOI_SEASON / 60)} min peliaikaa · 📈 maalit alle odotusten · 🎯 viimeistelee yli odotusten</p>
      </div>
      <div class="card">
        <h2>Viimeistely vs. maalipaikat</h2>
        ${quadrant(q)}
        <p class="muted small">Vähintään ${Math.round(MIN_TOI_SEASON / 60)} min peliaikaa · peliaika hoverissa</p>
      </div>
      <div class="card" id="lineCard"><h2>Ketjut ja parit</h2><p class="loading">Lasketaan…</p></div>
      <div class="card" id="leCard"><h2>Kokoonpanoeditori</h2><p class="loading">Ladataan…</p></div>`)}
      ${sec('mv', `
      <div class="card" id="gkCard">
        <h2>Maalivahdit</h2>
        <div class="setbar" id="sgSets" role="tablist" aria-label="Maalivahtitilastot"></div>
        <div class="tablewrap" id="gkTable"></div>
        <div id="gkMapCard"><p class="loading">Haetaan laukauskarttoja…</p></div>
      </div>`)}
      ${sec('joukkue', `
      <div class="card" id="profileCard"><h2>Mistä maalit syntyvät</h2><p class="loading">Haetaan koko liigan laukauskarttoja…</p></div>
      <div class="card" id="ctxCard"><h2>Reboundit ja nopeat hyökkäykset</h2><p class="loading">Haetaan koko liigan laukauskarttoja…</p></div>
      <div class="card" id="stateCard"><h2>Pelitilanteittain</h2><p class="loading">Lasketaan…</p></div>
      <div class="card" id="dsvCard"><h2>Sarjataulukko maalipaikkojen mukaan</h2><p class="loading">Lasketaan odotettuja pisteitä…</p></div>`)}
      ${sec('liiga', `
      <div class="card" id="fcTableCard"><h2>Sarjaennuste</h2><p class="loading">Simuloidaan loppukautta…</p></div>
      <div class="card" id="topCard"><h2>Liigan nopeimmat ja kovimmat</h2><p class="loading">Haetaan liigan tilastoja…</p></div>`)}`;

    // Section tabs
    const TABS = [['yleis', 'Yleiskuva'], ['pelaajat', 'Pelaajat'], ['mv', 'Maalivahdit'], ['joukkue', 'Joukkue'], ['liiga', 'Liiga']];
    const tabBar = $('#seasonTabs');
    const showSec = k => { SEASON_TAB = k; if (urlState().view === 'kausi' && !urlState().player) setUrl(viewUrl('kausi', k), false); tabBar.querySelectorAll('.sbtn').forEach(b => b.classList.toggle('active', b.dataset.k === k)); box.querySelectorAll('.ssec').forEach(s => { s.hidden = s.dataset.s !== k; }); };
    tabBar.innerHTML = TABS.map(([k, l]) => `<button class="sbtn" data-k="${k}">${l}</button>`).join('');
    tabBar.querySelectorAll('.sbtn').forEach(b => b.onclick = () => showSec(b.dataset.k));
    showSec(SEASON_TAB);

    SEASON_SK = sk;
    seasonExtras(gks);
    seasonInsights(games);
    drawSeasonSkaters(sk, team);
    { const el = $('#leCard'); if (el) { if (typeof renderLineupEditor === 'function') renderLineupEditor(el, sk).catch(e => { el.innerHTML = `<h2>Kokoonpanoeditori</h2><p class="neg-num">Lataus epäonnistui: ${esc(e.message)}</p>`; }); else el.remove(); } }
    drawSeasonGoalies(gks, null);
    { const el = $('#attFcCard'); if (el) { if (typeof renderAttendanceForecast === 'function') whenVisible(el, () => Promise.all([loadHistoryGames(), getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`)]).then(([hg, sc]) => renderAttendanceForecast(el, hg, sc)).catch(e => { el.innerHTML = `<h2>Yleisöennuste</h2><p class="neg-num">${esc(e.message)}</p>`; })); else el.remove(); } }
  } catch (e) {
    seasonDone = false;
    box.innerHTML = `<p class="neg-num">Kauden lataus epäonnistui: ${esc(e.message)}</p>`;
  }
}

// Season cards that need the whole league's data. Each card fails on its own without breaking the view.
async function seasonExtras(gks) {
  const put = (sel, title, html) => { const el = $(sel); if (el) el.innerHTML = `<h2>${title}</h2>${html}`; };
  const fail = (sel, title) => e => put(sel, title, `<p class="neg-num">Lataus epäonnistui: ${esc(e.message)}</p>`);
  const sched = await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`).catch(() => []);
  const stn = await getJSON(`/standings/?season=${SEASON}`).catch(() => ({}));
  const info = new Map((stn.season || []).map(t => [t.internalId, { name: t.teamName, logo: t.teamLogos?.lightBg || null, ranking: t.ranking }]));
  { const el = $('#fcTableCard'); if (el && typeof renderSeasonForecast === 'function') renderSeasonForecast(el, stn).catch(e => { el.innerHTML = `<h2>Sarjaennuste</h2><p class="neg-num">Lataus epäonnistui: ${esc(e.message)}</p>`; }); }
  try { put('#dsvCard', 'Sarjataulukko maalipaikkojen mukaan', deservedHtmlSeason(deservedTable(sched, info))); } catch (e) { fail('#dsvCard', 'Sarjataulukko maalipaikkojen mukaan')(e); }
  Promise.all(saipaGames.map(g => loadRaw(g.id)))
    .then(raws => put('#stateCard', 'Pelitilanteittain', stateHtml(stateSplits(raws))))
    .catch(fail('#stateCard', 'Pelitilanteittain'));
  whenVisible([$('#profileCard'), $('#ctxCard'), $('#gkCard')], () => loadLeagueShots().then(L => {
    put('#profileCard', 'Mistä maalit syntyvät', seasonProfileHtml(L));
    try { put('#ctxCard', 'Reboundit ja nopeat hyökkäykset', contextHtml(L, SEASON_SK)); } catch (e) { fail('#ctxCard', 'Reboundit ja nopeat hyökkäykset')(e); }
    drawSeasonGoalies(gks, L);
    const gm = $('#gkMapCard'); if (gm) gm.innerHTML = `<h3>Laukaukset kartalla</h3>${goalieMapsHtml(L, [...gks].sort((a, b) => b.toi - a.toi))}`;
  }).catch(e => { fail('#profileCard', 'Mistä maalit syntyvät')(e); fail('#ctxCard', 'Reboundit ja nopeat hyökkäykset')(e); const gm = $('#gkMapCard'); if (gm) gm.innerHTML = `<p class="neg-num">Laukauskarttojen lataus epäonnistui: ${esc(e.message)}</p>`; }));
}

function badge(p) {
  if (!p.qual) return '';
  if (p.ixg >= 0.8 && p.fin <= -0.8) return `<span class="emo" data-tip="📈 Maalit vielä tulossa\nG−xG\t${signed(p.fin, 1)}">📈</span>`;
  if (p.fin >= 1.2) return `<span class="emo" data-tip="🎯 Viimeistelee yli odotusten\nG−xG\t${signed(p.fin, 1)}">🎯</span>`;
  return '';
}

let SEASON_TAB = 'yleis', SS_SET = 'perus', SS_MODE = 'tot', SG_SET = 'perus';

// Per game / per 60 copies of the season rows. Maxima, ratios and game counts are not scaled; TOI stays a total in per-60 mode.
const NO_SCALE = new Set(['id', 'gp', 'jersey', 'topSpeed', 'hardestShot', 'gsBest', 'sogGp', 'smGp', 'l5', 'l5gp', 'drought', 'qual', 'xgfPct', 'cfPct', 'ixg60', 'g60', 'p60', 'gsGp', 'fin']);
function scaleRow(p, mode) {
  if (mode === 'tot') return p;
  const d = mode === 'gp' ? p.gp : p.toi / 3600;
  if (!d) return p;
  const o = { ...p, _raw: p };
  for (const [k, v] of Object.entries(p)) if (typeof v === 'number' && !NO_SCALE.has(k) && !(mode === '60' && k === 'toi')) o[k] = v / d;
  o.toiP = Object.fromEntries(Object.entries(p.toiP || {}).map(([k, v]) => [k, mode === '60' ? v : v / d]));
  if (p.sog != null && mode === 'gp') o.sog = p.sog / p.sogGp;
  return o;
}

// Season skater table: the game report's stat sets, as totals, per game or per 60 minutes
function drawSeasonSkaters(sk, team) {
  const name = { k: 'last', l: 'Pelaaja', f: p => `${plink(p, `${esc(p.first)} ${esc(p.last)}`)}<span class="pos-chip">#${p.jersey ?? ''} ${esc(posEn(p.role))}</span> ${p.badge || ''}`, s: p => p.last };
  const gpCol = { k: 'gp', l: 'GP', t: 'Games Played\nOttelut', f: p => p.gp, s: p => p.gp };
  const MODES = [['tot', 'Yhteensä'], ['gp', 'Per ottelu'], ['60', 'Per 60 min']];
  const setBar = $('#ssSets'), modeBar = $('#ssMode');
  const draw = () => {
    const rows = sk.map(p => scaleRow(p, SS_MODE));
    const SETS = skaterSets(rows, { teamXg: team.xgf, oppXg: team.xga });
    if (!SETS[SS_SET]) SS_SET = 'perus';
    const gsCol = { k: 'gs', l: SS_MODE === 'tot' ? 'GS' : SS_MODE === 'gp' ? 'GS/GP' : 'GS/60', t: 'Game Score\nPelipisteet: SaiPa-datan oma kokonaisarvio', f: p => `<b>${num(p.gs, 2)}</b>`, s: p => p.gs, heat: true };
    setBar.innerHTML = Object.entries(SETS).map(([k, [l]]) => `<button class="sbtn${k === SS_SET ? ' active' : ''}" data-k="${k}">${l}</button>`).join('');
    modeBar.innerHTML = MODES.map(([k, l]) => `<button class="sbtn sm${k === SS_MODE ? ' active' : ''}" data-k="${k}">${l}</button>`).join('');
    setBar.querySelectorAll('.sbtn').forEach(b => b.onclick = () => { SS_SET = b.dataset.k; draw(); });
    modeBar.querySelectorAll('.sbtn').forEach(b => b.onclick = () => { SS_MODE = b.dataset.k; draw(); });
    const [, sortKey, cols] = SETS[SS_SET];
    sortableTable($('#seasonTable'), rows, [name, gpCol, gsCol, ...cols], sortKey, p => p.qual ? '' : 'idle');
  };
  draw();
}

// Season goalie table with stat sets. L = league shot maps (situation and zone splits), added when loaded.
function drawSeasonGoalies(gks, L) {
  const faced = new Map(gks.map(g => [g.id, []]));
  if (L) for (const g of L.ended) {
    if (teamNum(g.homeTeamId) !== SAIPA_NUM && teamNum(g.awayTeamId) !== SAIPA_NUM) continue;
    for (const x of L.shots.get(g.id) || []) if (x.shootingTeamId !== SAIPA_NUM && isSog(x) && faced.has(x.blockerId)) faced.get(x.blockerId).push(normShot(x));
  }
  // League rebounds per 100 saves (all goalies)
  let lgSv = 0, lgRb = 0;
  if (L) for (const sm of L.shots.values()) for (const x of sm) if (x.eventType === 'GOALIE_BLOCKED') { lgSv++; if (x.rebAllowed) lgRb++; }
  const LG_RB100 = lgSv ? lgRb / lgSv * 100 : null;
  const G = (k, l, en, fi, f, sv, g) => ({ k, l, t: `${en}${fi ? '\n' + fi : ''}`, f, s: sv, ...(g ? { g } : {}) });
  const svG = (k, l, en, fi, test) => G(k, l, en, fi, p => { const f = (faced.get(p.id) || []).filter(test), sv = f.filter(x => !x.goal).length; return f.length ? `${pct(sv / f.length, 1)} <small class="muted">${sv}/${f.length}</small>` : '–'; },
    p => { const f = (faced.get(p.id) || []).filter(test); return f.length ? f.filter(x => !x.goal).length / f.length : -1; });
  const name = { k: 'last', l: 'Maalivahti', f: p => `${plink(p, `${esc(p.first)} ${esc(p.last)}`)}<span class="pos-chip">#${p.jersey ?? ''}</span>`, s: p => p.last };
  const SETS = {
    perus: ['Perustilastot', 'gsax', [
      G('gp', 'GP', 'Games Played', 'Ottelut', p => p.gp, p => p.gp),
      G('toi', 'TOI', 'Time on Ice', 'Peliaika', p => mmss(p.toi), p => p.toi),
      G('sa', 'SA', 'Shots Against', 'Vastustajan laukaukset maalia kohti', p => p.sa, p => p.sa),
      G('saves', 'SV', 'Saves', 'Torjunnat', p => p.saves, p => p.saves),
      G('gaG', 'GA', 'Goals Against', 'Päästetyt maalit', p => p.gaG, p => p.gaG),
      G('svPct', 'SV%', 'Save Percentage', 'Torjunnat / laukaukset maalia kohti', p => pct(p.svPct, 1), p => p.svPct ?? 0),
      G('gaa', 'GAA', 'Goals Against Average', 'Päästetyt maalit 60 minuuttia kohden', p => p.toi ? num(p.gaG / p.toi * 3600, 2) : '–', p => p.toi ? -p.gaG / p.toi : -99),
      G('gsax', 'GSAx', 'Goals Saved Above Expected', 'xGA − päästetyt maalit', p => `<span class="${cls(p.gsax)}">${signed(p.gsax, 2)}</span>`, p => p.gsax),
      G('gsGp', 'GS/GP', 'Game Score per Game', 'Pelipisteet ottelua kohden', p => `<b>${num(p.gsGp, 2)}</b>`, p => p.gsGp),
    ]],
    xg: ['Maaliodottama', 'gsax', [
      G('xgaG', 'xGA', 'Expected Goals Against', 'Kaikista vastustajan laukausyrityksistä', p => num(p.xgaG, 2), p => p.xgaG, 'Kaikki laukausyritykset'),
      G('gsax', 'GSAx', 'Goals Saved Above Expected', 'xGA − päästetyt maalit', p => `<span class="${cls(p.gsax)}">${signed(p.gsax, 2)}</span>`, p => p.gsax, 'Kaikki laukausyritykset'),
      G('gsax60', 'GSAx/60', 'GSAx per 60', 'Torjutut maalit yli odotusten 60 minuuttia kohden', p => p.toi ? signed(p.gsax / p.toi * 3600, 2) : '–', p => p.toi ? p.gsax / p.toi : -99, 'Kaikki laukausyritykset'),
      G('xgaSog', 'xGA', 'Expected Goals Against, Shots on Goal', 'Vain maalia kohti tulleista laukauksista', p => num(p.xgaSog, 2), p => p.xgaSog, 'Laukaukset maalia kohti'),
      G('gsaxSog', 'GSAx', 'Goals Saved Above Expected, Shots on Goal', 'Maalia kohti tulleiden laukausten xGA − päästetyt maalit', p => `<span class="${cls(p.xgaSog - p.gaG)}">${signed(p.xgaSog - p.gaG, 2)}</span>`, p => p.xgaSog - p.gaG, 'Laukaukset maalia kohti'),
      G('xgaPer', 'xGA/SA', 'Expected Goals Against per Shot', 'Vastustajan laukausten keskimääräinen vaarallisuus', p => p.sa ? num(p.xgaSog / p.sa, 3) : '–', p => p.sa ? p.xgaSog / p.sa : -1, 'Laukaukset maalia kohti'),
    ]],
    qs: ['Laatutorjunnat', 'qsPct', [
      G('gs_n', 'GS', 'Games Started', 'Aloitukset', p => p.gs_n, p => p.gs_n),
      G('qs', 'QS', 'Quality Starts', 'Aloitukset, joissa SV% oli vähintään liigan keskiarvo, tai vähintään 88,5 % kun laukauksia oli enintään 20', p => p.qs ?? '–', p => p.qs ?? -1),
      G('qsPct', 'QS%', 'Quality Start Percentage', 'Laatutorjunnat / aloitukset. Noin 60 % on hyvä taso.', p => pct(p.qsPct, 0), p => p.qsPct ?? -1),
    ]],
    ...(L ? {
      reb: ['Reboundit', 'rb100', [
        G('svN', 'SV', 'Saves', 'Torjunnat laukauskartallisissa otteluissa', p => (faced.get(p.id) || []).filter(x => !x.goal).length, p => (faced.get(p.id) || []).filter(x => !x.goal).length),
        G('rba', 'RBA', 'Rebounds Allowed', 'Torjunnat, joista vastustaja laukoi uudelleen enintään 3 s sisällä', p => (faced.get(p.id) || []).filter(x => x.rebAllowed).length, p => (faced.get(p.id) || []).filter(x => x.rebAllowed).length),
        G('rb100', 'RB/100', 'Rebounds per 100 Saves', `Reboundit 100 torjuntaa kohden. Pienempi on parempi. Liigan keskiarvo ${num(LG_RB100, 1)}.`, p => { const f = faced.get(p.id) || [], sv = f.filter(x => !x.goal).length; return sv ? num(f.filter(x => x.rebAllowed).length / sv * 100, 1) : '–'; },
          p => { const f = faced.get(p.id) || [], sv = f.filter(x => !x.goal).length; return sv ? -f.filter(x => x.rebAllowed).length / sv : -99; }),
        G('rbga', 'RBGA', 'Rebound Goals Against', 'Päästetyt maalit reboundeista', p => (faced.get(p.id) || []).filter(x => x.goal && x.reb).length, p => -(faced.get(p.id) || []).filter(x => x.goal && x.reb).length),
      ]],
      tilanne: ['Tilanteittain', 'svEv', [
        svG('svEv', 'EV SV%', 'Even Strength Save Percentage', 'Torjuntaprosentti tasakentin', x => x.situ === 'TV'),
        svG('svPk', 'SH SV%', 'Short-Handed Save Percentage', 'Torjuntaprosentti alivoimalla', x => x.situ === 'YV'),
        svG('svPp', 'PP SV%', 'Power Play Save Percentage', 'Torjuntaprosentti ylivoimalla', x => x.situ === 'AV'),
      ]],
      alue: ['Alueittain', 'svSlot', [
        svG('svSlot', 'HD SV%', 'High-Danger Save Percentage', 'Torjuntaprosentti maalin edustalta (NHL:n High-Danger: enintään 8,8 m maalin keskeltä)', x => x.zone === 'slot'),
        svG('svWing', 'Wing SV%', 'Save Percentage from the Wings', 'Torjuntaprosentti laidoilta (sivulinjojen ulkopuolelta)', x => x.zone === 'wing'),
        svG('svMid', 'MR SV%', 'Mid-Range Save Percentage', 'Torjuntaprosentti keskietäisyydeltä (8,8–13,1 m maalin keskeltä)', x => x.zone === 'mid'),
        svG('svLong', 'LR SV%', 'Long-Range Save Percentage', 'Torjuntaprosentti kaukaa (yli 13,1 m maalin keskeltä)', x => x.zone === 'long'),
        svG('svBehind', 'Behind SV%', 'Save Percentage from Behind the Net', 'Torjuntaprosentti maaliviivan takaa', x => x.zone === 'behind'),
      ]],
    } : {}),
  };
  const bar = $('#sgSets');
  if (!bar) return;
  const draw = () => {
    if (!SETS[SG_SET]) SG_SET = 'perus';
    bar.innerHTML = Object.entries(SETS).map(([k, [l]]) => `<button class="sbtn${k === SG_SET ? ' active' : ''}" data-k="${k}">${l}</button>`).join('');
    bar.querySelectorAll('.sbtn').forEach(b => b.onclick = () => { SG_SET = b.dataset.k; draw(); });
    const [, sortKey, cols] = SETS[SG_SET];
    sortableTable($('#gkTable'), gks, [name, ...cols], sortKey);
  };
  draw();
}

// Finishing vs. chances: season xG on x, goals on y, diagonal = finishing as expected. Equal-size dots with the
// jersey number, drawn exactly at their values: players with the same numbers overlap, and the hover lists them all.
const QUAD = new Map();
function quadrant(players) {
  if (!players.length) return '<p class="muted">Ei vielä tarpeeksi peliaikaa.</p>';
  const id = 'q' + Math.random().toString(36).slice(2, 8);
  const Wd = 760, H = 460, m = { l: 46, r: 20, t: 16, b: 46 };
  const max = Math.max(2, ...players.map(p => Math.max(p.ixg, p.g))) * 1.08, lo = -0.5;
  const x = v => m.l + (v - lo) / (max - lo) * (Wd - m.l - m.r);
  const y = v => H - m.b - (v - lo) / (max - lo) * (H - m.t - m.b);
  const step = max > 16 ? 4 : max > 8 ? 2 : 1, ticks = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  const R = 9;
  const pts = players.map(p => ({ p, cx: x(p.ixg), cy: y(p.g), r: R })).sort((a, b) => b.p.toi - a.p.toi);
  QUAD.set(id, pts.map(({ p, cx, cy }) => ({ cx, cy, tip: `#${p.jersey ?? ''} ${p.first} ${p.last}\nG\t${p.g}\nxG\t${num(p.ixg, 2)}\nG − xG\t${signed(p.fin, 2)}\niCF\t${p.shots}\nTOI\t${Math.round(p.toi / 60)} min` })));
  const dots = pts.map(({ p, cx, cy, r }) => {
    const col = p.fin >= 0 ? 'var(--good)' : 'var(--bad)';
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}" fill-opacity=".8" stroke="#fff" stroke-width="1.5"/><text x="${cx}" y="${cy + 4}" class="q-no">${p.jersey ?? ''}</text>`;
  }).join('');
  // Players at exactly the same spot hide each other, so a small badge tells how many are there
  const stacks = new Map();
  for (const q of pts) { const k = `${Math.round(q.cx)},${Math.round(q.cy)}`; stacks.set(k, [...(stacks.get(k) || []), q]); }
  const badges = [...stacks.values()].filter(v => v.length > 1).map(v => `<g class="q-cnt"><circle cx="${v[0].cx + R * .8}" cy="${v[0].cy - R * .8}" r="6.5"/><text x="${v[0].cx + R * .8}" y="${v[0].cy - R * .8 + 3}">${v.length}</text></g>`).join('');
  return `<svg class="quad" id="${id}" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Viimeistely vs. maalipaikat">
    <rect x="${m.l}" y="${m.t}" width="${Wd - m.l - m.r}" height="${H - m.t - m.b}" fill="#fcfcf9" stroke="#e4e4e0"/>
    ${ticks.map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${H - m.b}" stroke="#eee"/><line x1="${m.l}" x2="${Wd - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eee"/>
      <text x="${x(v)}" y="${H - m.b + 16}" font-size="11" text-anchor="middle" fill="#6b6b6b">${v}</text>
      <text x="${m.l - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#6b6b6b">${v}</text>`).join('')}
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(max)}" y2="${y(max)}" stroke="#111" stroke-dasharray="5 4"/>
    <text x="${m.l + 10}" y="${m.t + 18}" font-size="12" font-weight="600" fill="var(--good)">Yli odotusten</text>
    <text x="${Wd - m.r - 10}" y="${H - m.b - 10}" font-size="12" font-weight="600" text-anchor="end" fill="var(--bad)">Alle odotusten</text>
    ${dots}${badges}
    <circle class="q-hl" r="0" cx="0" cy="0"/>
    <rect class="q-hit" x="${m.l}" y="${m.t}" width="${Wd - m.l - m.r}" height="${H - m.t - m.b}" data-tip=""/>
    <text x="${(Wd + m.l) / 2}" y="${H - 8}" font-size="12" text-anchor="middle" fill="#333">xG (maaliodottama)</text>
    <text x="14" y="${(H - m.b) / 2}" font-size="12" text-anchor="middle" fill="#333" transform="rotate(-90 14 ${(H - m.b) / 2})">G (maalit)</text>
  </svg>`;
}
// Snap the scatter hover to the nearest player; runs before the shared tooltip handler (capture phase)
document.addEventListener('mousemove', e => {
  const r = e.target.closest?.('.q-hit');
  if (!r) return;
  const svg = r.ownerSVGElement, pts = QUAD.get(svg.id);
  if (!pts) return;
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const c = pt.matrixTransform(svg.getScreenCTM().inverse());
  const near = pts.map(q => ({ q, d: Math.hypot(q.cx - c.x, q.cy - c.y) })).sort((a, b) => a.d - b.d);
  const hl = svg.querySelector('.q-hl'), hr = 12;
  if (!near.length || near[0].d > 40) { r.setAttribute('data-tip', ''); hl.setAttribute('r', 0); tipEl.style.display = 'none'; return; }
  const n0 = near[0].q, same = near.filter(n => Math.hypot(n.q.cx - n0.cx, n.q.cy - n0.cy) < 10).map(n => n.q.tip);
  r.setAttribute('data-tip', same.join('\n\n'));
  hl.setAttribute('cx', n0.cx); hl.setAttribute('cy', n0.cy); hl.setAttribute('r', hr);
  showTip(e);
}, true);
document.addEventListener('mouseout', e => { if (e.target.classList?.contains('q-hit')) { const hl = e.target.ownerSVGElement?.querySelector('.q-hl'); if (hl) hl.setAttribute('r', 0); } });

/* ---------- reconciliation against official stats ---------- */
let reconPromise = null;
function runReconcile(games) {
  if (!reconPromise) reconPromise = reconcile(games).catch(e => ({ error: e.message }));
  return reconPromise;
}

function sumPlayers(games) {
  const m = new Map();
  for (const gm of games) for (const p of gm.people) {
    const t = m.get(p.id) || { gp: 0, g: 0, a: 0, shots: 0, toi: 0, xg: 0, ga: 0, saves: 0, xga: 0, name: `${p.first} ${p.last}` };
    t.gp++; t.toi += p.toi;
    if (p.goalie) { t.ga += p.ga; t.saves += p.saves; t.xga += p.xga; }
    else { t.g += p.g; t.a += p.a; t.shots += p.shots; t.xg += p.ixg; }
    m.set(p.id, t);
  }
  return m;
}

async function reconcile(games) {
  const [skAll, gkAll] = await Promise.all([
    getJSON(`/players/stats/summed/${SEASON}/${SEASON}/${TOURNAMENT}/true?dataType=basicStats`),
    getJSON(`/players/stats/summed/${SEASON}/${SEASON}/${TOURNAMENT}/true?dataType=basicStatsGk`),
  ]);
  const offSk = skAll.filter(p => p.teamId === SAIPA_NUM && !p.goalkeeper && (p.playedGames || 0) > 0);
  const offGk = gkAll.filter(p => p.teamId === SAIPA_NUM && (p.playedGames || 0) > 0);
  // Official season stats update with a delay, and not all fields at once.
  // Each value is therefore compared against all games and against all games except the latest.
  const all = sumPlayers(games);
  const lag = games.length > 1 ? sumPlayers(games.slice(1)) : all;
  const diffs = [], lagFields = new Set();
  const chk = (id, name, field, official, key, tol = 0) => {
    const a = all.get(id)?.[key] || 0, b = lag.get(id)?.[key] || 0;
    const ok = v => Math.abs((official || 0) - v) <= tol;
    if (ok(a)) return;
    if (ok(b)) { lagFields.add(field); return; }
    diffs.push({ name, field, official, ours: key === 'xg' || key === 'xga' ? +a.toFixed(2) : a });
  };
  for (const o of offSk) {
    const n = `${o.firstName} ${o.lastName}`, id = o.playerId, gp = all.get(id)?.gp || 1;
    chk(id, n, 'Ottelut', o.playedGames, 'gp');
    chk(id, n, 'Maalit', o.goals, 'g');
    chk(id, n, 'Syötöt', o.assists, 'a');
    chk(id, n, 'Laukausyritykset', o.shots, 'shots');
    chk(id, n, 'Peliaika (s)', o.timeOnIce, 'toi', 3 * gp);
    chk(id, n, 'xG', o.expectedGoals, 'xg', 0.03);
  }
  for (const o of offGk) {
    const n = `${o.firstName} ${o.lastName}`, id = o.playerId;
    chk(id, n, 'Ottelut', o.playedGames, 'gp');
    chk(id, n, 'Päästetyt maalit', o.goalsAgainst, 'ga');
    chk(id, n, 'Torjunnat', o.blockedOrSavedShots, 'saves');
    chk(id, n, 'xGA', o.expectedGoalsAgainst, 'xga', 0.05);
  }
  const offIds = new Set([...offSk, ...offGk].map(o => o.playerId));
  for (const [id, m] of all) if (!offIds.has(id) && !(lag.get(id) == null)) diffs.push({ name: m.name, field: 'Puuttuu virallisista', official: '–', ours: `${m.gp} ott.` });
  return { players: offIds.size, games: games.length, latest: games[0], lagFields: [...lagFields], diffs, at: new Date() };
}

function reconHtml(r) {
  if (r.error) return `<p class="neg-num">Täsmäytys epäonnistui: ${esc(r.error)}</p>`;
  const lag = r.lagFields.length
    ? `<p class="muted">Liigan virallinen kausitilasto päivittyy viiveellä: viimeisin ottelu (${fiDate(r.latest.start)} vs. ${esc(r.latest.opp.teamName)}) puuttuu vielä seuraavista luvuista: ${r.lagFields.join(', ').toLowerCase()}. Ne täsmäävät, kun ottelu jätetään vertailusta pois.</p>`
    : '';
  const head = r.diffs.length
    ? `<p><span class="badge b-luck">${r.diffs.length} poikkeamaa</span> ${r.players} pelaajaa ja ${r.games} ottelua verrattu liiga.fi:n virallisiin kausitilastoihin.</p>`
    : `<p><span class="badge b-hot">Täsmää</span> ${r.players} pelaajaa ja ${r.games} ottelua: ottelut, maalit, syötöt, laukausyritykset, peliaika ja xG sekä maalivahtien päästetyt maalit, torjunnat ja xGA vastaavat liiga.fi:n virallisia kausitilastoja.</p>`;
  const table = r.diffs.length
    ? `<div class="tablewrap"><table class="data"><thead><tr><th>Pelaaja</th><th>Tieto</th><th>Virallinen</th><th>Laskettu</th></tr></thead><tbody>${r.diffs.map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.field)}</td><td>${esc(d.official)}</td><td>${esc(d.ours)}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  return head + lag + table;
}

/* ---------- sortable table ---------- */
// Columns: k key, l label, t header tooltip, f cell html, s sort value, g column group (drawn as a header row
// with separators), heat (tint the cell by its rank in the column, best = strongest yellow; idle rows excluded).
function sortableTable(el, rows, cols, initial, rowClass = () => '') {
  let key = initial, desc = true;
  const groups = cols.some(c => c.g);
  const gStart = cols.map((c, i) => groups && i > 0 && c.g !== cols[i - 1].g);
  const heat = new Map(cols.filter(c => c.heat).map(c => {
    const vals = rows.filter(r => !rowClass(r)).map(c.s).sort((a, b) => a - b);
    return [c.k, v => vals.length > 1 ? Math.max(0, vals.findIndex(x => x >= v)) / (vals.length - 1) : 0];
  }));
  const tint = (c, r) => {
    if (!heat.has(c.k) || rowClass(r)) return '';
    const q = heat.get(c.k)(c.s(r));
    return q >= 0.5 ? ` style="background:rgba(255,210,0,${((q - 0.5) * 0.9).toFixed(2)})"` : '';
  };
  const draw = () => {
    const c = cols.find(c => c.k === key);
    const sorted = [...rows].sort((a, b) => {
      const va = c.s(a), vb = c.s(b);
      const r = typeof va === 'string' ? va.localeCompare(vb, 'fi') : va - vb;
      return desc ? -r : r;
    });
    const gRow = groups ? `<tr class="grp">${cols.reduce((acc, c, i) => {
      if (i > 0 && c.g === cols[i - 1].g) { acc[acc.length - 1].n++; return acc; }
      acc.push({ g: c.g || '', n: 1, i }); return acc;
    }, []).map(x => `<th colspan="${x.n}" class="${gStart[x.i] ? 'gs' : ''}">${esc(x.g.trim())}</th>`).join('')}</tr>` : '';
    el.innerHTML = `<table class="data"><thead>${gRow}<tr>${cols.map((c, i) => `<th data-k="${c.k}" class="${c.k === key ? 'sorted' : ''} ${gStart[i] ? 'gs' : ''}"${c.t ? ` data-tip="${esc(c.t)}"` : ''}>${c.l}${c.k === key ? (desc ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead>
      <tbody>${sorted.map(r => `<tr class="${rowClass(r)}">${cols.map((c, i) => `<td class="${gStart[i] ? 'gs' : ''}"${tint(c, r)}>${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    el.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      if (k === key) desc = !desc; else { key = k; desc = k !== 'last'; }
      draw();
    });
  };
  draw();
}

/* ---------- navigation ---------- */
// The address always matches what is on screen, so any view can be linked and Back works:
// ?game=ID&tab=preview|report, ?view=season&tab=players, ?view=history, ?view=metrics, ?player=ID
let LAST_HUB = '';   // address of the game view, restored when coming back to it
function viewUrl(view, sub) {
  if (view === 'pelaaja') return location.search;
  if (view === 'ottelu') return LAST_HUB || (urlState().game ? location.search : location.pathname);
  const u = new URLSearchParams({ view: URL_VIEW[view] || view });
  if (sub) u.set('tab', URL_TAB[sub] || sub);
  if (view === 'historia' && typeof HIST_DATE !== 'undefined' && HIST_DATE) u.set('date', HIST_DATE);
  if (view === 'live') { const id = (urlState().view === 'live' && urlState().id) || (typeof liveSelected === 'function' ? liveSelected() : null); if (id) u.set('id', id); }
  return '?' + u.toString();
}
function setUrl(url, push) {
  if (url === location.search || (url === location.pathname && !location.search)) return;
  push ? history.pushState({}, '', url) : history.replaceState({}, '', url);
}
function show(view, push = false) {
  setUrl(viewUrl(view, view === 'kausi' ? SEASON_TAB : ''), push);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'kausi') renderSeason();
  if (view === 'historia') renderHistory();
  if (view === 'info' && typeof renderForecastTrack === 'function') renderForecastTrack($('#fcTrack'));
  if (typeof liveResume === 'function') liveResume(view);
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => show(t.dataset.view, true));
// Back / Forward: redraw the view the address points to
window.addEventListener('popstate', () => {
  const st = urlState();
  if (st.player) return openPlayer(st.player, false);
  if (st.view === 'kausi' && st.tab) { SEASON_TAB = st.tab; document.querySelector(`#seasonTabs .sbtn[data-k="${SEASON_TAB}"]`)?.click(); }
  if (st.view === 'ottelu' && st.game) { if ($('#gameSelect').value !== st.game) $('#gameSelect').value = st.game; renderHub(st.game, st.tab); }
  show(st.view);
});
// Initial view: a game link opens the game view, otherwise the preview
window.addEventListener('DOMContentLoaded', () => {
  const qs = new URLSearchParams(location.search);
  const st = urlState();
  if (st.view === 'kausi' && st.tab) SEASON_TAB = st.tab;
  if (st.player) openPlayer(st.player, false);
  else show(st.view);
});
$('#updated').textContent = 'Päivitetty ' + new Date().toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' });
initGames()
  .then(() => Promise.all(saipaGames.map(g => loadGame(g.id))))
  .catch(e => { if (!saipaGames.length) $('#gameContent').innerHTML = `<p class="neg-num">Otteluohjelman lataus epäonnistui: ${esc(e.message)}</p>`; });
