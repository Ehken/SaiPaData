/* SaiPa Data: expected goals by game situation for every Liiga team (season view, Liiga tab).
 * Uses helpers from app.js, shots.js and preview.js (getJSON, esc, num, pct, signed, sortableTable, whenVisible,
 * validGoal, teamNum, loadLeagueShots, SEASON, SAIPA_NUM).
 *
 * Splits: score state (leading / tied / trailing), manpower (5 v 5, power play, penalty kill, 4 v 4 and 3 v 3,
 * own net empty, opponent's net empty) and game phase (first 10 minutes, 10–50, last 10 minutes, each period, overtime).
 *
 * Score- and venue-adjusted (sa) numbers, 5 v 5 only: a trailing team shoots more and a leading team less, so each
 * attempt is weighted by how much the league's teams shoot in that score state at home or away
 * (Tulsky / Evolving-Hockey method): weight = league average share / share in that state. Coefficients from the
 * league's own shot maps:
 *   SA_CF: shot attempts, regular seasons 2015–16 to 2025–26 (2017–18 has almost no shot maps), 4 368 games
 *   SA_XG: expected goals, 2025–26 (the first season with xG on every shot), 480 games
 * Score state = home goals minus away goals before the shot, capped at ±2. [home weight, away weight].
 * Check (split-half test, 152 team seasons): first-half 5 v 5 attempt share predicts second-half points per game with
 * r = 0.48 raw and r = 0.54 score-adjusted, as well as points per game (0.54). For xG there is one season only
 * (16 teams): raw and adjusted both r = 0.55. Score effects are smaller in xG than in attempts (trailing teams shoot
 * more but from worse spots), so the xG adjustment is small.
 */
const SA_CF = { '-2': [0.885, 1.157], '-1': [0.919, 1.102], 0: [0.991, 1.010], 1: [1.083, 0.925], 2: [1.134, 0.890] };
const SA_XG = { '-2': [0.952, 1.056], '-1': [0.963, 1.042], 0: [0.986, 1.016], 1: [1.014, 0.986], 2: [1.086, 0.923] };
const scoreBin = d => String(Math.max(-2, Math.min(2, d)));

const SIT_ST = { lead: 'Johdossa', tied: 'Tasan', trail: 'Tappiolla' };
const SIT_MP = { ev: '5 v 5', pp: 'Ylivoima', pk: 'Alivoima', even: '4 v 4 / 3 v 3', enOwn: 'Oma maali tyhjänä', enOpp: 'Vastustajan maali tyhjänä' };
const SIT_PH = { early: '0–10 min', mid: '10–50 min', late: '50–60 min', p1: '1. erä', p2: '2. erä', p3: '3. erä', ot: 'Jatkoaika' };

function blankSit() {
  const z = () => ({ xf: 0, xa: 0, cf: 0, ca: 0, gf: 0, ga: 0, toi: 0 });
  const o = { gp: 0, all: z(), ev: z(), sa: { cf: 0, ca: 0, xf: 0, xa: 0 } };
  for (const k of [...Object.keys(SIT_ST), ...Object.keys(SIT_MP), ...Object.keys(SIT_PH)]) o[k] = z();
  return o;
}

// One game for both teams. sm = cleaned shot map rows, g = the game's data (goals and empty-net intervals).
function sitGame(sm, g, T) {
  const G = g.game, ids = [teamNum(G.homeTeam.teamId), teamNum(G.awayTeamId ?? G.awayTeam.teamId)];
  const [h, a] = ids;
  const goals = [...(G.homeTeam.goalEvents || []).filter(validGoal).map(e => ({ t: e.gameTime, d: 1 })), ...(G.awayTeam.goalEvents || []).filter(validGoal).map(e => ({ t: e.gameTime, d: -1 }))]
    .filter(x => Number.isFinite(x.t) && x.t <= 3900).sort((x, y) => x.t - y.t);
  const diffAt = t => goals.reduce((s, x) => s + (x.t < t ? x.d : 0), 0);   // shot map times run a few seconds before the goal event
  const en = side => ((side === 'h' ? G.homeTeam : G.awayTeam).goalKeeperEvents || []).filter(e => e.emptyNet).map(e => [e.beginTime, e.endTime ?? 99999]);
  const enH = en('h'), enA = en('a'), empty = (iv, t) => iv.some(([b, e]) => b <= t && t < e);
  const end = Math.max(3600, G.gameTime || 0);
  const H = T(h), A = T(a);
  H.gp++; A.gp++;
  // Time in each score state, from each team's side
  { let prev = 0, d = 0;
    for (const x of [...goals, { t: end, d: 0 }]) {
      const dt = Math.max(0, Math.min(x.t, end) - prev), k = d > 0 ? 'lead' : d < 0 ? 'trail' : 'tied', kA = d > 0 ? 'trail' : d < 0 ? 'lead' : 'tied';
      H[k].toi += dt; A[kA].toi += dt; prev = Math.min(x.t, end); d += x.d;
    } }
  for (const [k, t0, t1] of [['early', 0, 600], ['mid', 600, 3000], ['late', 3000, 3600], ['p1', 0, 1200], ['p2', 1200, 2400], ['p3', 2400, 3600], ['ot', 3600, end]]) {
    const dt = Math.max(0, Math.min(t1, end) - t0); H[k].toi += dt; A[k].toi += dt;
  }
  H.all.toi += end; A.all.toi += end;
  for (const s of sm || []) {
    if ((s.period || 0) > 4) continue;
    const homeShot = teamNum(s.shootingTeamId) === h, F = homeShot ? H : A, O = homeShot ? A : H;
    const t = s.gameTime || 0, xg = s.xg || 0, goal = s.eventType === 'GOAL';
    const dHome = diffAt(t), d = homeShot ? dHome : -dHome;
    const keys = ['all', d > 0 ? 'lead' : d < 0 ? 'trail' : 'tied',
      t < 600 ? 'early' : t < 3000 ? 'mid' : t < 3600 ? 'late' : 'ot', t >= 3600 ? null : t < 1200 ? 'p1' : t < 2400 ? 'p2' : 'p3'];
    const ownEmpty = empty(homeShot ? enH : enA, t), oppEmpty = empty(homeShot ? enA : enH, t);
    const mp = oppEmpty ? 'enOpp' : ownEmpty ? 'enOwn' : s.type === 'PowerplayShot' ? 'pp' : s.type === 'ShorthandedShot' ? 'pk'
      : s.ownTeamPlayersOnIce === 6 && s.otherTeamPlayersOnIce === 6 ? 'ev' : 'even';
    keys.push(mp);
    // The other team sees the same shot from the other side: its manpower key is the mirror
    const mirror = { enOpp: 'enOwn', enOwn: 'enOpp', pp: 'pk', pk: 'pp', ev: 'ev', even: 'even' };
    const oKeys = keys.map(k => k === 'lead' ? 'trail' : k === 'trail' ? 'lead' : k === mp ? mirror[mp] : k);
    for (const k of keys.filter(Boolean)) { F[k].xf += xg; F[k].cf++; if (goal) F[k].gf++; }
    for (const k of oKeys.filter(Boolean)) { O[k].xa += xg; O[k].ca++; if (goal) O[k].ga++; }
    if (mp === 'ev') {
      const w = homeShot ? 0 : 1, b = scoreBin(dHome);
      const wc = SA_CF[b][w], wx = SA_XG[b][w];
      F.sa.cf += wc; F.sa.xf += xg * wx; O.sa.ca += wc; O.sa.xa += xg * wx;
    }
  }
}

let SIT_P = null;
function leagueSituations() {
  if (SIT_P) return SIT_P;
  SIT_P = (async () => {
    const L = await loadLeagueShots();
    const teams = new Map(), names = new Map();
    const T = id => teams.get(id) || teams.set(id, { id, ...blankSit() }).get(id);
    let missing = 0;
    await Promise.all(L.ended.map(async r => {
      names.set(teamNum(r.homeTeamId), r.homeTeamName); names.set(teamNum(r.awayTeamId), r.awayTeamName);
      const sm = L.shots.get(r.id) || [];
      if (!sm.length) { missing++; return; }
      const g = await getJSON(`/games/${SEASON}/${r.id}`).catch(() => null);
      if (g?.game) sitGame(sm, g, T); else missing++;
    }));
    for (const t of teams.values()) t.name = names.get(t.id) || '';
    return { teams: [...teams.values()], missing, games: L.ended.length };
  })();
  SIT_P.catch(() => { SIT_P = null; });
  return SIT_P;
}

const shr = (a, b) => (a + b) ? a / (a + b) : null;
const per60 = (v, toi) => toi ? v / toi * 3600 : null;
// Column sets. Each column: k, l (label), t (tooltip), v (value), f (format), heat
const SIT_SETS = [
  ['yht', 'Yhteenveto', t => [
    { k: 'gp', l: 'GP', t: 'Games Played\nOttelut, joista laukauskartta', v: t.gp, f: v => num(v, 0) },
    { k: 'xg', l: 'xG%', t: 'Expected Goals For %\nOsuus ottelun maaliodottamasta, kaikki pelitilanteet', v: shr(t.all.xf, t.all.xa), f: v => pct(v, 1), heat: true },
    { k: 'evxg', l: 'xG% 5v5', t: 'Expected Goals For %, 5 on 5\nOsuus maaliodottamasta tasakentällisin', v: shr(t.ev.xf, t.ev.xa), f: v => pct(v, 1), heat: true },
    { k: 'saxg', l: 'sa-xG% 5v5', t: 'Score- and Venue-Adjusted xG%, 5 on 5\nPelitilannekorjattu: johdossa ja tappiolla syntyneet maalipaikat painotettu liigan keskimääräisellä tilanne-erolla, myös koti/vieras', v: shr(t.sa.xf, t.sa.xa), f: v => pct(v, 1), heat: true },
    { k: 'evcf', l: 'CF% 5v5', t: 'Corsi For %, 5 on 5\nLaukausyritysten osuus tasakentällisin', v: shr(t.ev.cf, t.ev.ca), f: v => pct(v, 1), heat: true },
    { k: 'sacf', l: 'sa-CF% 5v5', t: 'Score- and Venue-Adjusted Corsi For %, 5 on 5\nPelitilannekorjattu laukausyritysten osuus', v: shr(t.sa.cf, t.sa.ca), f: v => pct(v, 1), heat: true },
    { k: 'gd', l: 'G−xG', t: 'Goals minus Expected Goals, net\nMaaliero miinus odotettu maaliero, kaikki pelitilanteet', v: (t.all.gf - t.all.ga) - (t.all.xf - t.all.xa), f: v => signed(v, 1) },
  ]],
  ['tila', 'Maalitilanne', t => Object.entries(SIT_ST).flatMap(([k, l]) => [
    { k: k + 'T', l: `${l} aika`, g: l, t: `Time Share, ${l}\nOsuus peliajasta`, v: shr(t[k].toi, t.all.toi - t[k].toi), f: v => pct(v, 0) },
    { k: k + 'X', l: 'xG%', g: l, t: `Expected Goals For %, ${l}\nOsuus maaliodottamasta tilanteessa ${l.toLowerCase()}`, v: shr(t[k].xf, t[k].xa), f: v => pct(v, 1), heat: true },
    { k: k + 'F', l: 'xGF/60', g: l, t: `Expected Goals For per 60\nOma maaliodottama 60 minuuttia kohden tilanteessa ${l.toLowerCase()}`, v: per60(t[k].xf, t[k].toi), f: v => num(v, 2), heat: true },
  ])],
  ['mies', 'Kentälliset', t => [
    { k: 'ev', l: 'xG% 5v5', t: 'Expected Goals For %, 5 on 5\nOsuus maaliodottamasta tasakentällisin', v: shr(t.ev.xf, t.ev.xa), f: v => pct(v, 1), heat: true },
    { k: 'pp', l: 'YV xGF/ott.', t: 'Power Play xGF per Game\nOma maaliodottama ylivoimalla ottelua kohden', v: t.gp ? t.pp.xf / t.gp : null, f: v => num(v, 2), heat: true },
    { k: 'pk', l: 'AV xGA/ott.', t: 'Penalty Kill xGA per Game\nVastustajan maaliodottama joukkueen alivoimalla ottelua kohden (pienempi parempi)', v: t.gp ? t.pk.xa / t.gp : null, f: v => num(v, 2) },
    { k: 'st', l: 'Erikois netto', t: 'Special Teams xG Net per Game\nYlivoiman ja alivoiman maaliodottama yhteensä: omat miinus vastustajan, ottelua kohden', v: t.gp ? (t.pp.xf + t.pk.xf - t.pp.xa - t.pk.xa) / t.gp : null, f: v => signed(v, 2), heat: true },
    { k: 'even', l: 'xG% 4v4/3v3', t: 'Expected Goals For %, 4 on 4 and 3 on 3\nOsuus maaliodottamasta vajaalla tasakentällisellä (myös jatkoajan 3 v 3)', v: shr(t.even.xf, t.even.xa), f: v => pct(v, 1), heat: true },
    { k: 'enOwn', l: 'Oma tyhjä G', t: 'Own Net Empty: Goals For – Against\nMaalit kun oma maalivahti on vaihdettu kenttäpelaajaan: tehdyt–päästetyt', v: t.enOwn.gf - t.enOwn.ga, f: (v, t) => `${t.enOwn.gf}–${t.enOwn.ga}` },
    { k: 'enOpp', l: 'Vast. tyhjä G', t: 'Opponent Net Empty: Goals For – Against\nMaalit kun vastustajan maali on tyhjä: tehdyt–päästetyt', v: t.enOpp.gf - t.enOpp.ga, f: (v, t) => `${t.enOpp.gf}–${t.enOpp.ga}` },
  ]],
  ['vaihe', 'Ottelun vaihe', t => Object.entries(SIT_PH).map(([k, l]) => (
    { k, l: `xG% ${l}`, t: `Expected Goals For %, ${l}\nOsuus maaliodottamasta${k === 'ot' ? ' jatkoajalla' : ` ajalla ${l}`}\nxGF/60 ja xGA/60 hiiren alla`, v: shr(t[k].xf, t[k].xa), f: v => pct(v, 1), heat: true,
      tip: `xGF/60 ${num(per60(t[k].xf, t[k].toi), 2)} · xGA/60 ${num(per60(t[k].xa, t[k].toi), 2)}` }))],
];
let SIT_SET = 'yht';

async function renderSituations(el) {
  const D = await leagueSituations();
  const draw = () => {
    const [, , cols] = SIT_SETS.find(s => s[0] === SIT_SET);
    el.querySelectorAll('.sit-bar .sbtn').forEach(b => b.classList.toggle('active', b.dataset.k === SIT_SET));
    const rows = D.teams.map(t => ({ t, c: Object.fromEntries(cols(t).map(c => [c.k, c])) }));
    const spec = cols(D.teams[0]).map(c0 => ({
      k: c0.k, l: c0.l, g: c0.g, t: c0.t, heat: c0.heat,
      f: r => { const c = r.c[c0.k]; const txt = c.v == null ? '–' : c.f(c.v, r.t); return c.tip ? `<span data-tip="${esc(c.tip)}">${txt}</span>` : txt; },
      s: r => r.c[c0.k].v ?? -99,
    }));
    const name = { k: 'name', l: 'Joukkue', f: r => esc(r.t.name), s: r => r.t.name };
    sortableTable(el.querySelector('.sit-tab'), rows, [name, ...spec], spec[1]?.k || spec[0].k, r => r.t.id === SAIPA_NUM ? 'me' : '');
  };
  el.innerHTML = `<h2>Maalipaikat pelitilanteittain <span class="h2-sub">koko liiga</span></h2>
    <div class="setbar sit-bar" role="tablist" aria-label="Näkymä">${SIT_SETS.map(([k, l]) => `<button class="sbtn" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="tablewrap sit-tab"></div>
    <p class="muted small">Liigan laukauskartoista ${D.games - D.missing}/${D.games} ottelua. 5 v 5 = molemmilla viisi kenttäpelaajaa ja maalivahti. Pelitilannekorjattu (sa) painottaa 5 v 5 -laukaukset sen mukaan, paljonko joukkueet keskimäärin laukovat johdossa, tasan ja tappiolla kotona ja vieraissa: tappiolla laukotaan enemmän, joten kirittävän joukkueen lukuja lasketaan ja johtavan nostetaan. Kertoimet Liigan omasta datasta, menetelmä Mittarit-sivulla. Shootout ei mukana. SaiPa korostettu.</p>`;
  el.querySelectorAll('.sit-bar .sbtn').forEach(b => b.onclick = () => { SIT_SET = b.dataset.k; draw(); });
  draw();
}
