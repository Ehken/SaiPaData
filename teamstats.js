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
// Every team number one game gives. Rows marked `any` are shown only when either team has one.
// hi: true = more is better, false = less is better, null = no better side (only shown).
const ratio = (a, b) => b ? a / b : null;
const GM_ROWS = [
  ['Tulos', [
    { l: 'Maalit', k: 'gf', f: v => num(v, 0), hi: true, d: 'Maalit ilman voittolaukauskilpailun ratkaisumaalia', sk: 'gfpg' },
    { l: 'Ylivoimamaalit', k: 'ppG', f: v => num(v, 0), hi: true, d: 'Maalit ylivoimalla', any: true },
    { l: 'Alivoimamaalit', k: 'shG', f: v => num(v, 0), hi: true, d: 'Maalit alivoimalla', any: true },
    { l: 'Tyhjiin maaleihin', k: 'enG', f: v => num(v, 0), hi: true, d: 'Maalit tyhjään maaliin', any: true },
    { l: 'Aika johdossa', k: 'lead', f: v => mmss(v), hi: true, d: 'Peliaika, jonka joukkue oli johdossa', t: s => `tasan ${mmss(s.tie)}` },
  ]],
  ['Laukaukset', [
    { l: 'Laukaukset maalia kohti', k: 'sog', f: v => num(v, 0), hi: true, d: 'Maalit ja torjunnat (SOG)' },
    { l: 'Laukausyritykset', k: 'att', f: v => num(v, 0), hi: true, d: 'Kaikki yritykset: maalia kohti, ohi ja blokatut (CF)' },
    { l: 'Ohi', k: 'miss', f: v => num(v, 0), hi: null, d: 'Laukaukset ohi maalin' },
    { l: 'Blokattu', k: 'blkd', f: v => num(v, 0), hi: false, d: 'Omat laukaukset, jotka vastustaja blokkasi' },
    { l: 'Blokkaukset', k: 'blk', f: v => num(v, 0), hi: true, d: 'Vastustajan laukaukset, jotka joukkue blokkasi' },
  ]],
  ['Maalipaikat', [
    { l: 'xG', k: 'xgf', f: v => num(v, 2), hi: true, d: 'Maaliodottama', sk: 'xgfpg' },
    { l: 'xG-osuus', k: 'xgShare', f: v => pct(v, 1), hi: true, d: 'Osuus ottelun maaliodottamasta', sk: 'xgShare' },
    { l: 'xG 5 v 5', k: 'evXg', f: v => num(v, 2), hi: true, d: 'Maaliodottama tasakentällisin (5 v 5)' },
    { l: 'Laukausosuus 5 v 5', k: 'evAtt', f: v => pct(v, 1), hi: true, d: 'Laukausyritysten osuus tasakentällisin (5 v 5)', sk: 'evAtt', t: s => `${s.evF}–${s.evA} yritystä` },
    { l: 'Laukaukset maalin edestä', k: 'hd', f: v => num(v, 0), hi: true, d: 'Laukausyritykset maalin edustalta (NHL:n High-Danger: enintään 8,8 m maalin keskeltä)', t: s => `joista maaleja ${s.hdG}` },
    { l: 'xG maalin edestä', k: 'hdXg', f: v => num(v, 2), hi: true, d: 'Maaliodottama maalin edustan laukauksista' },
    { l: 'Reboundit', k: 'reb', f: v => num(v, 0), hi: true, d: `Laukaukset enintään ${REB_S} s oman torjutun laukauksen jälkeen`, t: s => `joista maaleja ${s.rebG}` },
    { l: 'Nopeat hyökkäykset', k: 'rush', f: v => num(v, 0), hi: true, d: `Laukaukset enintään ${RUSH_S} s vastustajan laukausyrityksen jälkeen`, t: s => `joista maaleja ${s.rushG}` },
  ]],
  ['Erikoistilanteet', [
    { l: 'Ylivoima', k: 'pp', f: (v, s) => s.ppI ? `${s.ppG2}/${s.ppI}` : '–', hi: true, d: 'Ylivoimamaalit / ylivoimat', sk: 'pp', t: s => s.ppI ? pct(s.pp, 0) : '' },
    { l: 'Ylivoiman xG', k: 'ppXg', f: v => num(v, 2), hi: true, d: 'Maaliodottama ylivoimalla', any: true },
    { l: 'Jäähyt', k: 'pen', f: v => num(v, 0), hi: false, d: 'Jäähyjen määrä', sk: 'penPg' },
    { l: 'Jäähyminuutit', k: 'pim', f: v => num(v, 0), hi: false, d: 'Jäähyminuutit yhteensä' },
  ]],
  ['Pelin hallinta', [
    { l: 'Kiekonhallinta', k: 'puck', f: v => pct(v, 1), hi: true, d: 'Kiekonhallinta-aika osuutena', sk: 'puck', t: s => mmss(s.puckF) },
    { l: 'Aloitusvoitot', k: 'fo', f: v => pct(v, 1), hi: true, d: 'Voitettujen aloitusten osuus', sk: 'fo', t: s => `${s.fw}/${s.fw + s.fl}` },
    { l: 'Aloitukset hyökkäyspäässä', k: 'foOT', f: v => num(v, 0), hi: true, d: 'Aloitusten määrä hyökkäysalueella: kertoo alueellisesta hallinnasta' },
    { l: 'Aloitusvoitot hyökkäyspäässä', k: 'foO', f: v => pct(v, 1), hi: true, d: 'Voitetut aloitukset hyökkäysalueella', t: s => `${s.foOW}/${s.foOT}` },
    { l: 'Aloitusvoitot puolustuspäässä', k: 'foD', f: v => pct(v, 1), hi: true, d: 'Voitetut aloitukset puolustusalueella', t: s => `${s.foDW}/${s.foDT}` },
    { l: 'Syötöt', k: 'passes', f: v => num(v, 0), hi: null, d: 'Syöttöjen määrä' },
    { l: 'Syöttöjen onnistuminen', k: 'passPct', f: v => pct(v, 1), hi: true, d: 'Onnistuneiden syöttöjen osuus', t: s => `${s.passOk}/${s.passes}` },
    { l: 'Syötöt paineen alla', k: 'prPct', f: v => pct(v, 1), hi: true, d: 'Onnistuneiden syöttöjen osuus vastustajan paineen alla', t: s => `${s.prOk}/${s.pr}` },
    { l: 'Syötöt kovan paineen alla', k: 'hprPct', f: v => pct(v, 1), hi: true, d: 'Onnistuneiden syöttöjen osuus vastustajan kovan paineen alla', t: s => `${s.hprOk}/${s.hpr}` },
  ]],
  ['Luistelu ja laukaukset', [
    { l: 'Luistelumatka', k: 'dist', f: v => `${num(v / 1000, 1)} km`, hi: null, d: 'Joukkueen pelaajien yhteenlaskettu luistelumatka' },
    { l: 'Kovin nopeus', k: 'speed', f: v => kmh(v), hi: true, d: 'Ottelun suurin luistelunopeus', t: s => s.speedWho },
    { l: 'Kovin laukaus', k: 'shot', f: v => kmh(v), hi: true, d: 'Ottelun kovin laukaus', t: s => s.shotWho },
  ]],
  ['Viimeistely ja maalivahdit', [
    { l: 'Torjuntaprosentti', k: 'sv', f: v => pct(v, 1), hi: true, d: 'Maalivahtien torjuntaprosentti', t: s => `${s.saves}/${s.saves + s.gkGa}` },
    { l: 'Maalivahdit (GSAx)', k: 'gsax', f: v => signed(v, 2), hi: true, d: 'Torjutut maalit yli odotusten: vastustajan xG miinus päästetyt maalit', sk: 'gsaxPg' },
    { l: 'Viimeistely (G − xG)', k: 'fin', f: v => signed(v, 2), hi: true, d: 'Maalit miinus maaliodottama. Sama luku kuin vastustajan GSAx käännettynä', sk: 'finPg' },
  ]],
];

// One team's numbers in one game. tid = the team, d = reportData from the focus team's side.
function gameSideMetrics(g, st, sm, tid, d) {
  const side = teamNum(g.game.homeTeam.teamId) === tid ? 'home' : 'away';
  const own = tid === d.F;
  const r = { homeTeamGoals: g.game.homeTeam.goals, awayTeamGoals: g.game.awayTeam.goals, finishedType: g.game.finishedType };
  const t = teamGame(g, st, tid, r), sp = t.special;
  const gf = own ? d.gf : d.ga, ga = own ? d.ga : d.gf;
  const xgf = t.xgf ?? 0, xga = t.xga ?? 0;
  const goals = d.goals.filter(x => x.valid && x.mine === own);
  const typ = p => goals.filter(x => x.types.some(y => y.startsWith(p))).length;
  // Time ahead, level and behind, up to now in a game in progress
  const tEnd = d.now != null ? d.now : d.end;
  let lead = 0, tie = 0, prev = 0, diff = 0;
  for (const x of d.goals.filter(x => x.valid && x.t <= tEnd)) {
    const dt = x.t - prev; if (diff > 0) lead += dt; else if (diff === 0) tie += dt;
    diff += x.mine === own ? 1 : -1; prev = x.t;
  }
  { const dt = tEnd - prev; if (diff > 0) lead += dt; else if (diff === 0) tie += dt; }
  // Shot map: rows of both teams, the shootout left out
  const S = (sm || []).filter(s => (s.period || 0) <= 4).map(normShot);
  const mine = S.filter(s => Number(s.shootingTeamId) === tid), theirs = S.filter(s => Number(s.shootingTeamId) !== tid);
  const xs = a => a.reduce((s, x) => s + (x.xg || 0), 0);
  const ev = s => s.ownTeamPlayersOnIce === 6 && s.otherTeamPlayersOnIce === 6;
  const hd = mine.filter(s => s.zone === 'slot');
  const evF = mine.filter(ev).length, evA = theirs.filter(ev).length;
  // Period player and goalie stats
  const per = (st[`${side}Team`] || []).filter(p => (p.period || 0) <= 4);
  const P = per.flatMap(p => p.periodPlayerStats || []), G = per.flatMap(p => p.goaliePeriodStats || []);
  const add = f => P.reduce((s, x) => s + (f(x) || 0), 0);
  const passes = add(x => x.totalPasses), passOk = add(x => x.successfulPasses);
  const pr = add(x => x.playerPassesUnderPressure), prOk = add(x => x.playerSuccessfulPassesUnderPressure);
  const hpr = add(x => x.playerPassesUnderHighPressure), hprOk = add(x => x.playerSuccessfulPassesUnderHighPressure);
  const foOT = add(x => x.period?.faceoffsOffenceTotal), foOW = add(x => x.period?.faceoffsOffenceWon);
  const foDT = add(x => x.period?.faceoffsDefenceTotal), foDW = add(x => x.period?.faceoffsDefenceWon);
  const saves = G.reduce((s, x) => s + (x.period?.saves || 0), 0), gkGa = G.reduce((s, x) => s + (x.period?.goalsAllowed || 0), 0);
  const dist = per.reduce((s, p) => s + (p.totalDistanceTravelled || 0), 0) || add(x => x.distance);
  const names = new Map(((side === 'home' ? g.homeTeamPlayers : g.awayTeamPlayers) || []).map(p => [p.id, `${p.firstName} ${p.lastName}`]));
  const ext = st[`${side}TeamGamePlayerStats`] || [];
  const best = k => ext.reduce((b, x) => (x[k] || 0) > (b?.[k] || 0) ? x : b, null);
  const bs = best('topSpeed'), bh = best('hardestShot');
  return {
    gf, ppG: typ('YV'), shG: typ('AV'), enG: goals.filter(x => x.types.includes('TM')).length, lead, tie,
    sog: mine.filter(s => s.sog).length, att: mine.length,
    miss: mine.filter(s => s.eventType === 'MISSED' || s.eventType === 'MISS').length,
    blkd: mine.filter(s => s.eventType === 'PLAYER_BLOCKED').length, blk: theirs.filter(s => s.eventType === 'PLAYER_BLOCKED').length,
    xgf, xgShare: (xgf + xga) ? xgf / (xgf + xga) : null, evXg: xs(mine.filter(ev)),
    evAtt: ratio(evF, evF + evA), evF, evA,
    hd: hd.length, hdG: hd.filter(s => s.goal).length, hdXg: xs(hd),
    reb: mine.filter(s => s.reb).length, rebG: mine.filter(s => s.reb && s.goal).length,
    rush: mine.filter(s => s.rush).length, rushG: mine.filter(s => s.rush && s.goal).length,
    pp: ratio(sp.ppG, sp.ppI), ppG2: sp.ppG, ppI: sp.ppI, ppXg: xs(mine.filter(s => s.type === 'PowerplayShot')),
    pen: sp.pen, pim: per.reduce((s, p) => s + (p.penaltyMinutes || 0), 0),
    puck: ratio(sp.puckF, sp.puckF + sp.puckA), puckF: sp.puckF,
    fo: ratio(sp.fw, sp.fw + sp.fl), fw: sp.fw, fl: sp.fl,
    foOT, foOW, foDT, foDW, foO: ratio(foOW, foOT), foD: ratio(foDW, foDT),
    passes: passes || null, passOk, passPct: ratio(passOk, passes), pr, prOk, prPct: ratio(prOk, pr), hpr, hprOk, hprPct: ratio(hprOk, hpr),
    dist: dist || null, speed: bs?.topSpeed || null, speedWho: names.get(bs?.playerId) || '', shot: bh?.hardestShot || null, shotWho: names.get(bh?.playerId) || '',
    sv: ratio(saves, saves + gkGa), saves, gkGa, gsax: xga - ga, fin: gf - xgf,
  };
}

let GM_LEAGUE = null, GM_LEAGUE_P = null;
// d = reportData(...): goals without the shootout winner
function gameMetricsCard(g, st, sm, d) {
  if (Array.isArray(sm) && sm.some(s => s.reb === undefined)) shotContext(sm, g);   // live data comes without rebound/rush flags
  const F = d.F, O = teamNum(d.O.teamId);
  const a = gameSideMetrics(g, st, sm, F, d), b = gameSideMetrics(g, st, sm, O, d);
  const sai = { id: F, name: d.S.teamName, logo: null }, opp = { id: O, name: d.O.teamName, logo: null };
  const rows = league => GM_ROWS.map(([name, list]) => {
    const html = list.map(row => {
      const va = a[row.k], vb = b[row.k];
      if (va == null && vb == null) return '';
      if (row.any && !va && !vb) return '';
      const win = row.hi == null || va == null || vb == null || va === vb ? '' : (row.hi ? va > vb : va < vb) ? 'a' : 'b';
      const mt = row.sk && TEAM_METRICS.find(x => x.k === row.sk);
      const seas = tm => { const L = league?.teams.get(tm.id); return L && mt && L.m[row.sk] != null ? ` · kausi ${mt.fmt(L.m[row.sk])}${L.r?.[row.sk] ? `, Liigan ${L.r[row.sk]}.` : ''}` : ''; };
      const val = (s, v) => { const x = v == null ? '–' : row.f(v, s), e = row.t && v != null ? row.t(s) : ''; return e ? `${x} (${e})` : x; };
      const tip = [`${row.l}: ${row.d}`, `${sai.name}\t${val(a, va)}${seas(sai)}`, `${opp.name}\t${val(b, vb)}${seas(opp)}`].join('\n');
      return vsRow(row.l, va == null ? '–' : row.f(va, a), vb == null ? '–' : row.f(vb, b), null, null, win, tip);
    }).join('');
    return html ? `<div class="vs-grp"><b>${name}</b></div>${html}` : '';
  }).join('');
  const html = league => `${vsHead(sai, opp)}<div class="vs">${rows(league)}</div>
    <p class="muted small">Parempi arvo korostettu, kun suunta on selvä. Hiiren alla tarkemmat luvut sekä kauden keskiarvo ja liigasijoitus niissä mittareissa, joista se on saatavilla. Voittolaukauskilpailu ei mukana.</p>`;
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
        const sideTid = teamNum(side === 'home' ? r.homeTeamId : r.awayTeamId);
        for (const p of st[`${side}Team`] || []) {
          if ((p.period || 0) > 4) continue;
          // Each stats row names its own team; the schedule side is only a fallback
          const tid = teamNum(p.teamId) || sideTid;
          for (const x of p.periodPlayerStats || []) {
            const q = x.period || {};
            const t = sk.get(x.playerId) || sk.set(x.playerId, { id: x.playerId, team: tid, games: new Set(), g: 0, a: 0, pm: 0, shots: 0, toi: 0, ixg: 0 }).get(x.playerId);
            t.team = tid; t.g += q.goals || 0; t.a += q.assists || 0; t.pm += q.plusminus || 0; t.shots += q.shots || 0; t.toi += q.timeofice || 0; t.ixg += x.expectedGoalsPlayer || 0;
            if (q.timeofice) t.games.add(r.id);
          }
          for (const x of p.goaliePeriodStats || []) {
            const q = x.period || {};
            if (!q.timeofice) continue;
            const t = gk.get(x.playerId) || gk.set(x.playerId, { id: x.playerId, team: tid, games: new Set(), toi: 0, saves: 0, ga: 0, xga: 0 }).get(x.playerId);
            t.team = tid; t.toi += q.timeofice; t.saves += q.saves || 0; t.ga += q.goalsAllowed || 0; t.xga += x.expectedGoalsAgainst || 0; t.games.add(r.id);
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

/* ---------- SaiPa goalies side by side over each goalie's own last N games ---------- */
// Shown in the same form as liiga.fi's goalie stats (PO, V, T, H, V%, TO, PM, T%, NP, KA, xGA, xGAE, A) plus QS%.
// Every number has the goalie's rank among the league's goalies over the same window (each goalie's own last N games).
// Ice time, saves, goals against and xGA per game come from each game's stats; wins, 60-minute ties, losses and
// shutouts from the goalies' own game logs, exactly as the league records them: V/T/H is the 60-minute result
// (an overtime or shootout game is T), the decision goes to the goalie in net at the deciding goal (HIFK–Lukko 1–5,
// 2025–26: the win went to Lukko's starter with 23 minutes, not to the goalie with the most ice time), and
// V% = (V + T/2) / PO as on liiga.fi. Quality start (Rob Vollman): a start with save % at least the league average,
// or at least .885 on 20 shots or fewer.
const GKC_WINDOWS = [1, 2, 3, 4, 5, 10, 15, 20, 30, 0];
let GKC_N = 5, GKC_PER = false;

// All league goalies' game logs from the season's played games. before = ISO time (rebuilt previews).
const GKC_CACHE = new Map();
function leagueGoalieLogs(before = null) {
  const key = before || 'now';
  if (GKC_CACHE.has(key)) return GKC_CACHE.get(key);
  const p = (async () => {
    const sched = await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`);
    const rows = sched.filter(g => g.ended && (!before || g.start < before)).sort((a, b) => a.start.localeCompare(b.start));
    const L = new Map();
    let i = 0;
    const per = new Map();
    const worker = async () => {
      while (i < rows.length) {
        const r = rows[i++];
        const st = await getJSON(`/games/stats/${SEASON}/${r.id}`).catch(() => null);
        if (!st) continue;
        const out = [];
        for (const side of ['home', 'away']) {
          const home = side === 'home';
          const T = new Map();
          let first = null;
          for (const pr of st[`${side}Team`] || []) {
            if ((pr.period || 0) > 4) continue;
            for (const x of pr.goaliePeriodStats || []) {
              const q = x.period || {};
              if (!q.timeofice) continue;
              if (pr.period === 1 && first == null) first = x.playerId;
              const t = T.get(x.playerId) || T.set(x.playerId, { id: x.playerId, team: teamNum(pr.teamId) || teamNum(home ? r.homeTeamId : r.awayTeamId), toi: 0, saves: 0, gaG: 0, xga: 0 }).get(x.playerId);
              t.toi += q.timeofice; t.saves += q.saves || 0; t.gaG += q.goalsAllowed || 0; t.xga += x.expectedGoalsAgainst || 0;
            }
          }
          const so = r.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION', ot = r.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME';
          const gf = home ? r.homeTeamGoals : r.awayTeamGoals, ga = home ? r.awayTeamGoals : r.homeTeamGoals;
          for (const t of T.values()) out.push({ ...t, game: r.id, start: r.start, started: t.id === first, opp: home ? r.awayTeamName : r.homeTeamName,
            gf, ga, extra: so ? 'VL' : ot ? 'JA' : '' });
        }
        per.set(r.id, out);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    for (const r of rows) for (const x of per.get(r.id) || []) (L.get(x.id) || L.set(x.id, { id: x.id, team: x.team, log: [] }).get(x.id)).log.push(x);
    // Names, team and the league's own decisions from each goalie's game log
    const [bg] = await Promise.all([getJSON(`/players/stats/summed/${SEASON}/${SEASON}/${TOURNAMENT}/true?dataType=basicStatsGk`).catch(() => [])]);
    const who = new Map((Array.isArray(bg) ? bg : []).map(x => [x.playerId, x]));
    await Promise.all([...L.values()].map(g => getJSON(`/players/info/${g.id}/games/${SEASON}`).then(J => {
      const by = new Map((J.regular || []).map(x => [x.gameId, x]));
      for (const x of g.log) { const y = by.get(x.game); x.dec = y ? (y.won ? 'V' : y.tied ? 'T' : y.lost ? 'H' : null) : null; x.shutout = !!y?.shutOut; }
    }).catch(() => {})));
    for (const g of L.values()) { const w = who.get(g.id) || {}; g.first = w.firstName || ''; g.last = w.lastName || '?'; g.team = g.log[g.log.length - 1]?.team ?? g.team; }
    const sv = bg.reduce ? bg.reduce((a, x) => a + (x.blockedOrSavedShots || 0), 0) : 0, gaT = bg.reduce ? bg.reduce((a, x) => a + (x.goalsAgainst || 0), 0) : 0;
    return { goalies: [...L.values()], lgSv: sv + gaT ? sv / (sv + gaT) : null, teamGames: Math.max(0, ...[...new Set(rows.flatMap(r => [teamNum(r.homeTeamId), teamNum(r.awayTeamId)]))].map(t => rows.filter(r => teamNum(r.homeTeamId) === t || teamNum(r.awayTeamId) === t).length)) };
  })();
  GKC_CACHE.set(key, p);
  p.catch(() => GKC_CACHE.delete(key));
  return p;
}

function goalieWindow(g, n, lgSv) {
  const log = n ? g.log.slice(-n) : g.log;
  const s = f => log.reduce((a, x) => a + (f(x) || 0), 0);
  const toi = s(x => x.toi), saves = s(x => x.saves), ga = s(x => x.gaG), xga = s(x => x.xga), sa = saves + ga, gp = log.length;
  const v = log.filter(x => x.dec === 'V').length, t = log.filter(x => x.dec === 'T').length, h = log.filter(x => x.dec === 'H').length;
  const starts = log.filter(x => x.started);
  const qs = lgSv == null ? null : starts.filter(x => { const a = x.saves + x.gaG; return a && (x.saves / a >= lgSv || (a <= 20 && x.saves / a >= 0.885)); }).length;
  return { ...g, log, gp, gs: starts.length, v, t, h, vPct: gp ? (v + t / 2) / gp : null, saves, ga, sa, xga, xgae: ga - xga, toi,
    sv: sa ? saves / sa : null, so: log.filter(x => x.shutout).length, gaa: toi ? ga / toi * 3600 : null,
    qs, qsPct: qs != null && starts.length ? qs / starts.length : null, from: log[0]?.start, to: log[gp - 1]?.start };
}

// pg: the value per game (null = the row has no per-game form). hi: true = more is better, false = less is better.
const minSec = s => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const GKC_ROWS = [
  { k: 'gp', l: 'PO', t: 'Games Played\nPelatut ottelut', v: p => p.gp, f: v => num(v, 0), hi: true, sub: p => p.gs !== p.gp ? `${p.gs} aloitusta` : '' },
  { k: 'v', l: 'V', t: 'Wins\nVoitot varsinaisella peliajalla, Liigan kirjaus', v: p => p.v, f: (v, per) => num(v, per ? 2 : 0), hi: true, pg: true },
  { k: 't', l: 'T', t: 'Ties\nTasapelit 60 minuutin jälkeen (jatkoaika- ja voittolaukausottelut), Liigan kirjaus', v: p => p.t, f: (v, per) => num(v, per ? 2 : 0), hi: null, pg: true },
  { k: 'h', l: 'H', t: 'Losses\nTappiot varsinaisella peliajalla, Liigan kirjaus', v: p => p.h, f: (v, per) => num(v, per ? 2 : 0), hi: false, pg: true },
  { k: 'vPct', l: 'V%', t: 'Win Percentage\nVoittoprosentti kuten liiga.fi: (V + T/2) / PO', v: p => p.vPct, f: v => pct(v, 1), hi: true },
  { k: 'saves', l: 'TO', t: 'Saves\nTorjunnat', v: p => p.saves, f: (v, per) => num(v, per ? 1 : 0), hi: true, pg: true },
  { k: 'ga', l: 'PM', t: 'Goals Against\nPäästetyt maalit', v: p => p.ga, f: (v, per) => num(v, per ? 2 : 0), hi: false, pg: true },
  { k: 'sv', l: 'T%', t: 'Save Percentage\nTorjuntaprosentti', v: p => p.sv, f: v => pct(v, 2), hi: true },
  { k: 'so', l: 'NP', t: 'Shutouts\nNollapelit', v: p => p.so, f: (v, per) => num(v, per ? 2 : 0), hi: true, pg: true },
  { k: 'gaa', l: 'KA', t: 'Goals Against Average\nPäästettyjen maalien keskiarvo 60 minuuttia kohden', v: p => p.gaa, f: v => num(v, 2), hi: false },
  { k: 'xga', l: 'xGA', t: 'Expected Goals Against\nMaaliodottama: kuinka monta maalia vastustajan laukaisupaikoista tulisi keskimäärin', v: p => p.xga, f: v => num(v, 2), hi: null, pg: true },
  { k: 'xgae', l: 'xGAE', t: 'Expected Goals Against Error\nPäästetyt maalit miinus maaliodottama (PM − xGA). Miinus = päästänyt vähemmän kuin odotettiin', v: p => p.xgae, f: v => signed(v, 2), hi: false, pg: true },
  { k: 'qsPct', l: 'QS%', t: 'Quality Start Percentage\nLaatualoitusten osuus: torjunta-% vähintään liigan keskiarvo, tai vähintään 88,5 % kun laukauksia enintään 20', v: p => p.qsPct, f: v => pct(v, 0), hi: true, sub: p => p.gs && p.qs != null ? `${p.qs}/${p.gs}` : '' },
  { k: 'toi', l: 'A', t: 'Time on Ice\nPeliaika (min:s)', v: p => p.toi, f: v => minSec(v), hi: true, pg: true },
];
const gkcVal = (r, p, per) => { const v = r.v(p); return v == null ? null : per && r.pg ? (p.gp ? v / p.gp : null) : v; };

// Ranks among the league's goalies over the same window. Qualified: at least n games in the window
// (whole season: at least a third of the team games played so far, as a minimum of 3).
function gkcRanks(all, n, per, teamGames) {
  const min = n ? n : Math.max(3, Math.ceil(teamGames / 3));
  const q = all.filter(p => p.gp >= min);
  const R = new Map();
  for (const r of GKC_ROWS) {
    if (r.hi == null) { R.set(r.k, { n: q.length }); continue; }
    const vals = q.map(p => ({ id: p.id, v: gkcVal(r, p, per) })).filter(x => x.v != null).sort((a, b) => r.hi ? b.v - a.v : a.v - b.v);
    const m = new Map(); vals.forEach(x => m.set(x.id, 1 + vals.findIndex(y => y.v === x.v)));
    R.set(r.k, { m, n: vals.length });
  }
  return { R, min, n: q.length };
}

function goalieCompareHtml(gks, ranks, n, per, compact = false) {
  if (!gks.length) return '<p class="muted">Ei pelanneita maalivahteja.</p>';
  const keys = compact ? ['gp', 'vPct', 'sv', 'gaa', 'xgae', 'qsPct'] : GKC_ROWS.map(r => r.k);
  const rows = GKC_ROWS.filter(r => keys.includes(r.k)).map(r => {
    const vals = gks.map(p => gkcVal(r, p, per)).filter(v => v != null);
    const best = r.hi == null || gks.length < 2 || !vals.length ? null : (r.hi ? Math.max(...vals) : Math.min(...vals));
    const tied = best != null && vals.every(v => v === best);
    const RR = ranks?.R.get(r.k);
    const cell = p => {
      const v = gkcVal(r, p, per), rk = RR?.m?.get(p.id), sub = r.sub ? r.sub(p) : '';
      const tip = rk ? `Liigan ${rk}. / ${RR.n} maalivahtia, joilla vähintään ${ranks.min} ottelua tällä otannalla` : ranks ? `Ei sijoitusta: alle ${ranks.min} ottelua tällä otannalla` : '';
      return `<td class="${best != null && !tied && v === best ? 'gkc-best' : ''}"${tip ? ` data-tip="${esc(tip)}"` : ''}><b>${v == null ? '–' : r.f(v, per && r.pg)}</b>${rk ? ` <span class="gkc-rk">(${rk}.)</span>` : ''}${sub ? ` <small>${sub}</small>` : ''}</td>`;
    };
    return `<tr><th data-tip="${esc(r.t)}">${r.l}${per && r.pg ? '<small>/ott.</small>' : ''}</th>${gks.map(cell).join('')}</tr>`;
  }).join('');
  const range = p => p.from ? `${fiDate(p.from)}–${fiDate(p.to)}` : '';
  const form = p => `<div class="gkc-form">${p.log.map(x => {
    const xgae = x.gaG - x.xga, sv = (x.saves + x.gaG) ? x.saves / (x.saves + x.gaG) : null;
    const tip = `${fiDate(x.start)} vs ${x.opp}, ${x.gf}–${x.ga}${x.extra ? ' ' + x.extra : ''}\nTorjunnat\t${x.saves}/${x.saves + x.gaG} (${pct(sv, 1)})\nxGAE\t${signed(xgae, 2)}\nPeliaika\t${minSec(x.toi)}${x.started ? '' : '\nTuli kesken ottelun'}`;
    return `<i class="${xgae <= -0.5 ? 'g' : xgae >= 0.5 ? 'b' : ''}" data-tip="${esc(tip)}">${x.dec || '·'}</i>`;
  }).join('')}</div>`;
  return `<div class="tablewrap"><table class="data gkc" style="width:min(100%, ${170 + gks.length * 210}px)"><thead><tr><th></th>${gks.map(p => `<th>${plink(p, `${esc(p.first)} ${esc(p.last)}`)}<small>${range(p)}</small></th>`).join('')}</tr></thead>
    <tbody>${rows}${compact ? '' : `<tr><th data-tip="Ottelut vanhimmasta uusimpaan, Liigan kirjaus\nV = voitto, T = tasan 60 minuutin jälkeen, H = tappio, · = ei ratkaisua\nVihreä = xGAE enintään −0,5, punainen = vähintään +0,5">Ottelut</th>${gks.map(p => `<td>${form(p)}</td>`).join('')}</tr>`}</tbody></table></div>
    <p class="muted small">${n ? `Kunkin maalivahdin ${n} viimeisintä omaa ottelua tältä kaudelta` : 'Koko kausi'}${per ? ', määrät ottelua kohden' : ''}. Suluissa sija liigan ${ranks ? ranks.n : ''} maalivahdin joukossa, joilla vähintään ${ranks ? ranks.min : '–'} ottelua samalla otannalla (1 = paras). Paras SaiPan arvo korostettu.</p>`;
}

// before: ISO time; only games before it count (rebuilt previews of played games). The first argument may be a
// list of games (older callers); it is ignored, the league's game stats are the source.
async function goalieCompareData(a = null, b = null) {
  const before = typeof a === 'string' ? a : b;
  const L = await leagueGoalieLogs(before);
  return { ...L, logs: L.goalies.filter(g => g.team === SAIPA_NUM).sort((x, y) => y.log.length - x.log.length) };
}

// Fixed column order for the whole card: most games this season first, then ice time, then surname
const GKC_ORDER = new Map();
function goalieCompareCard(el, data, { compact = false, title = 'Maalivahtivertailu' } = {}) {
  GKC_ORDER.clear();
  [...data.logs].sort((x, y) => y.log.length - x.log.length || y.log.reduce((a, q) => a + q.toi, 0) - x.log.reduce((a, q) => a + q.toi, 0) || x.last.localeCompare(y.last, 'fi'))
    .forEach((g, i) => GKC_ORDER.set(g.id, i));
  const max = Math.max(0, ...data.logs.map(g => g.log.length));
  const wins = GKC_WINDOWS.filter(n => n === 0 || n < max);
  if (!wins.includes(GKC_N)) GKC_N = wins.includes(5) ? 5 : 0;
  const draw = () => {
    const all = data.goalies.map(g => goalieWindow(g, GKC_N, data.lgSv)).filter(g => g.gp);
    const gks = all.filter(g => g.team === SAIPA_NUM).sort((x, y) => (GKC_ORDER.get(x.id) ?? 99) - (GKC_ORDER.get(y.id) ?? 99));
    const ranks = gkcRanks(all, GKC_N, GKC_PER, data.teamGames);
    el.querySelectorAll('.gkc-bar .sbtn').forEach(b => b.classList.toggle('active', Number(b.dataset.n) === GKC_N));
    el.querySelectorAll('.gkc-per button').forEach(b => b.classList.toggle('on', (b.dataset.per === '1') === GKC_PER));
    el.querySelector('.gkc-body').innerHTML = goalieCompareHtml(gks, ranks, GKC_N, GKC_PER, compact);
  };
  el.innerHTML = `<h2>${title}</h2>
    <div class="setbar gkc-bar" role="tablist" aria-label="Otanta">${wins.map(n => `<button class="sbtn${compact ? ' sm' : ''}" data-n="${n}">${n ? `${n} viim.` : 'Koko kausi'}</button>`).join('')}
      <span class="seg gkc-per" role="group" aria-label="Luvut"><button data-per="0">Yhteensä</button><button data-per="1">Per ottelu</button></span></div>
    <div class="gkc-body"></div>`;
  el.querySelectorAll('.gkc-bar .sbtn').forEach(b => b.onclick = () => { GKC_N = Number(b.dataset.n); draw(); });
  el.querySelectorAll('.gkc-per button').forEach(b => b.onclick = () => { GKC_PER = b.dataset.per === '1'; draw(); });
  draw();
}

// Season view
async function renderGoalieCompare(el) {
  goalieCompareCard(el, await goalieCompareData());
}
