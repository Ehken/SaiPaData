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
