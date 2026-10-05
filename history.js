/* SaiPa Data: history (M7 batch 2): all-time lists and player careers (PL-4), this day in history (HI-1),
 * attendance (HI-2). Uses data/saipa-alltime.js and helpers from app.js, player.js and insights.js. */

// SaiPa's Liiga regular seasons (season = the year the season ends). From the league's team season list.
const SAIPA_SEASONS = [1981, 1982, 1983, 1984, 1985, 1986, 1989, 1990, 1991, ...Array.from({ length: SEASON - 1997 + 1 }, (_, i) => 1997 + i)];
const seasonLabel = y => `${y - 1}–${String(y).slice(2)}`;

/* ---------- all-time data ---------- */
function allTimeRows() {
  const A = window.SAIPA_ALLTIME;
  if (!A) return [];
  return A.rows.split(';').map(r => {
    const [id, first, last, from, to, seasons, gp, g, a, pim, gk] = r.split('|');
    return { id: +id, first, last, from: +from, to: +to, seasons: +seasons, gp: +gp, g: +g, a: +a, pim: +pim, gk: gk === '1', p: +g + +a };
  });
}
// All-time totals including the current season: current SaiPa players get this season's league totals added.
async function allTimeWithCurrent() {
  const base = allTimeRows();
  const L = await loadLeagueSkaters().catch(() => ({ sk: [], gks: [] }));
  const cur = new Map([...L.sk, ...L.gks].filter(p => p.team === SAIPA_NUM).map(p => [p.id, p]));
  const out = base.map(r => {
    const c = cur.get(r.id);
    return c ? { ...r, gp: r.gp + (c.gp || 0), g: r.g + (c.g || 0), a: r.a + (c.a || 0), p: r.p + (c.g || 0) + (c.a || 0), to: SEASON, active: true } : r;
  });
  return { rows: out, cur };
}

/* ---------- PL-4: player career ---------- */
async function careerHtml(id, isGk, seasonRows) {
  const info = await getJSON(`/players/info/${id}`);
  const reg = (info.historical?.regular || []).filter(s => s.leagueName === 'Liiga' || !s.leagueName).sort((a, b) => b.season - a.season);
  if (!reg.length) return '<p class="muted">Uratietoja ei ole saatavilla.</p>';
  // Current season from SaiPa's own games (same numbers as the rest of the page), earlier seasons from the league history
  const curSaipa = seasonRows.filter(r => r.p && (isGk ? r.p.played : true));
  const cur = isGk ? null : { gp: curSaipa.length, g: curSaipa.reduce((s, r) => s + (r.p.g || 0), 0), a: curSaipa.reduce((s, r) => s + (r.p.a || 0), 0) };
  const rows = reg.map(s => s.season === SEASON && s.teamName === 'SaiPa' && cur ? { ...s, playedGames: cur.gp, goals: cur.g, assists: cur.a, points: cur.g + cur.a } : s);
  const sai = rows.filter(s => s.teamName === 'SaiPa');
  const tot = sai.reduce((t, s) => ({ gp: t.gp + (s.playedGames ?? s.games ?? 0), g: t.g + (s.goals || 0), a: t.a + (s.assists || 0) }), { gp: 0, g: 0, a: 0 });
  tot.p = tot.g + tot.a;
  const all = rows.reduce((t, s) => ({ gp: t.gp + (s.playedGames ?? s.games ?? 0), g: t.g + (s.goals || 0), a: t.a + (s.assists || 0) }), { gp: 0, g: 0, a: 0 });

  // Rank on SaiPa's all-time lists (other players from the all-time data, this player from his own history)
  const { rows: at } = await allTimeWithCurrent();
  const others = at.filter(r => r.id !== id && r.gk === isGk);
  const keys = isGk ? [['gp', 'Ottelut SaiPassa', 'ottelua', 'ottelun']] : [['p', 'Pisteet SaiPassa', 'pistettä', 'pisteen'], ['g', 'Maalit SaiPassa', 'maalia', 'maalin'], ['gp', 'Ottelut SaiPassa', 'ottelua', 'ottelun']];
  const ROUND = [5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000];
  const cards = keys.map(([k, label, unit, gen1]) => {
    const v = tot[k] || 0;
    const above = others.filter(o => o[k] > v);
    const rank = above.length + 1;
    const next = above.sort((a, b) => a[k] - b[k])[0];
    const target = ROUND.find(t => t > v) || v + 100;
    const prev = [...ROUND].reverse().find(t => t <= v) || 0;
    const share = (v - prev) / (target - prev);
    const rankTxt = rank <= 100 ? `<span class="ms-rank">${rank}.</span> kaikkien aikojen listalla` : `<span class="ms-rank out">Top 100</span> vaatii ${(others.filter(o => o[k] > 0).map(o => o[k]).sort((a, b) => b - a)[99] ?? 0) - v + 1} lisää`;
    return `<div class="ms">
      <div class="ms-k">${label}</div>
      <div class="ms-v">${v}</div>
      <div class="ms-bar"><i style="width:${Math.max(3, share * 100)}%"></i><span>${prev}</span><span>${target}</span></div>
      <div class="ms-t"><b>${target - v}</b> ${target - v === 1 ? ({ pisteen: 'piste', maalin: 'maali', ottelun: 'ottelu' })[gen1] : unit} ${target} ${gen1} rajapyykkiin</div>
      <div class="ms-r">${rankTxt}</div>
      ${rank <= 100 && next ? `<div class="ms-n">Seuraavana edellä: ${esc(next.first)} ${esc(next.last)} (${next[k]})</div>` : ''}
    </div>`;
  }).join('');

  // Points (games for goalies) per season, SaiPa seasons highlighted
  const chrono = [...rows].sort((a, b) => a.season - b.season || (a.teamName === 'SaiPa') - (b.teamName === 'SaiPa'));
  const val = s => isGk ? (s.playedGames ?? s.games ?? 0) : (s.goals || 0) + (s.assists || 0);
  const maxV = Math.max(1, ...chrono.map(val));
  const bars = chrono.length >= 2 ? `<div class="cr-bars">${chrono.map(s => `
    <div class="cr-b ${s.teamName === 'SaiPa' ? 'sai' : ''}" data-tip="${esc([`${seasonLabel(s.season)}, ${s.teamName}`, `Ottelut\t${s.playedGames ?? s.games}`, ...(isGk ? [`Torjunta-%\t${s.saves != null && (s.saves + (s.goalsAgainst || 0)) ? pct(s.saves / (s.saves + (s.goalsAgainst || 0)), 1) : '–'}`, `Päästetyt\t${s.goalsAgainst ?? '–'}`] : [`Maalit\t${s.goals}`, `Syötöt\t${s.assists}`, `Pisteet\t${(s.goals || 0) + (s.assists || 0)}`, `Jäähyt\t${s.penaltyMinutes ?? 0} min`])].join('\n'))}">
      <b>${val(s)}</b><i style="height:${Math.max(4, val(s) / maxV * 110)}px"></i><span>${String(s.season - 1).slice(2)}–${String(s.season).slice(2)}</span><small>${esc(s.teamShortName || s.teamName.slice(0, 3))}</small>
    </div>`).join('')}</div><p class="muted small">${isGk ? 'Ottelut' : 'Pisteet'} kausittain, SaiPa-kaudet keltaisella.</p>` : '';
  const head = isGk ? '<tr><th>Kausi</th><th>Joukkue</th><th>O</th><th>Torj-%</th><th>PM</th></tr>' : '<tr><th>Kausi</th><th>Joukkue</th><th>O</th><th>M</th><th>S</th><th>P</th><th>J</th></tr>';
  const tr = s => isGk
    ? `<tr class="${s.teamName === 'SaiPa' ? 'sai' : ''}"><td>${seasonLabel(s.season)}</td><td>${esc(s.teamName)}</td><td>${s.playedGames ?? s.games}</td><td>${s.saves != null && (s.saves + (s.goalsAgainst || 0)) ? pct(s.saves / (s.saves + (s.goalsAgainst || 0)), 1) : '–'}</td><td>${s.goalsAgainst ?? '–'}</td></tr>`
    : `<tr class="${s.teamName === 'SaiPa' ? 'sai' : ''}"><td>${seasonLabel(s.season)}</td><td>${esc(s.teamName)}</td><td>${s.playedGames ?? s.games}</td><td>${s.goals}</td><td>${s.assists}</td><td><b>${(s.goals || 0) + (s.assists || 0)}</b></td><td>${s.penaltyMinutes ?? ''}</td></tr>`;
  return `
    <div class="ms-grid">${cards}</div>
    ${bars}
    ${chrono.length >= 2 ? `<details class="cr-det"><summary>Kausittaiset tilastot</summary><div class="tablewrap"><table class="mini career">${head}${rows.map(tr).join('')}</table></div></details>` : ''}
    <p class="muted small">Liigan runkosarja. Kuluva kausi SaiPan otteluista, aiemmat kaudet liiga.fi:n pelaajahistoriasta. Kaikkien aikojen listat: SaiPan Liiga-kaudet 1980–81 alkaen.</p>`;
}

/* ---------- history view ---------- */
let historyDone = false;
let histGamesP = null;
function loadHistoryGames() {
  if (histGamesP) return histGamesP;
  histGamesP = (async () => {
    const out = [];
    let i = 0;
    const worker = async () => {
      while (i < SAIPA_SEASONS.length) {
        const y = SAIPA_SEASONS[i++];
        const s = await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${y}`).catch(() => []);
        for (const g of s) {
          const h = teamNum(g.homeTeamId) === SAIPA_NUM, a = teamNum(g.awayTeamId) === SAIPA_NUM;
          if ((!h && !a) || !g.ended) continue;
          out.push({ season: y, id: g.id, start: g.start, home: h, opp: h ? g.awayTeamName : g.homeTeamName, gf: h ? g.homeTeamGoals : g.awayTeamGoals, ga: h ? g.awayTeamGoals : g.homeTeamGoals, ft: g.finishedType, spect: g.spectators || 0 });
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return out.sort((a, b) => a.start.localeCompare(b.start));
  })();
  histGamesP.catch(() => { histGamesP = null; });
  return histGamesP;
}
const fiYMD = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
const fiMD = iso => fiYMD(iso).slice(5);
// ?date=YYYY-MM-DD: "this day in history" for another day, as if it were that day (not linked from the UI)
const HIST_DATE = (() => { const d = new URLSearchParams(location.search).get('date'); return /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(new Date(d)) ? d : null; })();
const sfx = ft => ft === 'ENDED_DURING_EXTENDED_GAME_TIME' ? ' JA' : ft === 'ENDED_DURING_WINNING_SHOT_COMPETITION' ? ' VL' : '';

async function renderHistory() {
  if (historyDone) return;
  historyDone = true;
  const box = $('#historyContent');
  box.innerHTML = `
    <div class="card" id="todayCard"><h2><span class="tag">Tällä päivämäärällä</span></h2><p class="loading">Haetaan otteluhistoriaa…</p></div>
    <div class="card" id="alltimeCard"><h2>Kaikkien aikojen SaiPa</h2><p class="loading">Lasketaan…</p></div>
    <div class="card" id="attCard"><h2>Yleisömäärät</h2><p class="loading">Haetaan…</p></div>`;
  const put = (sel, title, html) => { const el = $(sel); if (el) el.innerHTML = `<h2>${title}</h2>${html}`; };
  allTimeWithCurrent().then(x => put('#alltimeCard', 'Kaikkien aikojen SaiPa', allTimeHtml(x.rows)))
    .catch(e => put('#alltimeCard', 'Kaikkien aikojen SaiPa', `<p class="neg-num">${esc(e.message)}</p>`));
  try {
    const games = await loadHistoryGames();
    put('#todayCard', '<span class="tag">Tällä päivämäärällä</span>', await todayHtml(games));
    const cur = await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`).catch(() => []);
    put('#attCard', 'Yleisömäärät', attendanceHtml(games, cur));
  } catch (e) {
    historyDone = false;
    put('#todayCard', 'Tällä päivämäärällä', `<p class="neg-num">Historian haku epäonnistui: ${esc(e.message)}</p>`);
  }
}

/* ---------- HI-1: this day in SaiPa history ---------- */
async function todayHtml(games) {
  const refDay = HIST_DATE || fiYMD(Date.now()), today = refDay.slice(5), isToday = refDay === fiYMD(Date.now());
  let pick = games.filter(g => fiMD(g.start) === today && g.season < SEASON + 1 && fiYMD(g.start) < refDay);
  let note = '';
  if (!pick.length) {
    // No game on this date: show the nearest dates within a week
    const md = d => { const [m, dd] = d.split('-').map(Number); return m * 31 + dd; };
    const t = md(today);
    const near = games.filter(g => fiYMD(g.start) < refDay).map(g => ({ g, d: Math.abs(md(fiMD(g.start)) - t) })).filter(x => x.d > 0 && x.d <= 7).sort((a, b) => a.d - b.d);
    if (near.length) { const d = near[0].d; pick = near.filter(x => x.d === d).map(x => x.g); note = `Tällä päivämäärällä ei ole pelattu SaiPan Liiga-otteluita. Lähin päivämäärä: ${fiDate(pick[0].start)}.`; }
  }
  if (!pick.length) return '<p class="muted">Tältä ajankohdalta ei löydy SaiPan Liiga-otteluita.</p>';
  const chrono = [...pick].sort((a, b) => a.start.localeCompare(b.start));
  const res = g => g.gf > g.ga ? 'w' : g.gf < g.ga ? 'l' : 't';
  const yr = g => new Date(g.start).getFullYear();
  const now = +refDay.slice(0, 4);
  const total = chrono.length, wins = chrono.filter(g => res(g) === 'w').length, losses = chrono.filter(g => res(g) === 'l').length;
  const gf = chrono.reduce((a, g) => a + g.gf, 0), ga = chrono.reduce((a, g) => a + g.ga, 0);
  // Current run on this date, newest first
  const last = chrono[total - 1], runRes = res(last);
  let run = 0; for (let k = total - 1; k >= 0 && res(chrono[k]) === runRes; k--) run++;
  const lastWin = [...chrono].reverse().find(g => res(g) === 'w');
  // Biggest win / loss: every game tied for the largest margin, newest first
  const bigAll = f => { const m = Math.max(...chrono.map(f)); return [...chrono].filter(g => f(g) === m).sort((a, b) => b.start.localeCompare(a.start)); };
  const bestW = wins ? bigAll(g => g.gf - g.ga) : [], worstL = losses ? bigAll(g => g.ga - g.gf) : [];
  const score = g => `${g.home ? `SaiPa–${g.opp}` : `${g.opp}–SaiPa`} ${g.home ? `${g.gf}–${g.ga}` : `${g.ga}–${g.gf}`}${sfx(g.ft)}`;
  // Goal scorers for every game on this date
  const details = await Promise.all(chrono.map(g => getJSON(`/games/${g.season}/${g.id}`).catch(() => null)));
  const scorers = chrono.map((g, i) => {
    const d = details[i], team = d ? (g.home ? d.game.homeTeam : d.game.awayTeam) : null, sc = new Map();
    for (const e of (team?.goalEvents || []).filter(validGoal)) { const n = e.scorerPlayer ? `${e.scorerPlayer.firstName} ${e.scorerPlayer.lastName}` : '?'; sc.set(n, (sc.get(n) || 0) + 1); }
    return sc;
  });
  const allSc = new Map();
  scorers.forEach(sc => sc.forEach((c, n) => { if (n !== '?') allSc.set(n, (allSc.get(n) || 0) + c); }));
  // Everyone tied for the most goals is named (two shown, the rest as +N); the hover lists the whole top
  const scList = [...allSc.entries()].sort((a, b) => b[1] - a[1]);
  const topN = scList.length ? scList[0][1] : 0, tied = scList.filter(x => x[1] === topN).map(x => x[0]);
  const scTip = ['🚨 Eniten maaleja tällä päivämäärällä', ...scList.filter(x => x[1] >= Math.min(topN, 2)).slice(0, 8).map(([n, c]) => `${n}\t${c} G`)].join('\n');
  // SaiPa playing today?
  const cur = await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`).catch(() => []);
  const todayG = note || !isToday ? null : cur.find(g => fiMD(g.start) === today && !g.ended && new Date(g.start).toDateString() === new Date().toDateString() && (teamNum(g.homeTeamId) === SAIPA_NUM || teamNum(g.awayTeamId) === SAIPA_NUM));
  const marginTile = (ic, k, list, tone) => {
    const g = list[0], more = list.length > 1 ? ` +${list.length - 1}` : '';
    const tip = [`${ic} ${k}`, ...list.map(x => `${yr(x)}\t${score(x)}`)].join('\n');
    // Big number = the result (home team first), bottom line = year and the matchup
    const res2 = g.home ? `${g.gf}–${g.ga}` : `${g.ga}–${g.gf}`, pair = g.home ? `SaiPa–${g.opp}` : `${g.opp}–SaiPa`;
    return tile(ic, k, res2, sfx(g.ft).trim(), null, esc(`${yr(g)} · ${pair}${more}`), tone, tip);
  };
  const runWord = { w: ['voittoa', 'Voittoputki'], l: ['tappiota', 'Tappioputki'], t: ['tasapeliä', 'Tasapeliputki'] }[runRes];
  const T = [
    tile('📅', 'Tällä päivämäärällä', `${wins}–${total - wins - losses}–${losses}`, 'V–T–H', null, `${total} ottelua · maalit ${gf}–${ga}`),
    lastWin ? tile('🏁', 'Edellinen voitto', now - yr(lastWin), 'v sitten', null, esc(`${yr(lastWin)} · ${score(lastWin)}`), now - yr(lastWin) >= 10 ? 'neg' : 'pos')
      : tile('🏁', 'Edellinen voitto', '–', '', null, 'ei yhtään voittoa tällä päivämäärällä', 'neg'),
    run >= 2 ? tile(runRes === 'w' ? '🔥' : '🥶', runWord[1], run, runWord[0], null, `peräkkäin vuodesta ${yr(chrono[total - run])}`, runRes === 'w' ? 'pos' : 'neg') : '',
    bestW.length ? marginTile('💪', 'Isoin voitto', bestW, 'pos') : '',
    worstL.length ? marginTile('💥', 'Isoin tappio', worstL, 'neg') : '',
    topN >= 2 ? tile('🚨', 'Eniten maaleja', topN, 'G', null, esc(tied.length > 2 ? `${tied.slice(0, 2).join(', ')} +${tied.length - 2}` : tied.join(', ')), '', scTip) : '',
  ].filter(Boolean);
  const todayLine = todayG ? `<div class="hd-today">🏒 Tänään ${esc(teamNum(todayG.homeTeamId) === SAIPA_NUM ? `SaiPa–${todayG.awayTeamName}` : `${todayG.homeTeamName}–SaiPa`)}${run >= 2 ? ` · ${runRes === 'w' ? 'voittoputki jatkuu, jos SaiPa voittaa' : `${run} ottelun ${runWord[1].toLowerCase()} voi katketa`}` : ''}</div>` : '';
  const show = [...chrono].reverse();
  const items = show.map(g => {
    const i = chrono.indexOf(g), sc = [...scorers[i].entries()].map(([n, c]) => { const l = esc(n.split(' ').slice(-1)[0]); return c > 1 ? `${l} ${c}` : l; }).join(', ');
    return `<li class="hd ${res(g)}"><div class="hd-y">${yr(g)}<small>${now - yr(g)} v sitten</small></div>
      <div class="hd-g"><b>${esc(score(g))}</b>
      <span>${seasonLabel(g.season)}${g.spect ? ` · yleisöä ${g.spect.toLocaleString('fi-FI')}` : ''}</span>
      ${sc ? `<span class="muted small">SaiPan maalit: ${sc}</span>` : ''}</div></li>`;
  });
  return `${note ? `<p class="muted">${note}</p>` : ''}${todayLine}<div class="tiles s-hl" data-n="${T.length}">${T.join('')}</div>
    <h3>Ottelut <span class="muted">${total}</span></h3><ol class="hday">${items.slice(0, 5).join('')}</ol>
    ${total > 5 ? `<details class="hd-more"><summary>Näytä kaikki ${total} ottelua</summary><ol class="hday">${items.slice(5).join('')}</ol></details>` : ''}`;
}

/* ---------- PL-4: all-time lists ---------- */
function allTimeHtml(rows) {
  const sk = rows.filter(r => !r.gk), gk = rows.filter(r => r.gk);
  const list = (arr, k, label, n = 15) => `<div><h3>${label}</h3><ol class="toplist at">${[...arr].sort((a, b) => b[k] - a[k] || b.gp - a.gp).slice(0, n).map((r, i) => `
    <li class="${r.active ? 'me' : ''}"><span class="tl-r">${i + 1}.</span><span class="tl-n">${r.active ? plink(r, `${esc(r.first)} ${esc(r.last)}`) : `${esc(r.first)} ${esc(r.last)}`} <small>${r.from === r.to ? seasonLabel(r.from) : `${r.from - 1}–${r.active ? '' : r.to}`}</small></span><b>${r[k]}</b></li>`).join('')}</ol></div>`;
  return `
    <div class="at-grid">
      ${list(sk, 'p', 'Pisteet')}${list(sk, 'g', 'Maalit')}${list(sk, 'a', 'Syötöt')}${list(sk, 'gp', 'Ottelut')}
      ${list(gk, 'gp', 'Maalivahdit, ottelut', 10)}
    </div>
    <p class="muted small">SaiPan Liiga-runkosarjat kaudesta 1980–81 alkaen, kuluva kausi mukana. Korostetut pelaavat SaiPassa nyt. Lähde: liiga.fi:n pelaajahistoria. Kesken kauden siirtyneet pelaajat voivat puuttua listalta, jos Liiga on kirjannut heidän koko kautensa toiselle joukkueelle. Vanhimpien kausien tiedot voivat olla puutteellisia.</p>`;
}

/* ---------- HI-2: attendance ---------- */
function attendanceHtml(games, curSched) {
  const homeAll = games.filter(g => g.home && g.spect);
  const curHome = fcPlayed(curSched).filter(g => teamNum(g.homeTeamId) === SAIPA_NUM && g.spectators);
  // Season averages
  const by = new Map();
  for (const g of homeAll) { const s = by.get(g.season) || by.set(g.season, { n: 0, sum: 0 }).get(g.season); s.n++; s.sum += g.spect; }
  if (curHome.length) by.set(SEASON, { n: curHome.length, sum: curHome.reduce((s, g) => s + g.spectators, 0) });
  const seasons = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([y, s]) => ({ y, avg: s.sum / s.n, n: s.n }));
  const max = Math.max(...seasons.map(s => s.avg));
  const W = 760, H = 200, pad = 30, bw = (W - pad * 2) / seasons.length;
  const chart = `<svg viewBox="0 0 ${W} ${H + 20}" class="gs-chart">
    ${seasons.map((s, i) => `<rect x="${pad + i * bw + 1}" y="${pad + (1 - s.avg / max) * (H - pad)}" width="${bw - 2}" height="${(s.avg / max) * (H - pad)}" class="${s.y === SEASON ? 'att-cur' : 'att'}"><title>${seasonLabel(s.y)}
Keskiyleisö	${Math.round(s.avg).toLocaleString('fi-FI')}
Kotiottelut	${s.n}</title></rect>
      ${i % 4 === 0 || s.y === SEASON ? `<text x="${pad + i * bw + bw / 2}" y="${H + 14}" class="gc-l">${s.y - 1}</text>` : ''}`).join('')}
  </svg>`;
  const record = [...homeAll].sort((a, b) => b.spect - a.spect).slice(0, 5);
  // This season: every team's average home attendance
  const teams = new Map();
  for (const g of fcPlayed(curSched)) { if (!g.spectators) continue; const id = teamNum(g.homeTeamId); const t = teams.get(id) || teams.set(id, { name: g.homeTeamName, n: 0, sum: 0, cap: 0 }).get(id); t.n++; t.sum += g.spectators; }
  const tl = [...teams.values()].map(t => ({ ...t, avg: t.sum / t.n })).sort((a, b) => b.avg - a.avg);
  const tmax = tl.length ? tl[0].avg : 1;
  const noHome = [...new Set(fcPlayed(curSched).map(g => g.awayTeamName))].filter(n => !tl.some(t => t.name === n));
  const sCur = seasons.find(s => s.y === SEASON), sPrev = seasons.find(s => s.y === SEASON - 1);
  return `
    ${sCur ? `<p class="lead">Kotiotteluiden keskiyleisö tällä kaudella <b>${Math.round(sCur.avg).toLocaleString('fi-FI')}</b>${sPrev ? ` (viime kausi ${Math.round(sPrev.avg).toLocaleString('fi-FI')}, ${signed((sCur.avg / sPrev.avg - 1) * 100, 0)} %)` : ''}. Liigan ${tl.findIndex(t => t.name === 'SaiPa') + 1}. suurin ${tl.length} joukkueesta.</p>` : ''}
    <h3>Keskiyleisö kausittain</h3>${chart}
    <div class="grid2 flat">
      <div><h3>Tämän kauden kotiottelut</h3>${curHome.length ? `<p class="att-avg">Keskiarvo <b>${Math.round(curHome.reduce((t, g) => t + g.spectators, 0) / curHome.length).toLocaleString('fi-FI')}</b> · ${curHome.length} ottelua</p>` : ''}<ol class="toplist dated">${[...curHome].sort((a, b) => b.start.localeCompare(a.start)).map(g => `<li><span class="tl-r">${fiDate(g.start)}</span><span class="tl-n">SaiPa–${esc(g.awayTeamName)}</span><b>${g.spectators.toLocaleString('fi-FI')}</b></li>`).join('')}</ol></div>
      <div><h3>Kotiotteluiden keskiyleisö joukkueittain</h3><p class="muted small">Tämä kausi, vain kunkin joukkueen omat kotiottelut.${noHome.length ? ` Ei vielä kotiotteluita: ${noHome.map(esc).join(', ')}.` : ''}</p><div class="att-list">${tl.map(t => `<div class="att-row ${t.name === 'SaiPa' ? 'me' : ''}"><span>${esc(t.name)}</span><div class="pf-bar"><i style="width:${t.avg / tmax * 100}%"></i></div><b>${Math.round(t.avg).toLocaleString('fi-FI')}</b></div>`).join('')}</div></div>
    </div>
    <h3>Suurimmat kotiyleisöt</h3><ol class="toplist dated">${record.map(g => `<li><span class="tl-r">${new Date(g.start).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Europe/Helsinki' })}</span><span class="tl-n">SaiPa–${esc(g.opp)} ${g.gf}–${g.ga}${sfx(g.ft)}</span><b>${g.spect.toLocaleString('fi-FI')}</b></li>`).join('')}</ol>
    <p class="muted small">Liigan runkosarjan kotiottelut, joista yleisömäärä on kirjattu. Lähde: liiga.fi:n otteluohjelma.</p>`;
}
