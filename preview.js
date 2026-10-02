/* SaiPa Data: game preview.
 * Uses helpers from app.js (getJSON, esc, num, pct, signed, mmss, kmh, fiDate, validGoal, SEASON, TOURNAMENT, SAIPA_NUM). */

const H2H_SEASONS = 5;   // number of previous seasons included in head-to-head

/* ---------- league team metrics and ranks ---------- */
const TEAM_METRICS = [
  { k: 'ppg', l: 'Pisteet / ottelu', fmt: v => num(v, 2), hi: true },
  { k: 'gfpg', l: 'Tehdyt maalit / ottelu', fmt: v => num(v, 2), hi: true },
  { k: 'gapg', l: 'Päästetyt maalit / ottelu', fmt: v => num(v, 2), hi: false },
  { k: 'xgfpg', l: 'xG puolesta / ottelu', fmt: v => num(v, 2), hi: true },
  { k: 'xgapg', l: 'xG vastaan / ottelu', fmt: v => num(v, 2), hi: false },
  { k: 'xgShare', l: 'xG-osuus', fmt: v => pct(v, 1), hi: true },
  { k: 'evAtt', l: 'Laukausyritysten osuus tasakentällisin', s: 'Laukausosuus 5 v 5', fmt: v => pct(v, 1), hi: true },
  { k: 'puck', l: 'Kiekonhallinta', fmt: v => pct(v, 1), hi: true },
  { k: 'pp', l: 'Ylivoima', fmt: v => pct(v, 1), hi: true },
  { k: 'pk', l: 'Alivoima', fmt: v => pct(v, 1), hi: true },
  { k: 'penPg', l: 'Jäähyt / ottelu', fmt: v => num(v, 2), hi: false },
  { k: 'fo', l: 'Aloitusvoitot', fmt: v => pct(v, 1), hi: true },
  { k: 'finPg', l: 'Viimeistely: maalit − xG / ottelu', s: 'Viimeistely (G − xG) / ott.', fmt: v => signed(v, 2), hi: true },
  { k: 'gsaxPg', l: 'Maalivahdit: torjutut yli odotusten / ottelu', s: 'Maalivahdit (GSAx) / ott.', fmt: v => signed(v, 2), hi: true },
];

async function loadLeague() {
  const q = `seasonFrom=${SEASON}&seasonTo=${SEASON}&tournament=${TOURNAMENT}`;
  const [sched, stn, tsStd, tsShots, tsFo, tsPen] = await Promise.all([
    getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`),
    getJSON(`/standings/?season=${SEASON}`),
    getJSON(`/teams/stats?${q}&dataType=standings`),
    getJSON(`/teams/stats?${q}&dataType=shots`),
    getJSON(`/teams/stats?${q}&dataType=faceoffs`),
    getJSON(`/teams/stats?${q}&dataType=penalties`),
  ]);
  const teams = new Map();
  for (const t of stn.season || []) {
    teams.set(t.internalId, {
      id: t.internalId, key: t.teamId, name: t.teamName, logo: t.teamLogos?.lightBg || null,
      rankTable: t.ranking, games: t.games, points: t.points,
      wins: t.wins, otw: t.overtimeWins, otl: t.overtimeLosses, losses: t.losses,
      goals: t.goals, goalsAgainst: t.goalsAgainst,
      ppInst: t.powerPlayInstances, ppGoals: t.powerPlayGoals, shInst: t.shortHandedInstances, shGa: t.shortHandedGoalsAgainst,
    });
  }
  const by = (arr) => new Map((arr?.teamStats || []).map(x => [x.teamId, x]));
  const std = by(tsStd), sh = by(tsShots), fo = by(tsFo), pen = by(tsPen);
  // The shootout-deciding goal is included in team goals. It is removed for finishing metrics.
  const soW = new Map(), soL = new Map();
  for (const g of sched) {
    if (!g.ended || g.finishedType !== 'ENDED_DURING_WINNING_SHOT_COMPETITION') continue;
    const h = teamNum(g.homeTeamId), a = teamNum(g.awayTeamId);
    const hw = g.homeTeamGoals > g.awayTeamGoals;
    const w = hw ? h : a, l = hw ? a : h;
    soW.set(w, (soW.get(w) || 0) + 1); soL.set(l, (soL.get(l) || 0) + 1);
  }
  for (const t of teams.values()) {
    const n = t.games || 0;
    const s = std.get(t.id) || {}, x = sh.get(t.id) || {}, f = fo.get(t.id) || {}, p = pen.get(t.id) || {};
    t.xgf = s.expectedGoalsFor ?? null; t.xga = s.expectedGoalsAgainst ?? null;
    const gEx = t.goals - (soW.get(t.id) || 0), gaEx = t.goalsAgainst - (soL.get(t.id) || 0);
    t.m = {
      ppg: n ? t.points / n : null,
      gfpg: n ? gEx / n : null,
      gapg: n ? gaEx / n : null,
      xgfpg: n && t.xgf != null ? t.xgf / n : null,
      xgapg: n && t.xga != null ? t.xga / n : null,
      xgShare: t.xgf != null && (t.xgf + t.xga) ? t.xgf / (t.xgf + t.xga) : null,
      evAtt: x.shotsForShotsAgainstPercentageEvenStrength != null ? x.shotsForShotsAgainstPercentageEvenStrength / 100 : null,
      puck: s.puckControlPercentage != null ? s.puckControlPercentage / 100 : null,
      pp: t.ppInst ? t.ppGoals / t.ppInst : null,
      pk: t.shInst ? 1 - t.shGa / t.shInst : null,
      penPg: n && p.penalties != null ? p.penalties / n : null,
      fo: (f.faceoffWon + f.faceoffLost) ? f.faceoffWon / (f.faceoffWon + f.faceoffLost) : null,
      finPg: n && t.xgf != null ? (gEx - t.xgf) / n : null,
      gsaxPg: n && t.xga != null ? (t.xga - gaEx) / n : null,
    };
  }
  // Ranks: 1 = best
  const list = [...teams.values()].filter(t => t.games > 0);
  for (const mt of TEAM_METRICS) {
    const vals = list.filter(t => t.m[mt.k] != null).sort((a, b) => mt.hi ? b.m[mt.k] - a.m[mt.k] : a.m[mt.k] - b.m[mt.k]);
    vals.forEach((t, i) => { t.r = t.r || {}; t.r[mt.k] = 1 + vals.findIndex(u => u.m[mt.k] === t.m[mt.k]); });
  }
  return { sched, teams, nTeams: list.length };
}

const GEN = { 'SaiPa': 'SaiPan', 'KalPa': 'KalPan', 'Kärpät': 'Kärppien', 'Ilves': 'Ilveksen', 'Jukurit': 'Jukurien', 'HPK': 'HPK:n', 'Jokerit': 'Jokerien',
  'Tappara': 'Tapparan', 'KooKoo': 'KooKoon', 'Lukko': 'Lukon', 'Ässät': 'Ässien', 'Pelicans': 'Pelicansin', 'Sport': 'Sportin', 'TPS': 'TPS:n',
  'JYP': 'JYPin', 'HIFK': 'HIFK:n', 'K-Espoo': 'K-Espoon' };
const gen = name => GEN[name] || `${name}:n`;
const teamNum = key => Number(String(key || '').split(':')[0]);

/* ---------- team games ---------- */
function teamGame(g, st, tid, schedRow) {
  const home = teamNum(g.game.homeTeam.teamId) === tid;
  const side = home ? 'home' : 'away', oside = home ? 'away' : 'home';
  const T = g.game[`${side}Team`], O = g.game[`${oside}Team`];
  const roster = new Map((home ? g.homeTeamPlayers : g.awayTeamPlayers).map(p => [p.id, p]));
  const per = {};
  const P = n => (per[n] = per[n] || { xgf: 0, xga: 0, gf: 0, ga: 0, af: 0, aa: 0 });
  for (const p of st[`${side}Team`] || []) { const r = P(p.period); r.af += p.shots || 0; for (const x of p.periodPlayerStats || []) r.xgf += x.expectedGoalsPlayer || 0; }
  for (const p of st[`${oside}Team`] || []) { const r = P(p.period); r.aa += p.shots || 0; for (const x of p.periodPlayerStats || []) r.xga += x.expectedGoalsPlayer || 0; }
  for (const e of (T.goalEvents || []).filter(validGoal)) P(e.period).gf++;
  for (const e of (O.goalEvents || []).filter(validGoal)) P(e.period).ga++;

  const players = new Map();
  const speed = new Map((st[`${side}TeamGamePlayerStats`] || []).map(x => [x.playerId, x]));
  for (const p of st[`${side}Team`] || []) for (const x of p.periodPlayerStats || []) {
    const q = x.period || {};
    const t = players.get(x.playerId) || { id: x.playerId, g: 0, a: 0, shots: 0, toi: 0, ixg: 0, cf: 0, ca: 0, evgf: 0, evga: 0, blk: 0, fow: 0, fot: 0, pim: 0, a1: 0, a2: 0 };
    t.g += q.goals || 0; t.a += q.assists || 0; t.shots += q.shots || 0; t.toi += q.timeofice || 0; t.ixg += x.expectedGoalsPlayer || 0;
    t.cf += q.corsiFor || 0; t.ca += q.corsiAgainst || 0; t.evgf += q.fsTeamGoals || 0; t.evga += q.fsTeamGoalsAgainst || 0;
    t.blk += q.blockedShots || 0; t.fow += q.faceoffsWon || 0; t.fot += q.faceoffsTotal || 0; t.pim += q.penaltyminutes || 0;
    players.set(x.playerId, t);
  }
  for (const e of (T.goalEvents || []).filter(validGoal)) {
    const [x1, x2] = e.assistantPlayerIds || [];
    if (players.has(x1)) players.get(x1).a1++;
    if (players.has(x2)) players.get(x2).a2++;
  }
  // Game Score as in the game report. Shots on goal are not known here, so the shot term is left out for both teams.
  for (const t of players.values()) {
    const c = skaterComponents({ ...t, sog: null, gf: t.evgf, ga: t.evga });
    t.gs = c.tulos + c.tuotanto + c.hallinta + c.puolustus + c.muut;
    t.proc = t.gs - c.tulos;   // everything except goals and assists
  }
  for (const t of players.values()) {
    const r = roster.get(t.id) || {};
    Object.assign(t, { first: r.firstName || '', last: r.lastName || '?', jersey: r.jersey, role: r.roleCode || '', topSpeed: speed.get(t.id)?.topSpeed || 0, hardestShot: speed.get(t.id)?.hardestShot || 0 });
  }
  const goalies = new Map();
  let starter = null;
  for (const p of st[`${side}Team`] || []) for (const x of p.goaliePeriodStats || []) {
    const q = x.period || {};
    if (!q.timeofice) continue;
    if (p.period === 1 && !starter) starter = x.playerId;
    const t = goalies.get(x.playerId) || { id: x.playerId, toi: 0, saves: 0, ga: 0, xga: 0 };
    t.toi += q.timeofice; t.saves += q.saves || 0; t.ga += q.goalsAllowed || 0; t.xga += x.expectedGoalsAgainst || 0;
    goalies.set(x.playerId, t);
  }
  for (const t of goalies.values()) { const r = roster.get(t.id) || {}; Object.assign(t, { first: r.firstName || '', last: r.lastName || '?', jersey: r.jersey }); }

  let fw = 0, fl = 0, puckF = 0, puckA = 0;
  for (const p of st[`${side}Team`] || []) fw += p.faceOffWins || 0;
  for (const p of st[`${oside}Team`] || []) fl += p.faceOffWins || 0;
  for (const p of st.puckStats || []) { puckF += (home ? p.homeTeamControlDuration : p.awayTeamControlDuration) || 0; puckA += (home ? p.awayTeamControlDuration : p.homeTeamControlDuration) || 0; }
  const special = { ppI: T.powerplayInstances || 0, ppG: T.powerplayGoals || 0, shI: O.powerplayInstances || 0, shGA: O.powerplayGoals || 0, pen: (T.penaltyEvents || []).length, fw, fl, puckF, puckA };
  const gf = home ? schedRow.homeTeamGoals : schedRow.awayTeamGoals;
  const ga = home ? schedRow.awayTeamGoals : schedRow.homeTeamGoals;
  const extra = schedRow.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME' ? 'JA' : schedRow.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION' ? 'VL' : '';
  const win = gf > ga;
  return {
    id: g.game.id, start: g.game.start, home,
    opp: { id: teamNum(O.teamId), name: O.teamName },
    gf, ga, extra, win,
    points: win ? (extra ? 2 : 3) : (extra ? 1 : 0),
    res: win ? (extra ? 'JV' : 'V') : (extra ? 'JH' : 'H'),
    xgf: T.expectedGoals ?? null, xga: O.expectedGoals ?? null,
    per, players: [...players.values()], goalies: [...goalies.values()], starter, special,
  };
}

async function loadTeamGames(league, tid) {
  const rows = league.sched.filter(g => g.ended && (teamNum(g.homeTeamId) === tid || teamNum(g.awayTeamId) === tid))
    .sort((a, b) => a.start.localeCompare(b.start));
  const out = await Promise.all(rows.map(async r => {
    const [g, st] = await Promise.all([getJSON(`/games/${SEASON}/${r.id}`), getJSON(`/games/stats/${SEASON}/${r.id}`)]);
    return teamGame(g, st, tid, r);
  }));
  return out;  // oldest first
}

function teamSummary(games) {
  const per = {};
  for (const gm of games) for (const [n, r] of Object.entries(gm.per)) {
    if (Number(n) > 3) continue;
    const t = per[n] = per[n] || { xgf: 0, xga: 0, gf: 0, ga: 0, af: 0, aa: 0 };
    for (const k in r) t[k] += r[k];
  }
  const last5 = games.slice(-5);
  const players = new Map();
  for (const gm of games) {
    const recent = last5.includes(gm);
    for (const p of gm.players) {
      if (!p.toi) continue;
      const t = players.get(p.id) || { id: p.id, gp: 0, g: 0, a: 0, shots: 0, toi: 0, ixg: 0, topSpeed: 0, hardestShot: 0, l5: 0, l5gp: 0, gs: 0, proc: 0, cf: 0, ca: 0, drought: 0, lastPt: null };
      Object.assign(t, { first: p.first, last: p.last, jersey: p.jersey, role: p.role });
      t.gp++; t.g += p.g; t.a += p.a; t.shots += p.shots; t.toi += p.toi; t.ixg += p.ixg;
      t.gs += p.gs || 0; t.proc += p.proc || 0; t.cf += p.cf || 0; t.ca += p.ca || 0;
      t.topSpeed = Math.max(t.topSpeed, p.topSpeed); t.hardestShot = Math.max(t.hardestShot, p.hardestShot);
      if (recent) { t.l5 += p.g + p.a; t.l5gp++; }
      // Current run of games without a point (games are in date order)
      if (p.g + p.a) { t.drought = 0; t.lastPt = gm.start; } else t.drought++;
      players.set(p.id, t);
    }
  }
  for (const t of players.values()) { t.pts = t.g + t.a; t.fin = t.g - t.ixg; t.ixg60 = t.toi ? t.ixg / t.toi * 3600 : 0; t.gsPg = t.gs / t.gp; t.procPg = t.proc / t.gp; }
  const goalies = new Map();
  for (const gm of games) for (const p of gm.goalies) {
    const t = goalies.get(p.id) || { id: p.id, gp: 0, starts: 0, toi: 0, saves: 0, ga: 0, xga: 0, log: [] };
    Object.assign(t, { first: p.first, last: p.last, jersey: p.jersey });
    t.gp++; t.toi += p.toi; t.saves += p.saves; t.ga += p.ga; t.xga += p.xga;
    if (gm.starter === p.id) t.starts++;
    t.log.push({ start: gm.start, gsax: p.xga - p.ga });
    goalies.set(p.id, t);
  }
  for (const t of goalies.values()) { t.gsax = t.xga - t.ga; t.sv = (t.saves + t.ga) ? t.saves / (t.saves + t.ga) : null; t.l3 = t.log.slice(-3).reduce((s, x) => s + x.gsax, 0); }
  const sp = { ppI: 0, ppG: 0, shI: 0, shGA: 0, pen: 0, fw: 0, fl: 0, puckF: 0, puckA: 0 };
  for (const gm of games) for (const k in sp) sp[k] += gm.special?.[k] || 0;
  return { per, players: [...players.values()], goalies: [...goalies.values()], last5, special: sp, n: games.length };
}

// League table and schedule-based metrics as they stood before a given moment.
// Metrics that need every team's game-level data (power play etc.) are filled in for the two teams only, without ranks.
async function leagueAsOf(sched, before) {
  const stn = await getJSON(`/standings/?season=${SEASON}`).catch(() => null);
  const logo = new Map((stn?.season || []).map(t => [t.internalId, t.teamLogos?.lightBg || null]));
  const teams = new Map();
  const T = (key, name) => {
    const id = teamNum(key);
    if (!teams.has(id)) teams.set(id, { id, name, logo: logo.get(id) || null, games: 0, points: 0, wins: 0, otw: 0, otl: 0, losses: 0, gf: 0, ga: 0, xgf: 0, xga: 0 });
    return teams.get(id);
  };
  for (const g of sched) {
    if (!g.ended || g.start >= before) continue;
    const h = T(g.homeTeamId, g.homeTeamName), a = T(g.awayTeamId, g.awayTeamName);
    const so = g.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION', ot = g.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME';
    const hw = g.homeTeamGoals > g.awayTeamGoals;
    for (const [t, me, op, xf, xa, won] of [[h, g.homeTeamGoals, g.awayTeamGoals, g.expectedHomeTeamGoals, g.expectedAwayTeamGoals, hw], [a, g.awayTeamGoals, g.homeTeamGoals, g.expectedAwayTeamGoals, g.expectedHomeTeamGoals, !hw]]) {
      t.games++; t.gf += me - (so && won ? 1 : 0); t.ga += op - (so && !won ? 1 : 0); t.xgf += xf || 0; t.xga += xa || 0;
      if (won) { if (so || ot) { t.otw++; t.points += 2; } else { t.wins++; t.points += 3; } }
      else if (so || ot) { t.otl++; t.points += 1; } else t.losses++;
    }
  }
  for (const t of teams.values()) {
    const n = t.games;
    t.m = {
      ppg: n ? t.points / n : null, gfpg: n ? t.gf / n : null, gapg: n ? t.ga / n : null,
      xgfpg: n ? t.xgf / n : null, xgapg: n ? t.xga / n : null, xgShare: (t.xgf + t.xga) ? t.xgf / (t.xgf + t.xga) : null,
      finPg: n ? (t.gf - t.xgf) / n : null, gsaxPg: n ? (t.xga - t.ga) / n : null,
    };
  }
  const list = [...teams.values()].filter(t => t.games > 0);
  for (const mt of TEAM_METRICS) {
    const vals = list.filter(t => t.m[mt.k] != null).sort((a, b) => mt.hi ? b.m[mt.k] - a.m[mt.k] : a.m[mt.k] - b.m[mt.k]);
    vals.forEach(t => { t.r = t.r || {}; t.r[mt.k] = 1 + vals.findIndex(u => u.m[mt.k] === t.m[mt.k]); });
  }
  for (const t of teams.values()) t.r = t.r || {};
  return { sched, teams, nTeams: list.length, asOf: true };
}

function addOwnSpecial(team, sum) {
  const sp = sum.special, n = sum.n;
  Object.assign(team.m, {
    pp: sp.ppI ? sp.ppG / sp.ppI : null,
    pk: sp.shI ? 1 - sp.shGA / sp.shI : null,
    penPg: n ? sp.pen / n : null,
    fo: (sp.fw + sp.fl) ? sp.fw / (sp.fw + sp.fl) : null,
    puck: (sp.puckF + sp.puckA) ? sp.puckF / (sp.puckF + sp.puckA) : null,
  });
}

/* ---------- head-to-head ---------- */
async function loadH2H(homeId, awayId, next, currentTeam, live) {  // currentTeam: Map playerId -> current team id
  const seasons = [];
  for (let s = SEASON; s > SEASON - H2H_SEASONS - 1; s--) seasons.push(s);
  const scheds = await Promise.all(seasons.map(s => getJSON(`/schedule?tournament=${TOURNAMENT}&season=${s}`).then(r => ({ s, r })).catch(() => ({ s, r: [] }))));
  const meetings = [];
  for (const { s, r } of scheds) for (const g of r) {
    const h = teamNum(g.homeTeamId), a = teamNum(g.awayTeamId);
    if (g.ended && g.start < next.start && ((h === homeId && a === awayId) || (h === awayId && a === homeId))) meetings.push({ ...g, season: s });
  }
  meetings.sort((a, b) => b.start.localeCompare(a.start));
  // Current players' points in these meetings, from goal events
  const pts = new Map();
  const details = await Promise.all(meetings.map(m => getJSON(`/games/${m.season}/${m.id}`).catch(() => null)));
  const bump = (id, k) => { const t = pts.get(id) || { gp: 0, g: 0, a: 0 }; t[k]++; pts.set(id, t); };
  details.forEach(d => {
    if (!d) return;
    for (const side of ['home', 'away']) {
      const teamId = teamNum(d.game[`${side}Team`].teamId);
      // Only count a player when he played for the team he plays for now
      const mine = id => currentTeam.get(id) === teamId;
      for (const p of d[`${side}TeamPlayers`] || []) if (p.line != null && mine(p.id)) bump(p.id, 'gp');
      for (const e of (d.game[`${side}Team`].goalEvents || []).filter(validGoal)) {
        if (mine(e.scorerPlayerId)) bump(e.scorerPlayerId, 'g');
        for (const a of e.assistantPlayerIds || []) if (mine(a)) bump(a, 'a');
      }
    }
  });
  // The all-time endpoint is not time-bound, so it is only used for the upcoming game
  const allTime = live ? await getJSON(`/players/stats-comparison/${SEASON}/${next.id}?nbSeasons=100&criterion=team`).catch(() => null) : null;
  return { meetings, pts, allTime, fromSeason: SEASON - H2H_SEASONS };
}

/* ---------- key matchups ---------- */
// Key matchups: the same seven pairings in every preview, each one side's strength against the
// other side's matching ability. Edge = difference of league percentiles (positive = SaiPa's side ranks better).
function keyMatchups(sai, opp, league) {
  const N = league.nTeams;
  const pctl = (t, k) => 1 - (t.r[k] - 1) / Math.max(1, N - 1);
  const rk = (t, k) => `${t.r[k]}./${N}`;
  const S = sai.m, O = opp.m, og = gen(opp.name);
  const pairs = [
    ['Ylivoima', 'Alivoima', 'pp', 'pk', 'SaiPan ylivoima', `${og} alivoima`, v => pct(v, 1)],
    ['Alivoima', 'Ylivoima', 'pk', 'pp', 'SaiPan alivoima', `${og} ylivoima`, v => pct(v, 1)],
    ['Hyökkäys', 'Puolustus', 'xgfpg', 'xgapg', 'xG puolesta / ott.', 'xG vastaan / ott.', v => num(v, 2)],
    ['Puolustus', 'Hyökkäys', 'xgapg', 'xgfpg', 'xG vastaan / ott.', 'xG puolesta / ott.', v => num(v, 2)],
    ['Viimeistely', 'Maalivahdit', 'finPg', 'gsaxPg', 'Maalit − xG / ott.', 'GSAx / ott.', v => signed(v, 2)],
    ['Maalivahdit', 'Viimeistely', 'gsaxPg', 'finPg', 'GSAx / ott.', 'Maalit − xG / ott.', v => signed(v, 2)],
    ['Aloitukset', 'Aloitukset', 'fo', 'fo', 'Aloitusvoitot', 'Aloitusvoitot', v => pct(v, 1)],
  ];
  return pairs.filter(([, , a, b]) => sai.r?.[a] && opp.r?.[b] && S[a] != null && O[b] != null).map(([ta, tb, a, b, la, lb, fmt]) => ({
    edge: pctl(sai, a) - pctl(opp, b),
    left: { team: sai.name, t: ta, label: la, v: fmt(S[a]), r: rk(sai, a) },
    right: { team: opp.name, t: tb, label: lb, v: fmt(O[b]), r: rk(opp, b) },
  }));
}

async function renderPreview(id, box) {
  box.innerHTML = '<p class="loading">Rakennetaan ennakkoa…</p>';
  try {
    const sched = await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`);
    const next = sched.find(g => String(g.id) === String(id));
    if (!next) { box.innerHTML = '<p class="muted">Ottelua ei löydy otteluohjelmasta.</p>'; return; }
    PV_SWAP = teamNum(next.homeTeamId) !== SAIPA_NUM;
    // The next upcoming game uses the live league tables (identical to "as of now").
    // Any other game is rebuilt from the data that existed before it started.
    const firstUpcoming = sched.filter(g => !g.ended && (teamNum(g.homeTeamId) === SAIPA_NUM || teamNum(g.awayTeamId) === SAIPA_NUM))
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    const live = firstUpcoming && firstUpcoming.id === next.id;
    const league = live ? await loadLeague() : await leagueAsOf(sched, next.start);
    const homeId = teamNum(next.homeTeamId), awayId = teamNum(next.awayTeamId);
    const oppId = homeId === SAIPA_NUM ? awayId : homeId;
    const sai = league.teams.get(SAIPA_NUM), opp = league.teams.get(oppId);
    if (!sai || !opp) { box.innerHTML = '<p class="muted">Ennakko on saatavilla, kun molemmat joukkueet ovat pelanneet kauden ensimmäisen ottelunsa.</p>'; return; }
    const [sGames, oGames, nextGame] = await Promise.all([
      loadTeamGames(league, SAIPA_NUM), loadTeamGames(league, oppId), getJSON(`/games/${SEASON}/${next.id}`).catch(() => null),
    ]);
    const before = gs => gs.filter(g => g.start < next.start);
    const sG = before(sGames), oG = before(oGames);
    const sSum = teamSummary(sG), oSum = teamSummary(oG);
    if (!live) { addOwnSpecial(sai, sSum); addOwnSpecial(opp, oSum); }
    const lineups = await loadLineups(next, nextGame, sG, oG, homeId);
    box.innerHTML = previewHtml({ next, sai, opp, sG, oG, sSum, oSum, league, nextGame, live, lineups });

    // PR-8: forecast from data before the game. Betting odds are pre-game only for the upcoming game.
    loadForecast(next, next.start).then(F => {
      const card = box.querySelector('#fcCard');
      if (!card) return;
      if (!F) { card.remove(); return; }
      const actual = next.ended ? (() => { const s = teamNum(next.homeTeamId) === SAIPA_NUM ? [next.homeTeamGoals, next.awayTeamGoals] : [next.awayTeamGoals, next.homeTeamGoals]; return `<p class="muted small">Toteutunut tulos: SaiPa ${s[0]}–${s[1]} ${esc(opp.name)}${next.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME' ? ' JA' : next.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION' ? ' VL' : ''}.</p>`; })() : '';
      card.innerHTML = `<h2><span class="tag">Ennuste</span></h2>${forecastHtml(F, next, sai, opp, live && !next.started ? oddsProbs(nextGame) : null)}${actual}`;
    }).catch(e => { const card = box.querySelector('#fcCard'); if (card) card.innerHTML = `<h2>Ennuste</h2><p class="neg-num">Ennusteen laskenta epäonnistui: ${esc(e.message)}</p>`; });

    // SM-3: zone profiles from every shot map played before this game
    loadLeagueShots().then(L => {
      const P = teamShotProfiles(L, next.start);
      const card = box.querySelector('#pfCard');
      if (!card) return;
      const html = previewProfileHtml(P, sai, oppId, opp.name, opp, L, next.start);
      card.innerHTML = html ? `<h2>Mistä maalit syntyvät</h2>${html}` : '';
      if (!html) card.remove();
      const hl = box.querySelector('.hl-grid');
      if (hl) for (const c of profileHeadlines(P, sai, oppId, opp.name)) hl.insertAdjacentHTML('beforeend', hlCard(c.k, c.v, c.t, c.cls));
    }).catch(e => { const card = box.querySelector('#pfCard'); if (card) card.innerHTML = `<h2>Mistä maalit syntyvät</h2><p class="neg-num">Laukauskarttojen haku epäonnistui: ${esc(e.message)}</p>`; });

    const currentTeam = new Map([...sSum.players, ...sSum.goalies].map(p => [p.id, SAIPA_NUM]).concat([...oSum.players, ...oSum.goalies].map(p => [p.id, oppId])));
    loadH2H(homeId, awayId, next, currentTeam, live).then(h => {
      const card = box.querySelector('#h2hCard');
      if (!card) return;
      card.innerHTML = `<h2>Keskinäiset <span class="h2-sub">runkosarja</span></h2>${h2hHtml(h, next, sai, opp, sSum, oSum)}`;
      // Add the strongest head-to-head scorer of the opponent to the headlines
      const top = oSum.players.map(p => ({ p, x: h.pts.get(p.id) })).filter(r => r.x).sort((x, y) => (y.x.g + y.x.a) - (x.x.g + x.x.a))[0];
      const hl = box.querySelector('.hl-grid');
      if (hl && top && top.x.g + top.x.a >= 8) hl.insertAdjacentHTML('beforeend', hlCard('SaiPa-tappaja', `${top.x.g + top.x.a} p`, `${esc(gen(opp.name))} ${esc(top.p.first)} ${esc(top.p.last)} · ${top.x.gp} ottelua SaiPaa vastaan kaudesta ${h.fromSeason - 1}–${String(h.fromSeason).slice(2)}`, 'opp'));
    }).catch(e => { const card = box.querySelector('#h2hCard'); if (card) card.innerHTML = `<h2>Keskinäiset</h2><p class="neg-num">Otteluhistorian haku epäonnistui: ${esc(e.message)}</p>`; });
  } catch (e) {
    box.innerHTML = `<p class="neg-num">Ennakon lataus epäonnistui: ${esc(e.message)}</p>`;
  }
}

function previewHtml({ next, sai, opp, sG, oG, sSum, oSum, league, nextGame, live = true, lineups = null }) {
  const matchups = keyMatchups(sai, opp, league);
  const pair = (s, o) => homeFirst(s, o).join('');
  const photos = side => new Map(((side?.cur || side?.prev)?.all || []).filter(p => p.pictureUrl).map(p => [p.id, p.pictureUrl]));
  return `
      ${live ? '' : `<div class="datanote"><b>Ennakko ennen ottelua</b><p>Tämä ennakko on laskettu datasta, joka oli olemassa ennen ottelun alkua. Ylivoiman, alivoiman, jäähyjen, aloitusten ja kiekonhallinnan Liiga-sijoituksia ei voi laskea jälkikäteen, joten niistä näytetään vain joukkueiden omat luvut.</p></div>`}
      ${heroHtml(next, sai, opp, sG, oG, league, nextGame, live)}
      <div class="card" id="fcCard"><h2><span class="tag">Ennuste</span></h2><p class="loading">Lasketaan ennustetta…</p></div>
      <div class="card"><h2><span class="tag">Ennakon pääkohdat</span></h2>${headlinesHtml(sai, opp, sSum, oSum, league)}</div>
      <div class="card"><h2>Joukkueet vastakkain</h2>${tapeHtml(sai, opp, league)}</div>
      <div class="grid2">
        <div class="card"><h2>Edelliset 5 ottelua</h2>${pair(formHtml(sai, sG), formHtml(opp, oG))}</div>
        <div class="card"><h2>Erä erältä</h2>${periodVsHtml(sai, opp, sSum, oSum)}</div>
      </div>
      <div class="card"><h2>Avainkamppailut</h2>${matchupsHtml(matchups, sai, opp)}</div>
      <div class="card"><h2>Avainpelaajat</h2><div class="grid2 flat">${pair(playersBlock(sai, sSum, photos(lineups?.sai)), playersBlock(opp, oSum, photos(lineups?.opp)))}</div></div>
      <div class="card"><h2>Maalivahdit</h2><div class="grid2 flat">${pair(goaliesBlock(sai, sSum, sG, nextGame, next), goaliesBlock(opp, oSum, oG, nextGame, next))}</div></div>
      ${lineups ? `<div class="card"><h2>Kokoonpanot</h2>${lineupBoard(sai, opp, lineups, sSum, oSum)}</div>` : ''}
      <div class="card" id="pfCard"><h2>Mistä maalit syntyvät</h2><p class="loading">Haetaan koko liigan laukauskarttoja…</p></div>
      <div class="card" id="h2hCard"><h2>Keskinäiset <span class="h2-sub">runkosarja</span></h2><p class="loading">Haetaan otteluhistoriaa…</p></div>`;
}

function logoImg(t, cls = 'tlogo') { return t.logo ? `<img class="${cls}" src="${esc(t.logo)}" alt="">` : ''; }
function restDays(games, start) {
  const last = games[games.length - 1];
  if (!last) return null;
  const d = (a, b) => Math.round((new Date(new Date(b).toDateString()) - new Date(new Date(a).toDateString())) / 86400000);
  return { days: d(last.start, start) - 1, last };
}

function heroHtml(next, sai, opp, sG, oG, league, nextGame, live = true) {
  const home = league.teams.get(teamNum(next.homeTeamId)), away = league.teams.get(teamNum(next.awayTeamId));
  const d = new Date(next.start);
  const when = d.toLocaleDateString('fi-FI', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Europe/Helsinki' }) + ' klo ' + d.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' });
  const ms = d - new Date();
  const until = !live && next.ended ? 'pelattu' : ms > 0 ? (ms > 86400000 ? `${Math.floor(ms / 86400000)} pv ${Math.floor(ms % 86400000 / 3600000)} h` : `${Math.floor(ms / 3600000)} h ${Math.floor(ms % 3600000 / 60000)} min`) : 'käynnissä';
  const rest = gs => { const r = restDays(gs, next.start); return r ? `Edellinen ${fiDate(r.last.start)} ${r.last.home ? '' : '@ '}${esc(r.last.opp.name)} ${r.last.gf}–${r.last.ga}${r.last.extra ? ' ' + r.last.extra : ''} · ${r.days} lepopäivää` : ''; };
  const stat = (v, l) => `<div class="hst"><b>${v}</b><span>${l}</span></div>`;
  const side = (t, gs) => `<div class="hteam ${t.id === SAIPA_NUM ? 'saipa' : ''}">
      ${logoImg(t, 'hlogo')}
      <div class="hname">${esc(t.name)}</div>
      <div class="hstats">${live && t.rankTable ? stat(`${t.rankTable}.`, 'sija') : ''}${stat(t.points, 'pistettä')}${stat(t.games, 'ottelua')}</div>
      <div class="hrest">${rest(gs)}</div>
    </div>`;
  const rink = nextGame?.game?.iceRink?.name || next.iceRink?.name || '';
  return `<div class="hero">
    <div class="hlabel">Otteluennakko · Runkosarja</div>
    <div class="hrow">
      ${side(home, home.id === SAIPA_NUM ? sG : oG)}
      <div class="hmid"><div class="hvs">VS</div><div class="hwhen">${esc(when)}</div><div class="hrink">${esc(rink)}</div><div class="hcount">${until === 'pelattu' ? `Pelattu: ${esc(next.homeTeamName)}–${esc(next.awayTeamName)} ${next.homeTeamGoals}–${next.awayTeamGoals}` : `Alkuun ${until}`}</div></div>
      ${side(away, away.id === SAIPA_NUM ? sG : oG)}
    </div>
  </div>`;
}

// Preview headlines as stat cards: a label, one big number and a one-line context. Async parts of the
// preview (net front, head-to-head) append more cards with hlCard.
function hlCard(k, v, t, cls = '') {
  return `<div class="hl ${cls}"><div class="hl-k">${k}</div><div class="hl-v">${v}</div><div class="hl-t">${t}</div></div>`;
}
function headlinesHtml(sai, opp, sSum, oSum, league) {
  const N = league.nTeams, cards = [];
  const ranked = t => TEAM_METRICS.filter(mt => t.r?.[mt.k] && t.m[mt.k] != null).map(mt => ({ mt, r: t.r[mt.k], v: t.m[mt.k] })).sort((a, b) => a.r - b.r);
  const place = r => r === 1 ? 'Liigan paras' : r === N ? 'Liigan heikoin' : `Liigan ${r}.`;
  const sr = ranked(sai), or = ranked(opp);
  if (sr.length) {
    const b = sr[0], w = sr[sr.length - 1];
    cards.push(hlCard('SaiPan vahvuus', b.mt.fmt(b.v), `${b.mt.s || b.mt.l} · ${place(b.r)}`, 'good'));
    cards.push(hlCard('SaiPan heikkous', w.mt.fmt(w.v), `${w.mt.s || w.mt.l} · ${place(w.r)}`, 'bad'));
  }
  if (or.length) cards.push(hlCard(`${esc(gen(opp.name))} vahvuus`, or[0].mt.fmt(or[0].v), `${or[0].mt.s || or[0].mt.l} · ${place(or[0].r)}`, 'opp'));
  const hot = [...sSum.players].filter(p => p.l5gp).sort((a, b) => b.l5 - a.l5 || b.pts - a.pts)[0];
  if (hot && hot.l5 >= 3) cards.push(hlCard('Kuumin SaiPalainen', `${hot.l5} p`, `${esc(hot.first)} ${esc(hot.last)} · 5 viime ottelussa`));
  const due = oSum.players.filter(p => p.ixg >= 1).sort((a, b) => a.fin - b.fin)[0];
  if (due && due.fin <= -0.8) cards.push(hlCard('Varo', `${due.g} maalia`, `${esc(gen(opp.name))} ${esc(due.first)} ${esc(due.last)} · xG ${num(due.ixg, 1)}, maaleja on tulossa`, 'opp'));
  return `<div class="hl-grid">${cards.join('')}</div>`;
}

// Head-to-head rows shared by the preview cards: SaiPa on the left, the opponent on the right,
// the better value highlighted. Small numbers are league ranks.
// Preview cards always put the home team on the left. Callers pass SaiPa's value first; when SaiPa is the
// away team (PV_SWAP) the helpers mirror the row. SaiPa's highlight stays yellow on either side.
let PV_SWAP = false;
const homeFirst = (sai, opp) => PV_SWAP ? [opp, sai] : [sai, opp];
function vsHead(sai, opp, note = '') {
  const [l, r] = homeFirst(sai, opp);
  return `<div class="vs-head"><div>${logoImg(l)}${esc(l.name)}</div><div class="vs-note">${note}</div><div class="b">${esc(r.name)}${logoImg(r)}</div></div>`;
}
function vsRow(label, a, b, ra, rb, win, tip = '') {
  const rk = r => r == null || r === '' ? '' : `<small>${typeof r === 'number' ? r + '.' : r}</small>`;
  let sw = win, s = ['s', ''];
  if (PV_SWAP) { [a, b] = [b, a]; [ra, rb] = [rb, ra]; sw = win === 'a' ? 'b' : win === 'b' ? 'a' : ''; s = ['', 's']; }
  return `<div class="vs-row"${tip ? ` data-tip="${esc(tip)}"` : ''}>
    <div class="vs-v a ${s[0]} ${sw === 'a' ? 'win' : ''}"><b>${a}</b>${rk(ra)}</div>
    <div class="vs-l">${label}</div>
    <div class="vs-v b ${s[1]} ${sw === 'b' ? 'win' : ''}">${rk(rb)}<b>${b}</b></div>
  </div>`;
}

const TAPE_GROUPS = [
  ['Tulos', ['ppg', 'gfpg', 'gapg']],
  ['Maalipaikat', ['xgfpg', 'xgapg', 'xgShare', 'evAtt']],
  ['Erikoistilanteet', ['pp', 'pk', 'penPg']],
  ['Pelin hallinta', ['puck', 'fo']],
  ['Viimeistely ja maalivahdit', ['finPg', 'gsaxPg']],
];
function tapeHtml(sai, opp, league) {
  const groups = TAPE_GROUPS.map(([name, keys]) => {
    const rows = keys.map(k => {
      const mt = TEAM_METRICS.find(x => x.k === k), a = sai.m[k], b = opp.m[k];
      if (!mt || a == null || b == null) return '';
      const ra = sai.r?.[k], rb = opp.r?.[k];
      // Ranks decide the better side when available (rebuilt past previews compare values directly)
      const win = ra && rb ? (ra < rb ? 'a' : rb < ra ? 'b' : '') : (a === b ? '' : (mt.hi ? a > b : a < b) ? 'a' : 'b');
      const tip = `${mt.l}\n${sai.name}\t${mt.fmt(a)}${ra ? `, Liigan ${ra}.` : ''}\n${opp.name}\t${mt.fmt(b)}${rb ? `, Liigan ${rb}.` : ''}`;
      return vsRow(mt.s || mt.l, mt.fmt(a), mt.fmt(b), null, null, win, tip);
    }).join('');
    return rows ? `<div class="vs-grp"><b>${name}</b></div>${rows}` : '';
  }).join('');
  return `${vsHead(sai, opp)}<div class="vs">${groups}</div>
  <p class="muted small">Parempi arvo korostettu. Liigasijoitukset näkyvät hiiren alla.</p>`;
}

function formHtml(t, games) {
  const last = games.slice(-5);
  const chip = g => {
    const share = (g.xgf != null && (g.xgf + g.xga)) ? g.xgf / (g.xgf + g.xga) : null;
    return `<div class="fchip r-${g.res}" title="${fiDate(g.start)} ${g.home ? 'vs' : '@'} ${esc(g.opp.name)} ${g.gf}–${g.ga}${g.extra ? ' ' + g.extra : ''}${share != null ? ' · xG ' + num(g.xgf, 2) + '–' + num(g.xga, 2) : ''}">
      <div class="fres">${g.res}</div><div class="fsc">${g.gf}–${g.ga}</div><div class="fopp">${g.home ? '' : '@'}${esc(shortName(g.opp.name))}</div>
      ${share != null ? `<div class="fxg"><span style="width:${share * 100}%"></span></div>` : ''}
    </div>`;
  };
  const pts = last.reduce((s, g) => s + g.points, 0);
  const xs = last.reduce((s, g) => s + (g.xgf || 0), 0), xa = last.reduce((s, g) => s + (g.xga || 0), 0);
  return `<div class="form">
    <div class="form-h">${logoImg(t)}<b>${esc(t.name)}</b><span class="muted">${pts}/${last.length * 3} p · xG-osuus ${pct((xs + xa) ? xs / (xs + xa) : null, 0)} (5 viim.)</span></div>
    <div class="fchips">${last.map(chip).join('')}</div>
  </div>`;
}
const shortName = n => n.length > 8 ? n.slice(0, 7) + '.' : n;

// Periods as head-to-head rows: each team's share of the period's expected goals over the season, goals in small print.
function periodVsHtml(sai, opp, sSum, oSum) {
  const share = r => r && (r.xgf + r.xga) ? r.xgf / (r.xgf + r.xga) : null;
  const rows = ['1', '2', '3'].map(n => {
    const a = sSum.per[n], b = oSum.per[n], sa = share(a), sb = share(b);
    if (sa == null || sb == null) return '';
    const tip = `${n}. erä, koko kausi\n${sai.name}\txG-osuus ${pct(sa, 0)}, maalit ${a.gf}–${a.ga}\n${opp.name}\txG-osuus ${pct(sb, 0)}, maalit ${b.gf}–${b.ga}`;
    return vsRow(`${n}. erä`, pct(sa, 0), pct(sb, 0), `${a.gf}–${a.ga}`, `${b.gf}–${b.ga}`, Math.abs(sa - sb) < 0.005 ? '' : sa > sb ? 'a' : 'b', tip);
  }).join('');
  return rows ? `${vsHead(sai, opp)}<div class="vs per-vs">${rows}</div><p class="muted small">Iso luku: joukkueen osuus erän odotetuista maaleista (xG) koko kaudella. Pieni: erän maalit tehty–päästetty.</p>` : '<p class="muted">Erädataa ei vielä ole.</p>';
}

// Key matchups as head-to-head rows: one side's strength against the other side's matching weakness.
// The bar shows how much better SaiPa's side ranks than the opponent's side (yellow = SaiPa's edge).
function matchupsHtml(list, sai, opp) {
  if (!list.length) return '<p class="muted">Avainkamppailut näytetään, kun joukkueilla on Liiga-sijoitukset.</p>';
  return `${vsHead(sai, opp)}<div class="mx">${list.map(m => {
    const p = Math.round(50 + Math.max(-1, Math.min(1, m.edge)) * 45);   // SaiPa's share of the bar
    const winner = m.edge > 0.04 ? m.left : m.edge < -0.04 ? m.right : null;
    const [l, r] = homeFirst(m.left, m.right);
    const side = (x, pos) => `<div class="mx-side ${pos} ${winner === x ? 'win' : ''}"><div class="mx-l">${esc(x.label)}</div><div class="mx-v">${x.v}</div>${x.r ? `<div class="mx-r">${esc(x.r)}</div>` : ''}</div>`;
    return `<div class="mx-row">
      ${side(l, 'a')}
      <div class="mx-mid"><div class="mx-t">${esc(l.t === r.t ? l.t : `${l.t} vs. ${r.t.toLowerCase()}`)}</div><div class="mx-bar ${PV_SWAP ? 'rev' : ''}"><i style="width:${p}%"></i></div><div class="mx-e">${winner ? `Etu: ${esc(winner.team)}` : 'Tasainen'}</div></div>
      ${side(r, 'b')}
    </div>`;
  }).join('')}</div>`;
}

// Key players: three per team, each picked for a stated reason: the team's points leader (Kultakypärä), the
// hottest right now, and a player to watch (many chances per 60, goals not there yet). Fallbacks fill the rest.
// Key player picks (also used by the live view to compare the preview with the game)
function keyPicks(sum) {
  const ps = sum.players.filter(p => p.gp);
  const mt = n => `${n} ${n === 1 ? 'maali' : 'maalia'}`;
  const top9 = new Set([...ps].sort((a, b) => b.toi / b.gp - a.toi / a.gp).slice(0, 9).map(p => p.id));
  const dd = p => { const d = p.lastPt ? new Date(p.lastPt) : null; return d ? `viimeisin piste ${d.getDate()}.${d.getMonth() + 1}.` : 'ei pisteitä tällä kaudella'; };
  // Each card shows a different player. When the category leader is already on an earlier card, the next one is
  // shown and the tag says the team rank; the hover always lists the top three.
  const CATS = [
    ['🏆 Kultakypärä', '', [...ps].sort((a, b) => b.pts - a.pts || b.g - a.g || b.ixg - a.ixg), p => `${p.pts} p`, p => `${p.g}+${p.a} · ${p.gp} ott.`, 'Eniten pisteitä'],
    ['🔥 Kuumin juuri nyt', 'hot', ps.filter(p => p.l5 >= 2).sort((a, b) => b.l5 - a.l5 || b.pts - a.pts), p => `${p.l5} p`, p => `5 viime ott. · kausi ${p.pts} p`, 'Eniten pisteitä viidessä viime ottelussa'],
    ['📈 Maalit vielä tulossa', 'watch', ps.filter(p => p.gp >= 3 && p.ixg - p.g >= 0.5).sort((a, b) => (b.ixg - b.g) - (a.ixg - a.g)), p => signed(p.g - p.ixg, 1), p => `xG ${num(p.ixg, 1)} · ${mt(p.g)}`, 'Eniten maaleja alle maaliodottaman (G − xG)'],
    ['🎯 Viimeistelee yli odotusten', 'good', ps.filter(p => p.ixg >= 0.5 && p.fin >= 1).sort((a, b) => b.fin - a.fin), p => signed(p.fin, 1), p => `${mt(p.g)} · xG ${num(p.ixg, 1)}`, 'Eniten maaleja yli maaliodottaman (G − xG)'],
    ['⚡ Isoin maaliuhka', '', ps.filter(p => p.ixg >= 1).sort((a, b) => b.ixg - a.ixg), p => `xG ${num(p.ixg, 1)}`, p => `${p.shots} laukausyritystä · ${mt(p.g)}`, 'Eniten maaliodottamaa (xG) omista laukauksista'],
    ['🥶 Kylmä putki', 'cold', ps.filter(p => top9.has(p.id) && p.drought >= 3).sort((a, b) => b.drought - a.drought || b.toi / b.gp - a.toi / a.gp), p => `${p.drought} ott.`, p => `${dd(p)} · peliaika ${mmss(p.toi / p.gp)} / ott.`, 'Pisin meneillään oleva putki ilman pisteitä, joukkueen 9 eniten pelaavaa'],
  ];
  const used = new Set(), picks = [];
  for (const [k, cls, list, v, sub, rule] of CATS) {
    const i = list.findIndex(p => !used.has(p.id));
    if (i < 0) continue;
    const p = list[i];
    used.add(p.id);
    const tip = [k, rule, ...list.slice(0, 3).map((x, n) => `${n + 1}. ${x.first} ${x.last}\t${v(x)}`)].join('\n');
    picks.push({ p, k: i ? `${k} <span class="kp-rk">· joukkueen ${i + 1}.</span>` : k, v: v(p), sub: sub(p), cls, tip });
  }
  return picks;
}
function playersBlock(t, sum, photos = new Map()) {
  const picks = keyPicks(sum);
  const card = ({ p, k, v, sub, cls, tip }) => {
    const ph = photos.get(p.id);
    return `<div class="kp ${cls}" data-tip="${esc(tip)}">
      <div class="kp-ph">${ph ? `<img src="${esc(ph)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${esc((p.first || '')[0] || '')}${esc((p.last || '')[0] || '')}</span></div>
      <div class="kp-b"><div class="kp-tag">${k}</div><div class="kp-n">${esc(p.first)} ${esc(p.last)} <small>${esc(p.role)}</small></div><div class="kp-s">${sub}</div></div>
      <div class="kp-v">${v}</div>
    </div>`;
  };
  return `<div>
    <div class="form-h">${logoImg(t)}<b>${esc(t.name)}</b></div>
    <div class="kp-list">${picks.map(card).join('')}</div>
  </div>`;
}

function goaliesBlock(t, sum, games, nextGame, next) {
  const gks = [...sum.goalies].sort((a, b) => b.toi - a.toi);
  const recent = games.slice(-5);
  const last = id => { const g = sum.goalies.find(x => x.id === id); return g ? g.last : '–'; };
  // Confirmed starter once the lineup is published (line 1)
  let confirmed = null;
  if (nextGame) {
    const roster = teamNum(next.homeTeamId) === t.id ? nextGame.homeTeamPlayers : nextGame.awayTeamPlayers;
    const s = (roster || []).find(p => p.roleCode === 'MV' && p.line === 1);
    if (s) confirmed = `${s.firstName} ${s.lastName}`;
  }
  return `<div>
    <div class="form-h">${logoImg(t)}<b>${esc(t.name)}</b>${confirmed ? `<span class="badge b-hot">Aloittaa: ${esc(confirmed)}</span>` : '<span class="muted">Aloittaja vahvistuu kokoonpanon julkaisun yhteydessä</span>'}</div>
    <div class="tablewrap"><table class="data compact"><thead><tr><th>Maalivahti</th><th>Aloitukset</th><th data-tip="Save Percentage\nTorjuntaprosentti">SV%</th><th data-tip="Goals Saved Above Expected\nxGA − päästetyt maalit">GSAx</th><th data-tip="GSAx, Last 3 Games\nKolme viimeisintä ottelua">GSAx L3</th></tr></thead>
    <tbody>${gks.map(g => `<tr><td>${esc(g.first)} ${esc(g.last)}</td><td>${g.starts}${g.gp > g.starts ? ` <span class="muted">(+${g.gp - g.starts})</span>` : ''}</td><td>${pct(g.sv, 1)}</td><td class="${cls(g.gsax)}"><b>${signed(g.gsax, 2)}</b></td><td class="${cls(g.l3)}">${signed(g.l3, 2)}</td></tr>`).join('')}</tbody></table></div>
    <div class="k st-k">Aloittajat, 5 viimeisintä ottelua</div>
    <div class="st-strip">${recent.map(g => `<div class="st" data-tip="${esc(`${fiDate(g.start)} ${g.home ? 'vs' : '@'} ${g.opp.name}\nAloitti\t${nameOfFull(sum, g.starter)}`)}"><small>${fiDate(g.start)} ${g.home ? '' : '@'}${esc(shortName(g.opp.name))}</small><b>${esc(last(g.starter))}</b></div>`).join('')}</div>
  </div>`;
}
const nameOfFull = (sum, id) => { const g = sum.goalies.find(x => x.id === id); return g ? `${g.first} ${g.last}` : '–'; };

function h2hHtml(h, next, sai, opp, sSum, oSum) {
  const homeT = teamNum(next.homeTeamId) === SAIPA_NUM ? sai : opp;
  // All-time record. The API reports from the home team's view: wins/losses = regulation results,
  // ties = level after 60 minutes, of which overtimeWins/shootoutWins were decided in OT or shootout.
  let all = '';
  if (h.allTime?.home && h.allTime?.away) {
    const H = h.allTime.home, A = h.allTime.away;
    const n = H.wins + H.ties + H.losses;
    const hExtra = (H.overtimeWins || 0) + (H.shootoutWins || 0), aExtra = (A.overtimeWins || 0) + (A.shootoutWins || 0);
    const draws = Math.max(0, H.ties - hExtra - aExtra);
    const homeIsSai = homeT === sai;
    const sW = (homeIsSai ? H.wins + hExtra : A.wins + aExtra), oW = (homeIsSai ? A.wins + aExtra : H.wins + hExtra);
    all = `<div class="h2h-all">
      <div class="k">Kaikki runkosarjaottelut (${n})</div>
      <div class="h2h-bar">${(() => { const sp = `<span class="s" style="width:${sW / n * 100}%">${PV_SWAP ? `${sW} ${esc(sai.name)}` : `${esc(sai.name)} ${sW}`}</span>`, op = `<span class="o" style="width:${oW / n * 100}%">${PV_SWAP ? `${esc(opp.name)} ${oW}` : `${oW} ${esc(opp.name)}`}</span>`, tp = draws ? `<span class="t" style="width:${draws / n * 100}%" data-tip="Tasapelit\t${draws}">${draws}</span>` : ''; return PV_SWAP ? op + tp + sp : sp + tp + op; })()}</div>
    </div>`;
  }
  const ms = h.meetings;
  let sw = 0, ow = 0;
  const res = m => { const sHome = teamNum(m.homeTeamId) === SAIPA_NUM; return { sHome, s: sHome ? m.homeTeamGoals : m.awayTeamGoals, o: sHome ? m.awayTeamGoals : m.homeTeamGoals }; };
  for (const m of ms) { const r = res(m); if (r.s > r.o) sw++; else if (r.o > r.s) ow++; }
  const chips = ms.slice(0, 6).reverse().map(m => {
    const ext = m.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME' ? ' JA' : m.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION' ? ' VL' : '';
    const r = res(m), d = new Date(m.start).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', year: '2-digit' });
    return `<div class="hm ${r.s > r.o ? 'w' : 'l'}" data-tip="${esc(`${d} ${m.homeTeamName}–${m.awayTeamName} ${m.homeTeamGoals}–${m.awayTeamGoals}${ext}`)}"><b>${r.s}–${r.o}${ext}</b><small>${r.sHome ? 'koti' : 'vieras'} · ${d}</small></div>`;
  }).join('');
  const ptsList = sum => {
    const rows = sum.players.map(p => ({ p, x: h.pts.get(p.id) })).filter(r => r.x && (r.x.g + r.x.a) > 0)
      .sort((a, b) => (b.x.g + b.x.a) - (a.x.g + a.x.a) || b.x.g - a.x.g).slice(0, 3);
    return rows.length ? rows.map(r => `<div class="h2h-p"><span>${esc(r.p.last)}</span><b>${r.x.g + r.x.a} p</b><small>${r.x.gp} ott.</small></div>`).join('') : '<div class="muted small">Ei pisteitä.</div>';
  };
  const since = `${h.fromSeason - 1}–${String(h.fromSeason).slice(2)}`;
  return `${all}
    <div class="k">Viimeiset runkosarjakohtaamiset, SaiPan tulos · kaudesta ${since}: SaiPa ${sw}, ${esc(opp.name)} ${ow} voittoa</div>
    ${chips ? `<div class="hm-strip">${chips}</div>` : '<p class="muted">Ei kohtaamisia.</p>'}
    <div class="grid2 flat h2h-pl">${homeFirst(`<div><div class="k">SaiPan pistemiehet vs. ${esc(opp.name)}</div>${ptsList(sSum)}</div>`, `<div><div class="k">${esc(gen(opp.name))} pistemiehet vs. SaiPa</div>${ptsList(oSum)}</div>`).join('')}</div>
    <p class="muted small">Nykyisten pelaajien pisteet kaudesta ${since} alkaen, vain nykyisessä joukkueessa pelatut ottelut.</p>`;
}

/* ---------- lineups ---------- */
// Lineup from a game roster: players with a line number are dressed. Empty until the league publishes it.
function lineupOf(roster) {
  const all = roster || [];
  const dressed = all.filter(p => p.line != null);
  if (!dressed.some(p => p.roleCode !== 'MV')) return null;
  const lines = {};
  // Extra skaters use ordinal role codes such as "7. P", "8. P" or "13. H".
  for (const p of dressed) if (p.roleCode !== 'MV') {
    const l = (lines[p.line] = lines[p.line] || { extra: [] });
    if (/^\d+\. [PH]$/.test(p.roleCode)) l.extra.push(p); else l[p.roleCode] = p;
  }
  return {
    lines,
    goalies: dressed.filter(p => p.roleCode === 'MV').sort((a, b) => a.line - b.line),
    out: all.filter(p => p.line == null && !p.removed),
    ids: new Set(dressed.map(p => p.id)),
    all: dressed,
  };
}

async function loadLineups(next, nextGame, sG, oG, homeId) {
  const rosterOf = (g, teamId) => g ? (teamNum(g.game.homeTeam.teamId) === teamId ? g.homeTeamPlayers : g.awayTeamPlayers) : null;
  const prevGame = async (games) => { const last = games[games.length - 1]; return last ? { row: last, g: await getJSON(`/games/${SEASON}/${last.id}`).catch(() => null) } : null; };
  const [ps, po] = await Promise.all([prevGame(sG), prevGame(oG)]);
  const oppId = homeId === SAIPA_NUM ? teamNum(next.awayTeamId) : homeId;
  const build = (teamId, prev) => {
    const roster = rosterOf(nextGame, teamId) || [];
    const cur = lineupOf(roster);
    const prevL = prev?.g ? lineupOf(rosterOf(prev.g, teamId)) : null;
    const flagged = roster.filter(p => p.injured || p.suspended);
    return { cur, prev: prevL, prevRow: prev?.row || null, flagged };
  };
  return { sai: build(SAIPA_NUM, ps), opp: build(oppId, po) };
}

// Lineups as a head-to-head board: each line is one row, SaiPa's players on the left and the opponent's on
// the right, forwards above defence. Extra skaters ("7. P", "13. H") join their own position group.
function lineupBoard(sai, opp, lineups, sSum, oSum) {
  const sides = [[sai, lineups.sai, sSum], [opp, lineups.opp, oSum]].map(([t, L, sum]) => ({ t, L, shown: L.cur || L.prev, pts: new Map(sum.players.map(p => [p.id, p])) }));
  if (!sides.some(x => x.shown)) return '<p class="muted">Kokoonpanotietoa ei ole saatavilla.</p>';
  const chip = (x, p, role) => {
    if (!p) return '<div class="lp empty"></div>';
    const s = x.pts.get(p.id), isNew = x.L.cur && x.L.prev && !x.L.prev.ids.has(p.id);
    const r = role || p.roleCode;
    const tip = `${p.firstName} ${p.lastName}\nPaikka\t${r} · #${p.jersey ?? ''}${s ? `\nTehot\t${s.g}+${s.a} = ${s.pts} p\nOttelut\t${s.gp}` : ''}${isNew ? '\nMuutos\tUusi edelliseen otteluun' : ''}`;
    return `<div class="lp ${isNew ? 'new' : ''}" data-tip="${esc(tip)}">
      <div class="lp-ph">${p.pictureUrl ? `<img src="${esc(p.pictureUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${esc((p.firstName || '')[0] || '')}${esc((p.lastName || '')[0] || '')}</span>${p.captain ? '<i>C</i>' : p.alternateCaptain ? '<i>A</i>' : ''}</div>
      <div class="lp-t"><b>${x.t.id === SAIPA_NUM ? plink(p, esc(p.lastName)) : esc(p.lastName)}</b><small>${esc(r)} · #${p.jersey ?? ''}${s && !/MV/.test(r) ? ` · ${s.pts} p` : ''}</small></div>
    </div>`;
  };
  const lineRows = (x, n) => {
    const l = x.shown?.lines[n];
    if (!l) return { fw: '', df: '' };
    const fw = [l.VL, l.KH, l.OL].some(Boolean) ? [chip(x, l.VL, 'VL'), chip(x, l.KH, 'KH'), chip(x, l.OL, 'OL')].join('') : '';
    const df = l.VP || l.OP ? [chip(x, l.VP, 'VP'), chip(x, l.OP, 'OP')].join('') : '';
    return { fw, df };
  };
  const hasLine = (x, n) => { const l = x.shown?.lines[n]; return l && [l.VL, l.KH, l.OL, l.VP, l.OP].some(Boolean); };
  const nums = [...new Set(sides.flatMap(x => x.shown ? Object.keys(x.shown.lines).map(Number) : []))].filter(n => sides.some(x => hasLine(x, n))).sort((a, b) => a - b);
  // Extra skaters ("7. P", "13. H") are listed on a line in the data but play wherever needed: their own row
  const extras = x => Object.values(x.shown?.lines || {}).flatMap(l => l.extra).sort((a, b) => a.roleCode.localeCompare(b.roleCode)).map(p => chip(x, p)).join('');
  const [A, B] = PV_SWAP ? [sides[1], sides[0]] : sides;
  const lines = nums.map(n => {
    const a = lineRows(A, n), b = lineRows(B, n);
    return `<div class="lb-line">
      <div class="lb-side a">${a.fw ? `<div class="lb-r">${a.fw}</div>` : ''}${a.df ? `<div class="lb-r">${a.df}</div>` : ''}</div>
      <div class="lb-n"><b>${n}.</b><span>kenttä</span></div>
      <div class="lb-side b">${b.fw ? `<div class="lb-r">${b.fw}</div>` : ''}${b.df ? `<div class="lb-r">${b.df}</div>` : ''}</div>
    </div>`;
  }).join('');
  const gk = x => (x.shown?.goalies || []).map(g => chip(x, g, g.line === 1 ? '1. MV' : '2. MV')).join('');
  const status = x => x.L.cur ? '<span class="badge b-hot">Vahvistettu</span>'
    : x.L.prev ? `<span class="muted small">Edellisen ottelun kokoonpano (${fiDate(x.L.prevRow.start)} ${x.L.prevRow.home ? 'vs' : '@'} ${esc(x.L.prevRow.opp.name)})</span>` : '<span class="muted small">Ei tietoa</span>';
  const notes = x => {
    const out = [];
    if (x.L.cur && x.L.prev) {
      const inn = [...x.L.cur.ids].filter(id => !x.L.prev.ids.has(id)), gone = [...x.L.prev.ids].filter(id => !x.L.cur.ids.has(id));
      const nm = (lu, id) => (lu.all.find(p => p.id === id) || {}).lastName || '?';
      out.push(inn.length || gone.length ? `${inn.length ? `<b>Sisään</b> ${inn.map(id => esc(nm(x.L.cur, id))).join(', ')}` : ''}${inn.length && gone.length ? ' · ' : ''}${gone.length ? `<b>Ulos</b> ${gone.map(id => esc(nm(x.L.prev, id))).join(', ')}` : ''}` : 'Sama kokoonpano kuin edellisessä ottelussa');
    }
    const absent = x.L.cur ? x.L.cur.out.filter(p => p.injured || p.suspended) : x.L.flagged;
    if (absent.length) out.push(`<b>Poissa</b> ${absent.map(p => `${esc(p.lastName)} (${p.injured ? 'loukkaantunut' : 'pelikielto'})`).join(', ')}`);
    return out.map(t => `<div>${t}</div>`).join('');
  };
  return `<div class="lb">
    <div class="lb-head"><div>${logoImg(A.t)}<b>${esc(A.t.name)}</b>${status(A)}</div><div></div><div class="b">${status(B)}<b>${esc(B.t.name)}</b>${logoImg(B.t)}</div></div>
    ${lines}
    ${extras(A) || extras(B) ? `<div class="lb-line"><div class="lb-side a"><div class="lb-r">${extras(A)}</div></div><div class="lb-n"><b>+</b><span>lisäpelaajat</span></div><div class="lb-side b"><div class="lb-r">${extras(B)}</div></div></div>` : ''}
    <div class="lb-line gk"><div class="lb-side a"><div class="lb-r">${gk(A)}</div></div><div class="lb-n"><b>MV</b><span>maalivahdit</span></div><div class="lb-side b"><div class="lb-r">${gk(B)}</div></div></div>
    <div class="lb-notes"><div>${notes(A)}</div><div class="b">${notes(B)}</div></div>
  </div>`;
}
