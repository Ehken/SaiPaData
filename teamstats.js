/* SaiPa Data: team metrics (season view, whole season or last N games), the same metrics for one game in the
 * report, and the league's hottest players of a calendar month.
 * Uses helpers from app.js and preview.js (getJSON, esc, num, pct, signed, mmss, plink, tile, sortableTable, whenVisible,
 * SEASON, TOURNAMENT, SAIPA_NUM, TEAM_METRICS, TAPE_GROUPS, loadLeague, teamGame, teamNum, vsRow, vsHead, loadLeagueShots). */

/* ---------- shared per-game numbers ---------- */
// 5-on-5 shot attempts from a shot map: both teams with five skaters and a goalie on the ice, shootout left out
function evAttempts(sm, tid) {
  let f = 0, a = 0;
  for (const s of sm || []) {
    if ((s.period || 0) > 4 || s.ownTeamPlayersOnIce !== 6 || s.otherTeamPlayersOnIce !== 6) continue;
    if (Number(s.shootingTeamId) === tid) f++; else a++;
  }
  return { f, a };
}

// One team's result in a schedule row. The shootout-deciding goal is not counted as a goal.
function schedSide(r, tid) {
  const home = teamNum(r.homeTeamId) === tid;
  const so = r.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION', ot = r.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME';
  const me = home ? r.homeTeamGoals : r.awayTeamGoals, op = home ? r.awayTeamGoals : r.homeTeamGoals;
  const won = me > op;
  return {
    id: r.id, start: r.start, home,
    gf: me - (so && won ? 1 : 0), ga: op - (so && !won ? 1 : 0),
    xgf: (home ? r.expectedHomeTeamGoals : r.expectedAwayTeamGoals) || 0,
    xga: (home ? r.expectedAwayTeamGoals : r.expectedHomeTeamGoals) || 0,
    pts: won ? (so || ot ? 2 : 3) : (so || ot ? 1 : 0),
  };
}

/* ---------- league over each team's last N games ---------- */
// Metrics from the schedule (results, xG) and the shot maps (5-on-5 attempts) are ranked for every team.
// Power play, penalties, faceoffs and puck control need each game's full stats, so they are filled in for SaiPa only.
function leagueRecent(sched, n, shots) {
  const rows = new Map();
  for (const r of sched.filter(g => g.ended).sort((a, b) => a.start.localeCompare(b.start))) {
    for (const key of [r.homeTeamId, r.awayTeamId]) {
      const id = teamNum(key);
      (rows.get(id) || rows.set(id, { id, name: key === r.homeTeamId ? r.homeTeamName : r.awayTeamName, list: [] }).get(id)).list.push(r);
    }
  }
  const teams = new Map();
  for (const { id, name, list } of rows.values()) {
    const last = list.slice(-n).map(r => ({ ...schedSide(r, id), r }));
    const k = last.length, s = f => last.reduce((a, x) => a + f(x), 0);
    const gf = s(x => x.gf), ga = s(x => x.ga), xgf = s(x => x.xgf), xga = s(x => x.xga);
    let ef = 0, ea = 0, eGames = 0;
    if (shots) for (const x of last) { const sm = shots.get(x.id); if (!sm || !sm.length) continue; const e = evAttempts(sm, id); ef += e.f; ea += e.a; eGames++; }
    teams.set(id, { id, name, games: k, rows: last, m: {
      ppg: k ? s(x => x.pts) / k : null, gfpg: k ? gf / k : null, gapg: k ? ga / k : null,
      xgfpg: k ? xgf / k : null, xgapg: k ? xga / k : null, xgShare: (xgf + xga) ? xgf / (xgf + xga) : null,
      evAtt: eGames && (ef + ea) ? ef / (ef + ea) : null,
      finPg: k ? (gf - xgf) / k : null, gsaxPg: k ? (xga - ga) / k : null,
    } });
  }
  rankTeams(teams);
  return { teams, nTeams: teams.size, recent: n };
}
function rankTeams(teams) {
  const list = [...teams.values()].filter(t => t.games > 0);
  for (const t of list) t.r = t.r || {};
  for (const mt of TEAM_METRICS) {
    const vals = list.filter(t => t.m[mt.k] != null).sort((a, b) => mt.hi ? b.m[mt.k] - a.m[mt.k] : a.m[mt.k] - b.m[mt.k]);
    for (const t of vals) t.r[mt.k] = 1 + vals.findIndex(u => u.m[mt.k] === t.m[mt.k]);
  }
}

// SaiPa's own power play, penalties, faceoffs and puck control over the given games (needs each game's stats)
async function ownSpecial(rows, tid) {
  const sp = { ppI: 0, ppG: 0, shI: 0, shGA: 0, pen: 0, fw: 0, fl: 0, puckF: 0, puckA: 0 };
  const games = await Promise.all(rows.map(async x => {
    const [g, st] = await Promise.all([getJSON(`/games/${SEASON}/${x.id}`), getJSON(`/games/stats/${SEASON}/${x.id}`)]);
    return teamGame(g, st, tid, x.r);
  }));
  for (const gm of games) for (const k in sp) sp[k] += gm.special?.[k] || 0;
  const n = rows.length;
  return {
    pp: sp.ppI ? sp.ppG / sp.ppI : null, pk: sp.shI ? 1 - sp.shGA / sp.shI : null, penPg: n ? sp.pen / n : null,
    fo: (sp.fw + sp.fl) ? sp.fw / (sp.fw + sp.fl) : null, puck: (sp.puckF + sp.puckA) ? sp.puckF / (sp.puckF + sp.puckA) : null,
  };
}

/* ---------- season card ---------- */
const TM_WINDOWS = [[0, 'Koko kausi'], [20, '20 viimeisintä'], [10, '10 viimeisintä'], [5, '5 viimeisintä']];
let TM_N = 0;

async function renderTeamMetrics(el) {
  const sched = await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`);
  const played = sched.filter(g => g.ended && (teamNum(g.homeTeamId) === SAIPA_NUM || teamNum(g.awayTeamId) === SAIPA_NUM)).length;
  const wins = TM_WINDOWS.filter(([n]) => n === 0 || n < played);
  if (!wins.some(([n]) => n === TM_N)) TM_N = 0;
  const draw = async () => {
    const body = el.querySelector('.tm-body');
    body.innerHTML = '<p class="loading">Lasketaan…</p>';
    el.querySelectorAll('.sbtn').forEach(b => b.classList.toggle('active', Number(b.dataset.n) === TM_N));
    const n = TM_N;
    try {
      let L, sai;
      if (!n) { L = await loadLeague(); sai = L.teams.get(SAIPA_NUM); }
      else {
        const shots = await loadLeagueShots().then(x => x.shots).catch(() => null);
        L = leagueRecent(sched, n, shots); sai = L.teams.get(SAIPA_NUM);
        if (sai) Object.assign(sai.m, await ownSpecial(sai.rows, SAIPA_NUM));
      }
      if (n !== TM_N) return;   // another window was picked while loading
      body.innerHTML = sai ? teamMetricsHtml(sai, L, n) : '<p class="muted">Ei vielä pelattuja otteluita.</p>';
    } catch (e) { body.innerHTML = `<p class="neg-num">Lataus epäonnistui: ${esc(e.message)}</p>`; }
  };
  el.innerHTML = `<h2>Joukkueen tunnusluvut <span class="h2-sub">${played} ottelua</span></h2>
    <div class="setbar" role="tablist" aria-label="Otanta">${wins.map(([n, l]) => `<button class="sbtn" data-n="${n}">${l}</button>`).join('')}</div>
    <div class="tm-body"></div>`;
  el.querySelectorAll('.sbtn').forEach(b => b.onclick = () => { TM_N = Number(b.dataset.n); draw(); });
  draw();
}

function teamMetricsHtml(sai, L, n) {
  const list = [...L.teams.values()].filter(t => t.games > 0);
  const N = L.nTeams || list.length;
  const groups = TAPE_GROUPS.map(([name, keys]) => {
    const rows = keys.map(k => {
      const mt = TEAM_METRICS.find(x => x.k === k), v = sai.m[k];
      if (!mt || v == null) return '';
      const r = sai.r?.[k];
      const vals = list.map(t => t.m[k]).filter(x => x != null);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const best = r ? [...list].filter(t => t.m[k] != null).sort((a, b) => mt.hi ? b.m[k] - a.m[k] : a.m[k] - b.m[k])[0] : null;
      const tone = !r ? '' : r <= 3 ? 'top' : r > N - 3 ? 'low' : '';
      const tip = [mt.l, `SaiPa\t${mt.fmt(v)}${r ? `, Liigan ${r}.` : ''}`,
        ...(r ? [`Liigan keskiarvo\t${mt.fmt(avg)}`, `Paras: ${best.name}\t${mt.fmt(best.m[k])}`] : ['Liigasijoitus vain koko kauden otannasta: muiden joukkueiden lukuihin tarvittaisiin jokaisen ottelun tilastot'])].join('\n');
      const dot = r && N > 1 ? `<span class="tm-track"><i style="left:${((r - 1) / (N - 1)) * 100}%"></i></span>` : '<span class="tm-track"></span>';
      return `<div class="tm-row" data-tip="${esc(tip)}"><span class="tm-l">${esc(mt.s || mt.l)}</span>${dot}<span class="tm-r">${r ? `${r}.` : '–'}</span><b class="tm-v ${tone}">${mt.fmt(v)}</b></div>`;
    }).join('');
    return rows ? `<div class="vs-grp"><b>${name}</b></div>${rows}` : '';
  }).join('');
  return `<div class="tm-head"><span></span><span>Sija</span><span>SaiPa</span></div><div class="tm">${groups}</div>
    <p class="muted small">${n ? `${sai.games} viimeisintä ottelua kunkin joukkueen omista peleistä. Ylivoiman, alivoiman, jäähyjen, kiekonhallinnan ja aloitusten sijoitus vain koko kauden otannasta.` : 'Koko kausi.'} Sija 1 = liigan paras, viiva näyttää paikan ${N} joukkueen joukossa. Keskiarvo ja kärki hiiren alla. Maaleista on poistettu voittolaukauskilpailun ratkaisumaali.</p>`;
}

/* ---------- one game in the report ---------- */
const GM_ROWS = [
  ['Tulos', [
    ['Maalit', 'gf', v => num(v, 0), true, 'Maalit ilman voittolaukauskilpailun ratkaisumaalia', 'gfpg'],
  ]],
  ['Maalipaikat', [
    ['xG', 'xgf', v => num(v, 2), true, 'Maaliodottama', 'xgfpg'],
    ['xG-osuus', 'xgShare', v => pct(v, 1), true, 'Osuus ottelun maaliodottamasta', 'xgShare'],
    ['Laukausosuus 5 v 5', 'evAtt', v => pct(v, 1), true, 'Laukausyritysten osuus tasakentällisin (5 v 5)', 'evAtt'],
  ]],
  ['Erikoistilanteet', [
    ['Ylivoima', 'pp', null, true, 'Ylivoimamaalit / ylivoimat', 'pp'],
    ['Jäähyt', 'pen', v => num(v, 0), false, 'Jäähyjen määrä', 'penPg'],
  ]],
  ['Pelin hallinta', [
    ['Kiekonhallinta', 'puck', v => pct(v, 1), true, 'Kiekonhallinta-aika osuutena', 'puck'],
    ['Aloitusvoitot', 'fo', v => pct(v, 1), true, 'Voitettujen aloitusten osuus', 'fo'],
  ]],
  ['Viimeistely ja maalivahdit', [
    ['Viimeistely (G − xG)', 'fin', v => signed(v, 2), true, 'Maalit miinus maaliodottama', 'finPg'],
    ['Maalivahdit (GSAx)', 'gsax', v => signed(v, 2), true, 'Torjutut maalit yli odotusten: vastustajan xG miinus päästetyt maalit', 'gsaxPg'],
  ]],
];

function gameSideMetrics(g, st, sm, tid, gf, ga) {
  const r = { homeTeamGoals: g.game.homeTeam.goals, awayTeamGoals: g.game.awayTeam.goals, finishedType: g.game.finishedType };
  const t = teamGame(g, st, tid, r), sp = t.special, e = evAttempts(sm, tid);
  const xgf = t.xgf ?? 0, xga = t.xga ?? 0;
  return {
    gf, xgf, xgShare: (xgf + xga) ? xgf / (xgf + xga) : null,
    evAtt: (e.f + e.a) ? e.f / (e.f + e.a) : null,
    pp: sp.ppI ? sp.ppG / sp.ppI : null, ppTxt: `${sp.ppG}/${sp.ppI}`, ppI: sp.ppI,
    pen: sp.pen, puck: (sp.puckF + sp.puckA) ? sp.puckF / (sp.puckF + sp.puckA) : null,
    fo: (sp.fw + sp.fl) ? sp.fw / (sp.fw + sp.fl) : null,
    fin: gf - xgf, gsax: xga - ga,
  };
}

let GM_LEAGUE = null, GM_LEAGUE_P = null;
// d = reportData(...): goals without the shootout winner
function gameMetricsCard(g, st, sm, d) {
  const F = d.F, O = teamNum(d.O.teamId);
  const a = gameSideMetrics(g, st, sm, F, d.gf, d.ga), b = gameSideMetrics(g, st, sm, O, d.ga, d.gf);
  const sai = { id: F, name: d.S.teamName, logo: null }, opp = { id: O, name: d.O.teamName, logo: null };
  const rows = league => GM_ROWS.map(([name, list]) => {
    const html = list.map(([label, k, fmt, hi, desc, sk]) => {
      let va = a[k], vb = b[k];
      if (k === 'pp' && !a.ppI && !b.ppI) return '';
      if (va == null && vb == null) return '';
      const f = k === 'pp' ? (x, s) => s.ppI ? `${s.ppTxt}` : '–' : (x) => fmt(x);
      const win = va == null || vb == null || va === vb ? '' : (hi ? va > vb : va < vb) ? 'a' : 'b';
      const mt = TEAM_METRICS.find(x => x.k === sk);
      const seas = t => { const L = league?.teams.get(t.id); return L && mt && L.m[sk] != null ? ` · kausi ${mt.fmt(L.m[sk])}${L.r?.[sk] ? `, Liigan ${L.r[sk]}.` : ''}` : ''; };
      const val = (s, x) => k === 'pp' ? (s.ppI ? `${s.ppTxt} (${pct(x, 0)})` : '–') : fmt(x);
      const tip = [`${label}: ${desc}`, `${sai.name}\t${val(a, va)}${seas(sai)}`, `${opp.name}\t${val(b, vb)}${seas(opp)}`].join('\n');
      return vsRow(label, f(va, a), f(vb, b), null, null, win, tip);
    }).join('');
    return html ? `<div class="vs-grp"><b>${name}</b></div>${html}` : '';
  }).join('');
  const html = league => `${vsHead(sai, opp)}<div class="vs">${rows(league)}</div>
    <p class="muted small">Parempi arvo korostettu. Hiiren alla joukkueen kauden keskiarvo ja liigasijoitus tällä hetkellä.</p>`;
  const swap = PV_SWAP;   // the season numbers arrive later: keep this game's home-first order
  const at = L => { const s = PV_SWAP; PV_SWAP = swap; try { return html(L); } finally { PV_SWAP = s; } };
  // The season numbers are loaded once; the live view redraws every few seconds and reuses them without flicker
  return { html: at(GM_LEAGUE), fill: el => { if (GM_LEAGUE) return; (GM_LEAGUE_P = GM_LEAGUE_P || loadLeague()).then(L => { GM_LEAGUE = L; if (el.isConnected) el.innerHTML = `<h2>Joukkueet vastakkain</h2>${at(L)}`; }).catch(() => { GM_LEAGUE_P = null; }); } };
}

/* ---------- hottest players of a calendar month ---------- */
const MONTH_FI = ['Tammikuu', 'Helmikuu', 'Maaliskuu', 'Huhtikuu', 'Toukokuu', 'Kesäkuu', 'Heinäkuu', 'Elokuu', 'Syyskuu', 'Lokakuu', 'Marraskuu', 'Joulukuu'];
const hkMonth = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' }).slice(0, 7);
const monthLabel = ym => `${MONTH_FI[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const MONTH_GK_MIN = 3;
const MONTH_SK_ROWS = 30;
let MONTH_SEL = null;

async function monthStats(games) {
  const sk = new Map(), gk = new Map();
  let i = 0;
  const worker = async () => {
    while (i < games.length) {
      const r = games[i++];
      const st = await getJSON(`/games/stats/${SEASON}/${r.id}`).catch(() => null);
      if (!st) continue;
      for (const side of ['home', 'away']) {
        const tid = teamNum(side === 'home' ? r.homeTeamId : r.awayTeamId);
        const seenS = new Set(), seenG = new Set();
        for (const p of st[`${side}Team`] || []) {
          if ((p.period || 0) > 4) continue;
          for (const x of p.periodPlayerStats || []) {
            const q = x.period || {};
            const t = sk.get(x.playerId) || sk.set(x.playerId, { id: x.playerId, team: tid, games: new Set(), g: 0, a: 0, pm: 0, shots: 0, toi: 0, ixg: 0 }).get(x.playerId);
            t.team = tid; t.g += q.goals || 0; t.a += q.assists || 0; t.pm += q.plusminus || 0; t.shots += q.shots || 0; t.toi += q.timeofice || 0; t.ixg += x.expectedGoalsPlayer || 0;
            if (q.timeofice) t.games.add(r.id);
            seenS.add(x.playerId);
          }
          for (const x of p.goaliePeriodStats || []) {
            const q = x.period || {};
            if (!q.timeofice) continue;
            const t = gk.get(x.playerId) || gk.set(x.playerId, { id: x.playerId, team: tid, games: new Set(), toi: 0, saves: 0, ga: 0, xga: 0 }).get(x.playerId);
            t.team = tid; t.toi += q.timeofice; t.saves += q.saves || 0; t.ga += q.goalsAllowed || 0; t.xga += x.expectedGoalsAgainst || 0; t.games.add(r.id);
            seenG.add(x.playerId);
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { sk: [...sk.values()], gk: [...gk.values()] };
}

async function renderMonthHot(el) {
  const [sched, stn, bs, bg] = await Promise.all([
    getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`),
    getJSON(`/standings/?season=${SEASON}`).catch(() => ({})),
    getJSON(`/players/stats/summed/${SEASON}/${SEASON}/${TOURNAMENT}/true?dataType=basicStats`).catch(() => []),
    getJSON(`/players/stats/summed/${SEASON}/${SEASON}/${TOURNAMENT}/true?dataType=basicStatsGk`).catch(() => []),
  ]);
  const ended = sched.filter(g => g.ended);
  const months = [...new Set(ended.map(g => hkMonth(g.start)))].sort();
  if (!months.length) { el.innerHTML = '<h2>Kuukauden kuumimmat</h2><p class="muted">Ei vielä pelattuja otteluita.</p>'; return; }
  if (!months.includes(MONTH_SEL)) MONTH_SEL = months[months.length - 1];
  const teamName = new Map((stn.season || []).map(t => [t.internalId, t.teamName]));
  const who = new Map([...(Array.isArray(bs) ? bs : []), ...(Array.isArray(bg) ? bg : [])].map(x => [x.playerId, x]));
  el.innerHTML = `<h2>Kuukauden kuumimmat</h2>
    <div class="setbar" role="tablist" aria-label="Kuukausi">${months.map(m => `<button class="sbtn" data-m="${m}">${monthLabel(m)}</button>`).join('')}</div>
    <div class="mh-body"></div>`;
  const draw = async () => {
    const ym = MONTH_SEL, body = el.querySelector('.mh-body');
    el.querySelectorAll('.sbtn').forEach(b => b.classList.toggle('active', b.dataset.m === ym));
    const games = ended.filter(g => hkMonth(g.start) === ym);
    body.innerHTML = `<p class="loading">Haetaan ${games.length} ottelun tilastot…</p>`;
    try {
      const S = await monthStats(games);
      if (ym !== MONTH_SEL) return;
      body.innerHTML = monthHtml(S, games, ym, who, teamName);
      const sk = S.sk.filter(p => p.gp && !p.isGk);
      const top = [...sk].sort((a, b) => b.pts - a.pts || b.g - a.g || a.gp - b.gp).slice(0, MONTH_SK_ROWS);
      const name = { k: 'last', l: 'Pelaaja', f: p => `${plink(p, `${esc(p.first)} ${esc(p.last)}`)} <small class="muted">${esc(p.teamName)}</small>`, s: p => p.last };
      const n0 = (k, l, t, d = 0) => ({ k, l, t, f: p => num(p[k], d), s: p => p[k] ?? -99 });
      sortableTable(body.querySelector('#mhSk'), top, [name,
        n0('gp', 'GP', 'Games Played\nOttelut'), n0('g', 'G', 'Goals\nMaalit'), n0('a', 'A', 'Assists\nSyötöt'),
        { k: 'pts', l: 'P', t: 'Points\nPisteet', f: p => `<b>${p.pts}</b>`, s: p => p.pts * 1000 + p.g },
        n0('ppg', 'P/GP', 'Points per Game\nPisteet ottelua kohden', 2),
        { k: 'pm', l: '+/-', t: 'Plus/Minus\nPlusmiinus', f: p => signed(p.pm, 0), s: p => p.pm },
        n0('shots', 'S', 'Shots\nLaukaukset'), n0('ixg', 'xG', 'Expected Goals\nMaaliodottama omista laukauksista', 1),
        { k: 'toiGp', l: 'TOI/GP', t: 'Time on Ice per Game\nPeliaika ottelua kohden', f: p => mmss(p.toiGp), s: p => p.toiGp },
      ], 'pts', p => p.team === SAIPA_NUM ? 'me' : '');
      const gks = S.gk.filter(p => p.gp >= MONTH_GK_MIN).sort((a, b) => (b.sv ?? 0) - (a.sv ?? 0));
      const gEl = body.querySelector('#mhGk');
      if (!gks.length) gEl.innerHTML = `<p class="muted">Ei maalivahteja, joilla vähintään ${MONTH_GK_MIN} ottelua.</p>`;
      else sortableTable(gEl, gks, [name,
        n0('gp', 'GP', 'Games Played\nOttelut'),
        { k: 'sv', l: 'SV%', t: 'Save Percentage\nTorjuntaprosentti', f: p => `<b>${pct(p.sv, 1)}</b>`, s: p => p.sv ?? -1 },
        { k: 'gsax', l: 'GSAx', t: 'Goals Saved Above Expected\nTorjutut maalit yli odotusten', f: p => signed(p.gsax, 2), s: p => p.gsax },
        n0('gaa', 'GAA', 'Goals Against Average\nPäästetyt maalit 60 minuuttia kohden', 2),
        n0('saves', 'SV', 'Saves\nTorjunnat'), n0('sa', 'SA', 'Shots Against\nLaukaukset maalia kohti'),
      ], 'sv', p => p.team === SAIPA_NUM ? 'me' : '');
    } catch (e) { body.innerHTML = `<p class="neg-num">Lataus epäonnistui: ${esc(e.message)}</p>`; }
  };
  el.querySelectorAll('.sbtn').forEach(b => b.onclick = () => { MONTH_SEL = b.dataset.m; draw(); });
  draw();

  function decorate(p) {
    const w = who.get(p.id) || {};
    Object.assign(p, { first: w.firstName || '', last: w.lastName || '?', teamName: teamName.get(p.team) || '' });
    p.gp = p.games.size;
    p.isGk = !!w.goalkeeper;
    return p;
  }
  function monthHtml(S, games, ym, who, teamName) {
    for (const p of S.sk) { decorate(p); p.pts = p.g + p.a; p.ppg = p.gp ? p.pts / p.gp : 0; p.toiGp = p.gp ? p.toi / p.gp : 0; }
    for (const p of S.gk) { decorate(p); p.sa = p.saves + p.ga; p.sv = p.sa ? p.saves / p.sa : null; p.gsax = p.xga - p.ga; p.gaa = p.toi ? p.ga / p.toi * 3600 : null; }
    const sk = S.sk.filter(p => p.gp && !p.isGk), gk = S.gk.filter(p => p.gp >= MONTH_GK_MIN);
    const nm = p => `${p.first} ${p.last}`;
    const tiles = [
      ['🏆', 'Eniten pisteitä', 'P', [...sk].sort((a, b) => b.pts - a.pts || b.g - a.g || a.gp - b.gp), p => p.pts, p => `${p.g}+${p.a} · ${p.gp} ottelua`],
      ['🚨', 'Eniten maaleja', 'G', [...sk].sort((a, b) => b.g - a.g || b.pts - a.pts), p => p.g, p => `${p.gp} ottelua · xG ${num(p.ixg, 1)}`],
      ['📊', 'Paras pistetahti', 'P/GP', sk.filter(p => p.gp >= 3).sort((a, b) => b.ppg - a.ppg || b.pts - a.pts), p => num(p.ppg, 2), p => `${p.pts} P · ${p.gp} ottelua`],
      ['➕', 'Paras plusmiinus', '+/-', [...sk].sort((a, b) => b.pm - a.pm || b.pts - a.pts), p => signed(p.pm, 0), p => `${p.gp} ottelua`],
      ['🧤', 'Paras torjuntaprosentti', 'SV%', [...gk].sort((a, b) => b.sv - a.sv), p => pct(p.sv, 1), p => `${p.gp} ottelua · GSAx ${signed(p.gsax, 1)}`],
      ['🧱', 'Eniten torjuttu yli odotusten', 'GSAx', [...gk].sort((a, b) => b.gsax - a.gsax), p => signed(p.gsax, 2), p => `${p.gp} ottelua · SV% ${pct(p.sv, 1)}`],
    ].filter(t => t[3].length).map(([ic, k, unit, list, val, sub]) => {
      const p = list[0];
      const tip = [`${ic} ${k}, ${monthLabel(ym).toLowerCase()}`, ...list.slice(0, 5).map((x, i) => `${i + 1}. ${nm(x)} (${x.teamName})\t${val(x)} ${unit}`)].join('\n');
      return tile(ic, k, val(p), unit, { first: p.first, last: `${p.last}${p.teamName ? ` · ${p.teamName}` : ''}` }, sub(p), p.team === SAIPA_NUM ? 'pos' : '', tip);
    });
    const days = [...new Set(games.map(g => g.start.slice(0, 10)))].length;
    return `<p class="muted small">${monthLabel(ym)}: ${games.length} ottelua, ${days} pelipäivää. SaiPan pelaajat korostettu.</p>
      <div class="tiles s-hl" data-n="${tiles.length}">${tiles.join('')}</div>
      <h3>Kenttäpelaajat <span class="h2-sub">${MONTH_SK_ROWS} eniten pisteitä</span></h3>
      <div class="tablewrap" id="mhSk"></div>
      <h3>Maalivahdit <span class="h2-sub">vähintään ${MONTH_GK_MIN} ottelua</span></h3>
      <div class="tablewrap" id="mhGk"></div>
      <p class="muted small">Kalenterikuukauden runkosarjaottelut Suomen aikaa. Voittolaukauskilpailu ei mukana. Tasapisteissä enemmän maaleja ensin.</p>`;
  }
}
