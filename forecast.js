/* SaiPa Data: game forecast (PR-8).
 * Uses only the league schedule: goals and xG of every played game. Parameters were picked on the 2024–25
 * season and tested on 2025–26 (see the Mittarit page). The backtest is recomputed live on every load. */

const FC = { k: 10, w: 0.5, r: 0.2, d: 0.4, otHome: 0.5 };
// k = prior weight in games, w = weight of real goals vs. xG, r = share of last season carried over,
// d = tie inflation (Poisson alone gives too few ties), otHome = share of OT/SO games won by the home team.

const fcGoals = g => {
  let h = g.homeTeamGoals, a = g.awayTeamGoals;
  if (g.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION') { if (h > a) h--; else a--; }  // the shootout goal is not a game goal
  return [h, a];
};
const fcResult = g => g.finishedType === 'ENDED_DURING_REGULAR_GAME_TIME' ? (g.homeTeamGoals > g.awayTeamGoals ? 'H' : 'A') : 'T';
const fcPlayed = sched => sched.filter(g => g.ended && g.expectedHomeTeamGoals != null).sort((a, b) => a.start.localeCompare(b.start));

function fcGrid(lh, la) {
  const m = [];
  let s = 0;
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
    const p = poisson(lh, i) * poisson(la, j) * (i === j ? 1 + FC.d : 1);
    m.push({ i, j, p }); s += p;
  }
  for (const c of m) c.p /= s;
  return m;
}
function fcProbs(lh, la) {
  const m = fcGrid(lh, la);
  const H = m.filter(c => c.i > c.j).reduce((s, c) => s + c.p, 0), T = m.filter(c => c.i === c.j).reduce((s, c) => s + c.p, 0);
  return { H, T, A: 1 - H - T, top: m.sort((a, b) => b.p - a.p).slice(0, 3) };
}

// Replays a season game by game. Ratings before each game use only earlier games plus last season as a prior.
function fcReplay(prevSched, curSched, onGame = () => {}) {
  const prev = fcPlayed(prevSched), cur = fcPlayed(curSched);
  if (!prev.length) return null;
  let hg = 0, ag = 0, hx = 0, ax = 0;
  for (const g of prev) { const [h, a] = fcGoals(g); hg += h; ag += a; hx += g.expectedHomeTeamGoals; ax += g.expectedAwayTeamGoals; }
  const n0 = prev.length, mu = (hg + ag) / (2 * n0);
  const L = { mu, hf: hg / (n0 * mu), af: ag / (n0 * mu), sc: mu / ((hx + ax) / (2 * n0)) };
  const mix = (x, gl) => FC.w * gl + (1 - FC.w) * x * L.sc;   // xG scaled to goal level
  const pt = new Map();
  for (const g of prev) {
    const [h, a] = fcGoals(g);
    for (const [id, f, x, xf, xa] of [[teamNum(g.homeTeamId), h, a, g.expectedHomeTeamGoals, g.expectedAwayTeamGoals], [teamNum(g.awayTeamId), a, h, g.expectedAwayTeamGoals, g.expectedHomeTeamGoals]]) {
      const t = pt.get(id) || pt.set(id, { n: 0, f: 0, a: 0 }).get(id);
      t.n++; t.f += mix(xf, f); t.a += mix(xa, x);
    }
  }
  const st = new Map();
  const get = id => st.get(id) || st.set(id, { n: 0, f: 0, a: 0 }).get(id);
  const rating = id => {
    const p = pt.get(id), s = get(id);
    const pa = p ? L.mu + FC.r * (p.f / p.n - L.mu) : L.mu, pd = p ? L.mu + FC.r * (p.a / p.n - L.mu) : L.mu;
    return { att: (FC.k * pa + s.f) / (FC.k + s.n), def: (FC.k * pd + s.a) / (FC.k + s.n), n: s.n };
  };
  const predict = (h, a) => {
    const H = rating(h), A = rating(a);
    const lh = H.att * A.def / L.mu * L.hf, la = A.att * H.def / L.mu * L.af;
    return { lh, la, ...fcProbs(lh, la), rh: H, ra: A };
  };
  for (const g of cur) {
    const h = teamNum(g.homeTeamId), a = teamNum(g.awayTeamId);
    onGame(g, predict(h, a));
    const [gh, ga] = fcGoals(g);
    const sh = get(h), sa = get(a);
    sh.n++; sa.n++;
    sh.f += mix(g.expectedHomeTeamGoals, gh); sh.a += mix(g.expectedAwayTeamGoals, ga);
    sa.f += mix(g.expectedAwayTeamGoals, ga); sa.a += mix(g.expectedHomeTeamGoals, gh);
  }
  return { predict, L };
}

// Brier score (three outcomes after 60 min) of the model and of a base-rate baseline (last season's H/T/A shares)
function fcBacktest(prevPrev, prev) {
  const base = { H: 0, T: 0, A: 0 };
  const pp = fcPlayed(prevPrev);
  for (const g of pp) base[fcResult(g)]++;
  for (const k in base) base[k] /= pp.length || 1;
  const bs = (p, o) => ['H', 'T', 'A'].reduce((s, k) => s + (p[k] - (o === k ? 1 : 0)) ** 2, 0);
  let m = 0, b = 0, n = 0, hit = 0, tieP = 0, tieA = 0;
  const r = fcReplay(prevPrev, prev, (g, p) => {
    const o = fcResult(g);
    m += bs(p, o); b += bs(base, o); n++; tieP += p.T; tieA += o === 'T' ? 1 : 0;
    if (o !== 'T' && ((p.H > p.A) === (o === 'H'))) hit++;
  });
  if (!r || !n) return null;
  const decided = fcPlayed(prev).filter(g => fcResult(g) !== 'T').length;
  return { n, model: m / n, base: b / n, gain: 1 - (m / n) / (b / n), hit: hit / decided, tieP: tieP / n, tieA: tieA / n };
}

async function loadForecast(next, before) {
  const [s2, s1, s0] = await Promise.all([SEASON - 2, SEASON - 1, SEASON].map(y => getJSON(`/schedule?tournament=${TOURNAMENT}&season=${y}`).catch(() => [])));
  const cur = s0.filter(g => g.start < before);
  const r = fcReplay(s1, cur);
  if (!r) return null;
  const h = teamNum(next.homeTeamId), a = teamNum(next.awayTeamId);
  return { p: r.predict(h, a), bt: fcBacktest(s2, s1), btSeason: `${SEASON - 2}–${String(SEASON - 1).slice(2)}` };
}

// Pre-game betting odds from the league API (only meaningful before the game; after it they are in-play odds)
function oddsProbs(gameJson) {
  const e = gameJson?.game?.gamblingEvent;
  if (!e || !e.homeTeamOdds || !e.tieOdds || !e.awayTeamOdds) return null;
  const ih = 100 / e.homeTeamOdds, it = 100 / e.tieOdds, ia = 100 / e.awayTeamOdds, s = ih + it + ia;
  return { H: ih / s, T: it / s, A: ia / s };
}

// Forecast in the game's home–away order, like the preview header. SaiPa is always yellow.
function forecastHtml(F, next, sai, opp, odds) {
  const home = teamNum(next.homeTeamId) === SAIPA_NUM;
  const p = F.p;
  const sW = home ? p.H : p.A;
  const sAll = sW + p.T * (home ? FC.otHome : 1 - FC.otHome);
  const xPts = 3 * sW + p.T * (2 * (home ? FC.otHome : 1 - FC.otHome) + 1 * (home ? 1 - FC.otHome : FC.otHome));
  const hName = home ? 'SaiPa' : opp.name, aName = home ? opp.name : 'SaiPa';
  const seg = (v, cls, l) => `<div class="fc-seg ${cls}" style="flex:${v}"><b>${pct(v, 0)}</b><span>${l}</span></div>`;
  const bt = F.bt;
  const how = ['Miten ennuste lasketaan',
    'Lähtötieto\tpelattujen otteluiden maalit ja xG, puoliksi kumpaakin',
    'Kauden alku\tvedetään kohti viime kauden tasoa ja liigan keskiarvoa',
    'Kotietu\tviime kauden koti- ja vierasmaaleista',
    'Lopputulos\tPoisson-jakauma, tasapelien osuus korjattu',
    ...(bt ? [`Testi ${F.btSeason}\t${bt.n} ottelua, Brier ${num(bt.model, 3)} (arvaus ${num(bt.base, 3)})`, `Voittaja oikein\t${num(bt.hit * 100, 0)} % ratkaistuista`, `Tasapelit\tennuste ${pct(bt.tieP, 0)}, toteutui ${pct(bt.tieA, 0)}`] : []),
    'Ei mukana\tmaalivahdin valinta ja loukkaantumiset'].join('\n');
  return `
    <div class="fc-bar">${seg(p.H, home ? 'sai' : 'opp', `${esc(hName)} voittaa 60 min`)}${seg(p.T, 'tie', 'Tasan 60 min')}${seg(p.A, home ? 'opp' : 'sai', `${esc(aName)} voittaa 60 min`)}</div>
    <div class="fc-facts">
      <div><b>${num(p.lh, 1)}–${num(p.la, 1)}</b><span>Odotetut maalit ${esc(hName)}–${esc(aName)}</span></div>
      <div><b>${pct(sAll, 0)}</b><span>SaiPan voitto jatkoaika ja VL mukaan lukien</span></div>
      <div><b>${num(xPts, 2)}</b><span>SaiPan odotetut pisteet</span></div>
    </div>
    <div class="fc-foot">
      ${odds ? `<span>Vedonlyöntikertoimet: ${esc(hName)} ${pct(odds.H, 0)} · tasan ${pct(odds.T, 0)} · ${esc(aName)} ${pct(odds.A, 0)}</span>` : '<span></span>'}
      <span class="info-i" data-tip="${esc(how)}">Miten ennuste lasketaan <i>i</i></span>
    </div>`;
}

/* ---------- Season forecast: Monte Carlo of the remaining regular season (PR-9) ----------
 * Every remaining game gets the same H/T/A probabilities as the game forecast. Each simulated season also
 * draws a strength offset per team (uncertainty that shrinks as games are played), so a team's whole season
 * can go better or worse than its rating, as real seasons do. Points: 3 regulation win, 2 OT/SO win,
 * 1 OT/SO loss; OT/SO is a coin flip with FC.otHome to the home team. Equal points are split at random.
 * Playoff lines come from the standings API (playoffsLines, e.g. [4, 12, 14]). */
const SIM_N = 4000;
const SIM_SD = n => 0.50 * Math.sqrt(FC.k / (FC.k + n));   // log-odds sd of a team strength offset after n games (0.5 tested best on 2025–26)

// Current table from played games (the schedule is the single source, same as the forecast)
function fcTable(sched) {
  const T = new Map();
  const row = id => T.get(id) || T.set(id, { id, gp: 0, pts: 0, gf: 0, ga: 0 }).get(id);
  for (const g of sched.filter(x => x.ended)) {
    const h = row(teamNum(g.homeTeamId)), a = row(teamNum(g.awayTeamId)), r = fcResult(g);
    h.gp++; a.gp++; h.gf += g.homeTeamGoals; h.ga += g.awayTeamGoals; a.gf += g.awayTeamGoals; a.ga += g.homeTeamGoals;
    if (r === 'H') h.pts += 3; else if (r === 'A') a.pts += 3; else if (g.homeTeamGoals > g.awayTeamGoals) { h.pts += 2; a.pts += 1; } else { a.pts += 2; h.pts += 1; }
  }
  for (const g of sched) { row(teamNum(g.homeTeamId)); row(teamNum(g.awayTeamId)); }
  return T;
}

// Prepares a simulation: model ratings from the played games, probabilities for every remaining game
function fcSeasonSetup(prevSched, curSched) {
  const r = fcReplay(prevSched, curSched);
  if (!r) return null;
  const table = fcTable(curSched);
  const rest = curSched.filter(g => !g.ended).sort((a, b) => a.start.localeCompare(b.start))
    .map(g => { const h = teamNum(g.homeTeamId), a = teamNum(g.awayTeamId), p = r.predict(h, a); return { id: g.id, start: g.start, h, a, lh: p.lh, la: p.la, H: p.H, T: p.T, A: p.A }; });
  return { table, rest, L: r.L };
}

// Runs the simulation. forced: Map gameId -> 'H' | 'HOT' | 'AOT' | 'A' (home regulation win … away regulation win)
// until: 'YYYY-MM-DD' to stop at that date (the table as it would stand then), or null for the end of the season
// Seeded random numbers: every run uses the same draws, so a "what if" change shows only its own effect
function fcRng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function fcSimulate(setup, forced = new Map(), n = SIM_N, until = null) {
  const rnd = fcRng(20262027);
  const ids = [...setup.table.keys()], idx = new Map(ids.map((id, i) => [id, i])), N = ids.length;
  const base = ids.map(id => setup.table.get(id).pts), gp = ids.map(id => setup.table.get(id).gp);
  const pos = ids.map(() => new Float64Array(N)), sumPts = new Float64Array(N);
  const games = setup.rest.filter(g => !until || g.start.slice(0, 10) <= until).map(g => ({ ...g, hi: idx.get(g.h), ai: idx.get(g.a), f: forced.get(g.id) }));
  const gpAt = gp.slice(); for (const g of games) { gpAt[g.hi]++; gpAt[g.ai]++; }
  const pts = new Float64Array(N), off = new Float64Array(N), order = ids.map((_, i) => i);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < N; i++) { pts[i] = base[i]; off[i] = gauss() * SIM_SD(gp[i]); }
    for (const g of games) {
      let res = g.f;
      if (!res) {
        // Shift the H/A balance by the two teams' offsets for this season, keep the tie share
        const d = Math.exp((off[g.hi] - off[g.ai]) / 2), H = g.H * d, A = g.A / d, k = (1 - g.T) / (H + A);
        const u = rnd();
        res = u < H * k ? 'H' : u < H * k + g.T ? (rnd() < FC.otHome ? 'HOT' : 'AOT') : 'A';
      }
      if (res === 'H') pts[g.hi] += 3; else if (res === 'A') pts[g.ai] += 3;
      else if (res === 'HOT') { pts[g.hi] += 2; pts[g.ai] += 1; } else { pts[g.ai] += 2; pts[g.hi] += 1; }
    }
    order.sort((a, b) => pts[b] - pts[a] || rnd() - 0.5);
    order.forEach((t, r) => { pos[t][r]++; });
    for (let i = 0; i < N; i++) sumPts[i] += pts[i];
  }
  return ids.map((id, i) => {
    const dist = [...pos[i]].map(c => c / n);
    let c = 0, med = N; for (let r = 0; r < N; r++) { c += dist[r]; if (c >= 0.5) { med = r + 1; break; } }
    return { id, pts: base[i], gp: gp[i], gpAt: gpAt[i], xPts: sumPts[i] / n, dist, best: med };   // best = median finishing position
  }).sort((a, b) => b.xPts - a.xPts);
}

// Backtest: forecast made at the same point of last season (same number of games played) vs. the final table
function fcSeasonBacktest(prevPrev, prev, playedNow) {
  const done = fcPlayed(prev);
  if (done.length < playedNow + 10) return null;
  const cut = done[playedNow - 1]?.start || '';
  const partial = prev.map(g => g.start <= cut ? g : { ...g, ended: false });
  const setup = fcSeasonSetup(prevPrev, partial);
  if (!setup) return null;
  const sim = fcSimulate(setup, new Map(), 1500), fin = fcTable(prev);
  const finRank = new Map([...fin.values()].sort((a, b) => b.pts - a.pts).map((t, i) => [t.id, i + 1]));
  const ptsErr = sim.reduce((s, t) => s + Math.abs(t.xPts - fin.get(t.id).pts), 0) / sim.length;
  const rankErr = sim.reduce((s, t, i) => s + Math.abs(i + 1 - finRank.get(t.id)), 0) / sim.length;
  return { ptsErr, rankErr, games: playedNow };
}

// Season forecast card with a "what if" for SaiPa's next games. Renders into el; re-runs on every choice.
async function renderSeasonForecast(el, stn) {
  const [s2, s1, s0] = await Promise.all([SEASON - 2, SEASON - 1, SEASON].map(y => getJSON(`/schedule?tournament=${TOURNAMENT}&season=${y}`).catch(() => [])));
  const setup = fcSeasonSetup(s1, s0);
  if (!setup) { el.innerHTML = '<h2>Sarjaennuste</h2><p class="muted">Ennuste tarvitsee edellisen kauden tulokset.</p>'; return; }
  const info = new Map((stn.season || []).map(t => [t.internalId, { name: t.teamName, logo: t.teamLogos?.lightBg || null }]));
  const lines = (stn.playoffsLines || [4, 12, 14]).slice().sort((a, b) => a - b);
  const [qf, po, safe] = [lines[0], lines[1], lines[lines.length - 1]];
  const N = setup.table.size, played = s0.filter(g => g.ended).length;
  const bt = fcSeasonBacktest(s2, s1, played);
  const nextSai = setup.rest.filter(g => g.h === SAIPA_NUM || g.a === SAIPA_NUM).slice(0, 6);
  const forced = new Map();
  const nm = id => info.get(id)?.name || String(id);
  const share = (d, from, to) => d.slice(from - 1, to).reduce((s, x) => s + x, 0);
  const pc = x => x >= 0.995 ? '>99 %' : x > 0 && x < 0.005 ? '<1 %' : pct(x, 0);
  // Date to look at: null = end of the regular season. Quick picks: month ends, Christmas Eve, the season's end.
  let until = null;
  const today = new Date().toISOString().slice(0, 10), lastDay = setup.rest.length ? setup.rest[setup.rest.length - 1].start.slice(0, 10) : today;
  const picks = [];
  for (let d = new Date(today.slice(0, 7) + '-01T12:00:00Z'); ; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
    if (end >= lastDay) break;
    if (end > today) picks.push([end, `${fiDate(end)}`]);
    const xmas = `${d.getUTCFullYear()}-12-24`;
    if (d.getUTCMonth() === 11 && xmas > today && xmas < lastDay) picks.splice(picks.length - 1, 0, [xmas, 'Jouluaatto']);
  }
  const dayLabel = d => d ? (picks.find(p => p[0] === d)?.[1] === 'Jouluaatto' ? 'jouluaattona' : fiDate(d)) : 'runkosarjan lopussa';
  let baseSai = null, baseUntil = null;
  const draw = () => {
    const sim = fcSimulate(setup, forced, SIM_N, until);
    if (baseUntil !== until) { baseSai = null; baseUntil = until; }
    const sai = sim.find(t => t.id === SAIPA_NUM);
    const k = t => ({ qf: share(t.dist, 1, qf), po: share(t.dist, 1, po), rel: share(t.dist, safe + 1, N) });
    const ks = sai ? k(sai) : null;
    if (!baseSai && ks) baseSai = ks;
    const delta = (a, b) => forced.size && Math.abs(a - b) >= 0.005 ? ` <small class="${a > b ? 'pos-num' : 'neg-num'}">${a > b ? '+' : '−'}${num(Math.abs(a - b) * 100, 0)} %-yks.</small>` : '';
    const delR = (a, b) => forced.size && Math.abs(a - b) >= 0.005 ? ` <small class="${a < b ? 'pos-num' : 'neg-num'}">${a > b ? '+' : '−'}${num(Math.abs(a - b) * 100, 0)} %-yks.</small>` : '';
    const chip = (k2, v, tip) => `<span class="chip" data-tip="${esc(tip)}"><small>${k2}</small><b>${v}</b></span>`;
    const saiHtml = ks ? `<div class="chips sf-sai">
        ${chip(until ? `Sijoilla 1–${po}` : 'Pudotuspeleihin', pc(ks.po) + delta(ks.po, baseSai.po), until ? `Todennäköisyys olla pudotuspelipaikalla ${dayLabel(until)}` : `Sijat 1–${po}\nTodennäköisyys päästä pudotuspeleihin`)}
        ${chip(until ? `Sijoilla 1–${qf}` : 'Suoraan puolivälieriin', pc(ks.qf) + delta(ks.qf, baseSai.qf), until ? `Todennäköisyys olla sijoilla 1–${qf} ${dayLabel(until)}` : `Sijat 1–${qf}`)}
        ${chip(until ? `Sijoilla ${safe + 1}–${N}` : 'Putoamisvaara', pc(ks.rel) + delR(ks.rel, baseSai.rel), until ? `Todennäköisyys olla sijoilla ${safe + 1}–${N} ${dayLabel(until)}` : `Sijat ${safe + 1}–${N}`)}
        ${chip('Pisteet ennuste', num(sai.xPts, 0), `Nyt ${sai.pts} p ${sai.gp} ottelusta\nEnnuste ${dayLabel(until)}, ${sai.gpAt} ottelua pelattu`)}
        ${chip('Ennustettu sija', `${sai.best}.`, `Mediaanisijoitus ${dayLabel(until)}: puolessa simulaatioista SaiPa on tällä sijalla tai paremmalla`)}
      </div>` : '';
    const dateHtml = `<div class="sf-date"><span class="muted small">Tilanne</span>
      <select class="sf-pick">${[[null, 'Runkosarjan loppu'], ...picks].map(([d, l]) => `<option value="${d || ''}"${(d || null) === until ? ' selected' : ''}>${l}</option>`).join('')}${until && !picks.some(p => p[0] === until) ? `<option value="${until}" selected>${fiDate(until)}</option>` : ''}</select>
      <input type="date" class="sf-day" min="${today}" max="${lastDay}" value="${until || ''}" aria-label="Valitse päivä"></div>`;
    const opts = [['', 'Malli'], ['W', 'V'], ['OTW', 'JAV'], ['OTL', 'JAH'], ['L', 'H']];
    const whatIf = nextSai.length ? `<div class="sf-wi"><h3>Mitä jos <small class="muted">valitse SaiPan seuraavien otteluiden tulokset</small></h3>
      <div class="sf-games">${nextSai.map(g => { const home = g.h === SAIPA_NUM, cur = forced.get(g.id), mine = cur ? ({ H: home ? 'W' : 'L', A: home ? 'L' : 'W', HOT: home ? 'OTW' : 'OTL', AOT: home ? 'OTL' : 'OTW' })[cur] : '';
        const pW = home ? g.H : g.A;
        return `<div class="sf-g"><div class="sf-gh">${fiDate(g.start)} ${home ? 'vs' : '@'} <b>${esc(nm(home ? g.a : g.h))}</b> <small class="muted" data-tip="${esc(`Mallin todennäköisyydet\nSaiPa voittaa 60 min\t${pct(pW, 0)}\nTasan 60 min jälkeen\t${pct(g.T, 0)}\nSaiPa häviää 60 min\t${pct(home ? g.A : g.H, 0)}`)}">voitto ${pct(pW, 0)}</small></div>
          <div class="sf-opts">${opts.map(([v, l]) => `<button class="sbtn sm${(mine || '') === v ? ' active' : ''}" data-g="${g.id}" data-v="${v}" data-tip="${esc({ '': 'Mallin arvio', W: 'Voitto 60 minuutissa (3 p)', OTW: 'Voitto jatkoajalla tai voittolaukauksilla (2 p)', OTL: 'Tappio jatkoajalla tai voittolaukauksilla (1 p)', L: 'Tappio 60 minuutissa (0 p)' }[v])}">${l}</button>`).join('')}</div></div>`; }).join('')}</div>
      ${forced.size ? '<button class="sbtn sm sf-reset">Tyhjennä valinnat</button>' : ''}</div>` : '';
    const maxP = Math.max(...sim.map(t => Math.max(...t.dist)));
    const rows = sim.map((t, i) => {
      const kk = k(t), tip = `${nm(t.id)}\nNyt\t${t.pts} p · ${t.gp} ott.\nEnnuste ${dayLabel(until)}\t${num(t.xPts, 1)} p · ${t.gpAt} ott.\nEnnustettu sija (mediaani)\t${t.best}.\n${t.dist.map((d, j) => d >= 0.005 ? `${j + 1}.\t${pct(d, 0)}` : '').filter(Boolean).join('\n')}`;
      const cells = t.dist.map((d, j) => `<i class="${j + 1 <= qf ? 'q' : j + 1 <= po ? 'p' : j + 1 > safe ? 'r' : ''}" style="opacity:${d ? 0.12 + 0.88 * Math.sqrt(d / maxP) : 0.05}"></i>`).join('');
      const logo = info.get(t.id)?.logo;
      return `<tr class="${t.id === SAIPA_NUM ? 'me' : ''}${i + 1 === qf || i + 1 === po || i + 1 === safe ? ' line' : ''}" data-tip="${esc(tip)}">
        <td>${i + 1}.</td><td class="tn">${logo ? `<img class="tlogo" src="${esc(logo)}" alt="">` : ''}${esc(nm(t.id))}</td><td>${t.pts}</td>${until ? `<td>${t.gpAt}</td>` : ''}<td><b>${num(t.xPts, 0)}</b></td>
        <td>${pc(kk.qf)}</td><td>${pc(kk.po)}</td><td>${pc(kk.rel)}</td><td class="sf-dist">${cells}</td></tr>`;
    }).join('');
    const th = (l, en, fi) => `<th data-tip="${esc(`${en}\n${fi}`)}">${l}</th>`;
    // How it works, with SaiPa's next game as the worked example
    const ex = nextSai[0], exHome = ex && ex.h === SAIPA_NUM;
    const howHtml = `<details class="sf-how"><summary>Miten ennuste lasketaan</summary><ol>
      <li><b>Hyökkäystaso</b> = joukkueen maalit ottelua kohden. Puolet painosta on oikeilla maaleilla ja puolet maalipaikoilla (xG), koska maalipaikat kertovat tasosta vähemmän sattumanvaraisesti. <b>Puolustustaso</b> lasketaan samoin päästetyistä.</li>
      <li><b>Viime kausi</b> painaa alkukaudesta paljon ja kauden edetessä yhä vähemmän: ${[5, 20, 50].map(n => `${n} ottelun jälkeen ${pct(FC.k / (FC.k + n), 0)}`).join(', ')}. Viime kaudesta otetaan kuitenkin vain ${pct(FC.r, 0)} joukkueen erosta sarjan keskiarvoon, koska joukkueet muuttuvat kesän aikana.</li>
      <li><b>Odotettu maalimäärä</b> = oma hyökkäystaso × vastustajan puolustustaso ÷ sarjan keskiarvo (${num(setup.L.mu, 2)} maalia). Kotietu viime kaudelta: kotijoukkueelle ${signed((setup.L.hf - 1) * 100, 0)} %, vierasjoukkueelle ${signed((setup.L.af - 1) * 100, 0)} %.</li>
      <li><b>Lopputulokset</b>: odotetuista maalimääristä lasketaan jokaisen tuloksen (1–0, 2–1, 3–3…) todennäköisyys Poisson-jakaumalla. Tasapelejä lisätään ${pct(FC.d, 0)}, koska pelkkä jakauma antaa niitä todellista vähemmän. Jatkoaika ja voittolaukaukset ovat 50/50.</li>
      ${ex ? `<li><b>Esimerkki</b>: ${esc(exHome ? `SaiPa–${nm(ex.a)}` : `${nm(ex.h)}–SaiPa`)} ${fiDate(ex.start)}, odotetut maalit ${num(ex.lh, 1)}–${num(ex.la, 1)}. SaiPa voittaa 60 minuutissa ${pct(exHome ? ex.H : ex.A, 0)}, tasan ${pct(ex.T, 0)}, SaiPa häviää ${pct(exHome ? ex.A : ex.H, 0)}.</li>` : ''}
      <li><b>Simulointi</b>: jäljellä olevat ottelut pelataan läpi ${num(SIM_N, 0)} kertaa näillä todennäköisyyksillä. Jos voittotodennäköisyys on 60 %, joukkue voittaa noin 60 % kerroista. Lisäksi joukkueen taso saa jokaisella kierroksella olla vähän arviota parempi tai huonompi, koska taso tiedetään alkukaudesta epätarkasti. Tämä vaihtelu pienenee pelattujen otteluiden myötä.</li>
      <li><b>Tasapisteet</b>: järjestys on sattumanvarainen, koska maalieroa ei ennusteta.</li></ol></details>`;
    el.innerHTML = `<h2>Sarjaennuste</h2>
      ${dateHtml}
      ${saiHtml}
      ${whatIf}
      <div class="tablewrap"><table class="sf-t"><thead><tr><th>#</th><th>Joukkue</th>${th('PTS', 'Points', 'Pisteet nyt')}${until ? th('GP', 'Games Played', `Pelatut ottelut ${dayLabel(until)}`) : ''}${th('xPTS', 'Expected Points', `Ennustetut pisteet ${dayLabel(until)}`)}${th(`1–${qf}`, 'Quarterfinal bye', until ? `Sijoilla 1–${qf} ${dayLabel(until)}` : `Suoraan puolivälieriin (sijat 1–${qf})`)}${th(`1–${po}`, 'Playoffs', until ? `Sijoilla 1–${po} ${dayLabel(until)}` : `Pudotuspeleihin (sijat 1–${po})`)}${th(`${safe + 1}–${N}`, 'Relegation zone', until ? `Sijoilla ${safe + 1}–${N} ${dayLabel(until)}` : `Sijat ${safe + 1}–${N}`)}<th data-tip="${esc(`Sijoitusjakauma\nRuutu per sija 1–${N}: mitä tummempi, sitä todennäköisempi`)}">Sijat 1–${N}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">${num(SIM_N, 0)} simuloitua kautta. ${until ? `Tilanne ${dayLabel(until)}: ${setup.rest.filter(g => g.start.slice(0, 10) <= until).length} ottelua simuloitu.` : `${setup.rest.length} ottelua jäljellä.`}${bt && !until ? ` Testi: kausi ${SEASON - 2}–${String(SEASON - 1).slice(2)} samasta kohdasta (${bt.games} ottelua pelattu) ennusti loppupisteet keskimäärin ${num(bt.ptsErr, 1)} pisteen ja sijoituksen ${num(bt.rankErr, 1)} sijan tarkkuudella.` : ''}</p>
      ${howHtml}`;
    el.querySelectorAll('.sf-opts .sbtn').forEach(b => b.onclick = () => {
      const g = setup.rest.find(x => String(x.id) === b.dataset.g), home = g.h === SAIPA_NUM, v = b.dataset.v;
      if (!v) forced.delete(g.id); else forced.set(g.id, { W: home ? 'H' : 'A', L: home ? 'A' : 'H', OTW: home ? 'HOT' : 'AOT', OTL: home ? 'AOT' : 'HOT' }[v]);
      draw();
    });
    const rs = el.querySelector('.sf-reset'); if (rs) rs.onclick = () => { forced.clear(); draw(); };
    el.querySelector('.sf-pick').onchange = e => { until = e.target.value || null; draw(); };
    el.querySelector('.sf-day').onchange = e => { const v = e.target.value; until = v && v < lastDay ? (v < today ? today : v) : null; draw(); };
  };
  draw();
}
