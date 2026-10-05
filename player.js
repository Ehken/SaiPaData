/* SaiPa Data: player and goalie pages (PL-1, PL-2, SM-2, GK-1).
 * Uses helpers from app.js, shots.js and preview.js. Opened with ?player=ID or by clicking a name. */

const plink = (p, text) => p && p.id ? `<a class="plink" data-pid="${p.id}" href="?player=${p.id}">${text}</a>` : text;
const posGroup = role => /MV/.test(role || '') ? 'G' : /^(P|VP|OP|\d+\. P)$/.test(role || '') ? 'D' : 'F';
const GROUP_LABEL = { F: 'hyökkääjät', D: 'puolustajat', G: 'maalivahdit' };
const GROUP_GEN = { F: 'hyökkääjien', D: 'puolustajien', G: 'maalivahtien' };
const GROUP_ILL = { F: 'hyökkääjiin', D: 'puolustajiin', G: 'maalivahteihin' };
const GROUP_ELA = { F: 'hyökkääjistä', D: 'puolustajista', G: 'maalivahdeista' };

/* ---------- league season totals ---------- */
let leagueSkP = null;
function loadLeagueSkaters() {
  if (leagueSkP) return leagueSkP;
  const u = t => getJSON(`/players/stats/summed/${SEASON}/${SEASON}/${TOURNAMENT}/true?dataType=${t}`).catch(() => []);
  leagueSkP = Promise.all([u('basicStats'), u('shotStats'), u('skatingStats'), u('gameTime'), u('basicStatsGk')]).then(([b, s, k, t, gk]) => {
    const by = arr => new Map((Array.isArray(arr) ? arr : []).map(x => [x.playerId, x]));
    const S = by(s), K = by(k), T = by(t);
    const sk = (Array.isArray(b) ? b : []).filter(x => !x.goalkeeper).map(x => {
      const sh = S.get(x.playerId) || {}, sa = K.get(x.playerId) || {}, ti = T.get(x.playerId) || {};
      const toi = x.timeOnIce || 0, per60 = v => toi ? v / toi * 3600 : null;
      return {
        id: x.playerId, team: x.teamId, name: `${x.firstName} ${x.lastName}`, group: posGroup(x.role), gp: x.playedGames || 0, g: x.goals || 0, a: x.assists || 0, toi, toiAvg: x.timeOnIceAvg || 0,
        g60: per60(x.goals || 0), p60: per60(x.points || 0), xg60: per60(x.expectedGoals || 0), sh60: per60(x.shots || 0),
        fin: (x.goals || 0) - (x.expectedGoals || 0),
        pp: ti.games ? (ti.powerplaySeconds || 0) / ti.games : null, pk: ti.games ? (ti.penaltykillSeconds || 0) / ti.games : null,
        speed: sa.topSpeed || null, dist: sa.distancePerMatch || null, shot: sh.hardestShotVelocity || null,
        fo: (x.contestWon || 0) + (x.contestLost || 0) >= 30 ? x.contestWonPercentage / 100 : null,
        gpBasic: x.playedGames || 0, gpShot: sh.playedGames || 0,
      };
    });
    const gks = (Array.isArray(gk) ? gk : []).map(x => ({
      id: x.playerId, team: x.teamId, name: `${x.firstName} ${x.lastName}`, gp: x.playedGames || 0, toi: x.timeOnIce || 0,
      sv: x.savePercentage != null ? x.savePercentage / 100 : null, gaa: x.goalsAgainstAvg ?? null,
      gsax: (x.expectedGoalsAgainst || 0) - (x.goalsAgainst || 0),
      gsax60: x.timeOnIce ? ((x.expectedGoalsAgainst || 0) - (x.goalsAgainst || 0)) / x.timeOnIce * 3600 : null,
      shots: (x.blockedOrSavedShots || 0) + (x.goalsAgainst || 0),
    }));
    return { sk, gks };
  });
  leagueSkP.catch(() => { leagueSkP = null; });
  return leagueSkP;
}

// Percentile 0–100 of x among values (ties count half). Higher = better unless lowBetter.
function percentile(values, x, lowBetter = false) {
  const v = values.filter(n => n != null && isFinite(n));
  if (x == null || !v.length) return null;
  let below = 0, eq = 0;
  for (const n of v) { if (lowBetter ? n > x : n < x) below++; else if (n === x) eq++; }
  return Math.round((below + eq / 2) / v.length * 100);
}
// Usage rows (ice time, special-teams time) describe the coach's deployment, not performance, so they are drawn
// neutral in their own group and never count as a strength or a weakness.
function pctBars(rows) {
  const row = r => `
    <div class="pct-row ${r.use ? 'use' : ''}" data-tip="${esc(`${r.en || r.l}\n${r.fi ? r.fi + '\n' : ''}Arvo\t${r.v}\nPersentiili\t${r.p}`)}"><div class="pct-l">${r.l}</div><div class="pct-v">${r.v}</div>
      <div class="pct-bar"><i class="${r.use ? '' : r.p >= 80 ? 'hi' : r.p <= 20 ? 'lo' : ''}" style="width:${Math.max(2, r.p)}%"></i></div><div class="pct-n">${r.p}</div></div>`;
  const ok = rows.filter(r => r.p != null), perf = ok.filter(r => !r.use), use = ok.filter(r => r.use);
  return `<div class="pct">${perf.map(row).join('')}${use.length ? `<div class="pct-sub">Käyttö</div>${use.map(row).join('')}` : ''}</div>`;
}

/* ---------- SaiPa game data for one player ---------- */
async function playerGames(id) {
  const rows = [];
  for (const sg of saipaGames) {
    const raw = await loadRaw(sg.id);
    const a = analyzeGame(raw.g, raw.st, null, raw.ctx);
    const p = a.people.find(x => x.id === id) || a.goalies.find(x => x.id === id && x.played);
    const roster = [...(raw.g.homeTeamPlayers || []), ...(raw.g.awayTeamPlayers || [])].find(x => x.id === id);
    if (!p && !roster) continue;
    rows.push({ game: sg, a, p, raw, roster });
  }
  return rows.sort((x, y) => x.game.start.localeCompare(y.game.start));
}
const oppLabel = r => `${fiDate(r.game.start)} ${r.a.home ? 'vs' : '@'} ${r.a.opp.teamName}`;
const resLabelText = r => {
  const s = r.a.saipa.goals ?? 0, o = r.a.opp.goals ?? 0;
  return `${s > o ? 'voitto' : s < o ? 'tappio' : 'tasan'} ${s}–${o}${r.a.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME' ? ' JA' : r.a.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION' ? ' VL' : ''}`;
};
const resLabel = r => {
  const s = r.a.saipa.goals ?? 0, o = r.a.opp.goals ?? 0;
  const sfx = r.a.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME' ? ' JA' : r.a.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION' ? ' VL' : '';
  return `<span class="${s > o ? 'pos-num' : s < o ? 'neg-num' : ''}">${s}–${o}${sfx}</span>`;
};

/* ---------- charts ---------- */
function gsChart(rows) {
  const played = rows.filter(r => r.p && r.p.gs != null);
  if (!played.length) return '';
  const W = 760, H = 200, pad = 28, n = played.length, bw = Math.min(46, (W - pad * 2) / n - 6);
  const vals = played.map(r => r.p.gs), max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const y = v => pad + (max - v) / (max - min) * (H - pad * 2);
  const x = i => pad + (i + 0.5) * (W - pad * 2) / n;
  const avg = played.map((_, i) => { const w = vals.slice(Math.max(0, i - 2), i + 1); return w.reduce((s, v) => s + v, 0) / w.length; });
  return `<svg viewBox="0 0 ${W} ${H + 24}" class="gs-chart">
    <line x1="${pad}" x2="${W - pad}" y1="${y(0)}" y2="${y(0)}" class="gc-axis"/>
    ${played.map((r, i) => `<rect x="${x(i) - bw / 2}" y="${Math.min(y(0), y(r.p.gs))}" width="${bw}" height="${Math.abs(y(r.p.gs) - y(0)) || 1}" class="${r.p.gs >= 0 ? 'gc-pos' : 'gc-neg'}"><title>${esc(oppLabel(r))}: GS ${num(r.p.gs, 2)}</title></rect>
      <text x="${x(i)}" y="${Math.min(y(0), y(r.p.gs)) - 4}" class="gc-v">${num(r.p.gs, 1)}</text>
      <text x="${x(i)}" y="${H + 14}" class="gc-l">${fiDate(r.game.start)}</text>`).join('')}
    ${n > 2 ? `<polyline class="gc-avg" points="${avg.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>` : ''}
    ${hoverCols(played.map((_, i) => x(i)), 0, H, played.map((r, i) => [`${oppLabel(r)}, ${resLabelText(r)}`, `Pelipisteet\t${num(r.p.gs, 2)}`, `3 ottelun keskiarvo\t${num(avg[i], 2)}`, `Pisteet\t${r.p.g}+${r.p.a}`, `Laukausyritykset\t${r.p.shots}`, `Maalia kohti\t${r.p.sog ?? '–'}`, `xG\t${num(r.p.ixg, 2)}`, `Corsi\t${signed(r.p.cf - r.p.ca, 0)}`, `Peliaika\t${mmss(r.p.toi)}`].join('\n')))}
  </svg>${n > 2 ? '<p class="muted small">Musta viiva: kolmen ottelun liukuva keskiarvo.</p>' : ''}`;
}
function gsaxChart(rows) {
  const played = rows.filter(r => r.p && r.p.played);
  if (!played.length) return '';
  let c = 0;
  const pts = played.map(r => (c += r.p.gsax, { r, c }));
  const W = 760, H = 200, pad = 30, n = pts.length;
  const vals = [0, ...pts.map(p => p.c)], max = Math.max(...vals) + 0.5, min = Math.min(...vals) - 0.5;
  const y = v => pad + (max - v) / (max - min) * (H - pad * 2);
  const x = i => pad + (i + 1) * (W - pad * 2) / n;
  const line = [`${pad},${y(0)}`, ...pts.map((p, i) => `${x(i)},${y(p.c)}`)].join(' ');
  return `<svg viewBox="0 0 ${W} ${H + 24}" class="gs-chart">
    <line x1="${pad}" x2="${W - pad}" y1="${y(0)}" y2="${y(0)}" class="gc-axis"/>
    <polygon class="${c >= 0 ? 'gx-area-p' : 'gx-area-n'}" points="${pad},${y(0)} ${line} ${x(n - 1)},${y(0)}"/>
    <polyline class="gx-line" points="${line}"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.c)}" r="5" class="${p.r.p.gsax >= 0 ? 'gc-pos' : 'gc-neg'}"><title>${esc(oppLabel(p.r))}: ${signed(p.r.p.gsax, 2)} (yht. ${signed(p.c, 2)})</title></circle>
      <text x="${x(i)}" y="${H + 14}" class="gc-l">${fiDate(p.r.game.start)}</text>`).join('')}
    <text x="${x(n - 1)}" y="${y(c) - 10}" class="gc-v end">${signed(c, 2)}</text>
    ${hoverCols(pts.map((_, i) => x(i)), 0, H, pts.map(p => [`${oppLabel(p.r)}, ${resLabelText(p.r)}`, `GSAx ottelussa\t${signed(p.r.p.gsax, 2)}`, `GSAx kertymä\t${signed(p.c, 2)}`, `Torjunnat\t${p.r.p.saves}`, `Päästetyt\t${p.r.p.ga}`, `xGA\t${num(p.r.p.xga, 2)}`, `Torjunta-%\t${pct((p.r.p.saves + p.r.p.ga) ? p.r.p.saves / (p.r.p.saves + p.r.p.ga) : null, 1)}`, `Rooli\t${p.r.p.status}`, `Peliaika\t${mmss(p.r.p.toi)}`].join('\n')))}
  </svg>`;
}

/* ---------- page ---------- */
async function renderPlayer(id, box = $('#playerContent')) {
  box.innerHTML = '<p class="loading">Ladataan pelaajaa…</p>';
  try {
    if (!saipaGames.length) await initGames();
    const [rows, league] = await Promise.all([playerGames(id), loadLeagueSkaters()]);
    if (!rows.length) { box.innerHTML = '<p class="muted">Pelaajaa ei löydy SaiPan otteluista tällä kaudella.</p>'; return; }
    const bio = rows.map(r => r.roster).filter(Boolean).pop() || {};
    const isGk = posGroup(bio.roleCode) === 'G' || rows.some(r => r.p?.goalie);
    box.innerHTML = isGk ? goaliePage(id, rows, bio, league) : skaterPage(id, rows, bio, league);
    careerHtml(id, isGk, rows).then(h => { const el = box.querySelector('#careerCard'); if (el) el.innerHTML = `<h2>Ura</h2>${h}`; })
      .catch(e => { const el = box.querySelector('#careerCard'); if (el) el.innerHTML = `<h2>Ura</h2><p class="neg-num">${esc(e.message)}</p>`; });
    if (!isGk) skaterShots(id, rows, league, box);
    else loadLeagueShots().then(L => { const el = box.querySelector('#gkMap'); if (el) el.innerHTML = goalieMapsHtml(L, [{ id, first: bio.firstName, last: bio.lastName }]); })
      .catch(e => { const el = box.querySelector('#gkMap'); if (el) el.innerHTML = `<p class="neg-num">${esc(e.message)}</p>`; });
  } catch (e) {
    box.innerHTML = `<p class="neg-num">Pelaajan lataus epäonnistui: ${esc(e.message)}</p>`;
  }
}

function playerHero(bio, line, sub) {
  const age = bio.dateOfBirth ? Math.floor((Date.now() - new Date(bio.dateOfBirth)) / 3.15576e10) : null;
  const facts = [bio.roleCode && posGroup(bio.roleCode) === 'D' ? 'Puolustaja' : posGroup(bio.roleCode) === 'G' ? 'Maalivahti' : 'Hyökkääjä',
    age ? `${age} v` : '', bio.height ? `${bio.height} cm` : '', bio.weight ? `${bio.weight} kg` : '',
    bio.handedness ? 'Mailakäsi ' + bio.handedness[0] : '', bio.nationality || ''].filter(Boolean);
  return `<div class="p-hero">
    <div class="p-ph">${bio.pictureUrl ? `<img src="${esc(bio.pictureUrl)}" alt="" onerror="this.remove()">` : ''}</div>
    <div><div class="p-no">#${bio.jersey ?? ''}${bio.captain ? ' · C' : bio.alternateCaptain ? ' · A' : ''}</div>
      <h1>${esc(bio.firstName || '')} <b>${esc(bio.lastName || '')}</b></h1>
      <div class="p-facts">${facts.map(esc).join(' · ')}</div></div>
    <div class="p-line">${line}</div>
  </div>${sub || ''}`;
}
// Big header number: NHL-style abbreviation as the label, English name + Finnish explanation in the hover
const bigStat = (v, l, en, fi) => `<div class="p-big"${en ? ` data-tip="${esc(`${en}${fi ? '\n' + fi : ''}`)}"` : ''}><b>${v}</b><span>${l}</span></div>`;

function skaterPage(id, rows, bio, league) {
  const played = rows.filter(r => r.p);
  const t = played.reduce((s, r) => {
    for (const k of ['g', 'a', 'shots', 'ixg', 'toi', 'cf', 'ca', 'xgf', 'xga', 'blk', 'fow', 'fot']) s[k] += r.p[k] || 0;
    s.sog += r.p.sog || 0; s.gs += r.p.gs || 0; s.corsiOk = s.corsiOk && r.p.corsiOk !== false; return s;
  }, { g: 0, a: 0, shots: 0, ixg: 0, toi: 0, cf: 0, ca: 0, xgf: 0, xga: 0, blk: 0, fow: 0, fot: 0, sog: 0, gs: 0, corsiOk: true });
  const n = played.length;
  const me = league.sk.find(x => x.id === id);
  const group = posGroup(bio.roleCode);
  // Peers: same position, at least 3 games and 8 minutes per game
  const peers = league.sk.filter(x => x.group === group && x.gp >= 3 && x.toiAvg >= 480);
  const P = (k, low) => me ? percentile(peers.map(x => x[k]), me[k], low) : null;
  const pctRows = me ? [
    { l: 'G/60', en: 'Goals per 60', fi: 'Maalit 60 peliminuuttia kohden', name: 'maalit / 60', v: num(me.g60, 2), p: P('g60') },
    { l: 'P/60', en: 'Points per 60', fi: 'Pisteet 60 peliminuuttia kohden', name: 'pisteet / 60', v: num(me.p60, 2), p: P('p60') },
    { l: 'xG/60', en: 'Expected Goals per 60', fi: 'Omat odotetut maalit 60 peliminuuttia kohden', name: 'xG / 60', v: num(me.xg60, 2), p: P('xg60') },
    { l: 'iCF/60', en: 'Shot Attempts per 60', fi: 'Laukausyritykset 60 peliminuuttia kohden', name: 'laukausyritykset / 60', v: num(me.sh60, 1), p: P('sh60') },
    { l: 'G−xG', en: 'Goals minus Expected Goals', fi: 'Viimeistely: maalit miinus odotetut maalit', name: 'viimeistely', v: signed(me.fin, 2), p: P('fin') },
    { l: 'TOI/GP', en: 'Time on Ice per Game', fi: 'Peliaika ottelua kohden', name: 'peliaika', v: mmss(me.toiAvg), p: P('toiAvg'), use: true },
    { l: 'PP TOI/GP', en: 'Power Play Time on Ice per Game', fi: 'Ylivoima-aika ottelua kohden', name: 'ylivoima-aika', v: mmss(me.pp), p: P('pp'), use: true },
    { l: 'SH TOI/GP', en: 'Shorthanded Time on Ice per Game', fi: 'Alivoima-aika ottelua kohden', name: 'alivoima-aika', v: mmss(me.pk), p: P('pk'), use: true },
    { l: 'Max Speed', en: 'Top Skating Speed', fi: 'Kauden huippunopeus', name: 'huippunopeus', v: kmh(me.speed), p: P('speed') },
    { l: 'Max Shot', en: 'Hardest Shot', fi: 'Kauden kovin laukaus', name: 'kovin laukaus', v: kmh(me.shot), p: P('shot') },
    { l: 'DIST/GP', en: 'Skating Distance per Game', fi: 'Luistelumatka ottelua kohden', name: 'luistelumatka', v: me.dist ? num(me.dist / 1000, 2) + ' km' : '–', p: P('dist') },
    ...(me.fo != null ? [{ l: 'FO%', en: 'Faceoff Win Percentage', fi: 'Voitettujen aloitusten osuus', name: 'aloitukset', v: pct(me.fo, 0), p: percentile(peers.map(x => x.fo), me.fo) }] : []),
  ] : [];
  const xgfPct = (t.xgf + t.xga) ? t.xgf / (t.xgf + t.xga) : null, cfPct = (t.cf + t.ca) ? t.cf / (t.cf + t.ca) : null;
  // Strongest and weakest percentile for the summary line
  const ranked = pctRows.filter(r => r.p != null && !r.use).sort((a, b) => b.p - a.p);
  const lead = ranked.length >= 3 ? `Vahvin osa-alue liigan ${GROUP_GEN[group]} vertailussa: <b>${ranked[0].name || ranked[0].l}</b> (${ranked[0].p}. persentiili). Heikoin: <b>${ranked[ranked.length - 1].name || ranked[ranked.length - 1].l}</b> (${ranked[ranked.length - 1].p}.).` : '';
  return `
    ${playerHero(bio, `${bigStat(n, 'GP', 'Games Played', 'Ottelut SaiPassa')}${bigStat(`${t.g}+${t.a}`, 'G+A', 'Goals + Assists', 'Maalit + syötöt')}${bigStat(num(n ? t.gs / n : null, 2), 'GS/GP', 'Game Score per Game', 'Pelipisteet ottelua kohden')}${bigStat(mmss(n ? t.toi / n : 0), 'TOI/GP', 'Time on Ice per Game', 'Peliaika ottelua kohden')}`)}
    <div class="card"><h2>Kausi SaiPan otteluista</h2>
      <div class="p-stats">
        ${bigStat(t.shots, 'iCF', 'Individual Corsi For', 'Laukausyritykset')}${bigStat(t.sog, 'SOG', 'Shots on Goal', 'Laukaukset maalia kohti')}${bigStat(num(t.ixg, 2), 'xG', 'Expected Goals', 'Omat odotetut maalit')}
        ${bigStat(`<span class="${cls(t.g - t.ixg)}">${signed(t.g - t.ixg, 2)}</span>`, 'G−xG', 'Goals minus Expected Goals', 'Viimeistely: maalit miinus odotetut maalit')}
        ${bigStat(pct(cfPct, 0) + (t.corsiOk ? '' : '*'), 'CF%', 'Corsi For Percentage', 'Oman joukkueen osuus tasakentin laukausyrityksistä pelaajan ollessa jäällä')}${bigStat(pct(xgfPct, 0), 'xGF%', 'Expected Goals For Percentage', 'Oman joukkueen osuus maaliodottamasta pelaajan ollessa jäällä')}
        ${bigStat(t.blk, 'BLK', 'Blocked Shots', 'Blokatut laukaukset')}${t.fot ? bigStat(pct(t.fow / t.fot, 0), 'FO%', 'Faceoff Win Percentage', `Voitetut aloitukset ${t.fow}/${t.fot}`) : ''}
      </div>
      ${t.corsiOk ? '' : '<p class="muted small">* Corsi-data on osasta otteluita puutteellista.</p>'}
    </div>
    <div class="card"><h2>Pelipisteet ottelu kerrallaan</h2>${gsChart(rows)}</div>
    <div class="card"><h2><span class="tag">Liigavertailu</span></h2>
      ${me ? `<p class="muted">Persentiili vertaa pelaajaa liigan kaikkiin ${GROUP_ILL[group]}, joilla on vähintään 3 ottelua ja 8 minuuttia peliaikaa ottelussa (${peers.length} pelaajaa). 100 = liigan paras, 50 = keskitaso.</p>
      ${lead ? `<p class="lead">${lead}</p>` : ''}${pctBars(pctRows)}
      <p class="muted small">Lähde: liiga.fi:n kausitilastot (${me.gpBasic} ottelua). Liigan tilastot voivat olla ottelun verran jäljessä. Kentällä olon xG-osuutta ei ole Liigan kausitilastoissa, joten sitä ei vertailla.</p>`
      : '<p class="muted">Pelaaja ei ole vielä Liigan kausitilastoissa.</p>'}
    </div>
    <div class="card" id="pShots"><h2>Laukauskartta</h2><p class="loading">Haetaan laukauksia…</p></div>
    <div class="card" id="careerCard"><h2>Ura</h2><p class="loading">Haetaan uraa…</p></div>
    <div class="card"><h2>Ottelut</h2><div class="tablewrap"><table class="mini glog">
      <tr><th>Ottelu</th><th>Tulos</th><th data-tip="Goals\nMaalit">G</th><th data-tip="Assists\nSyötöt">A</th><th data-tip="Individual Corsi For\nLaukausyritykset">iCF</th><th data-tip="Shots on Goal\nLaukaukset maalia kohti">SOG</th><th data-tip="Expected Goals\nMaaliodottama">xG</th><th data-tip="Corsi Differential\nTasakentin omat miinus vastustajan laukausyritykset">C+/-</th><th data-tip="Time on Ice\nPeliaika">TOI</th><th data-tip="Game Score\nPelipisteet">GS</th></tr>
      ${[...rows].reverse().map(r => r.p ? `<tr><td><a href="?game=${r.game.id}&tab=report">${esc(oppLabel(r))}</a></td><td>${resLabel(r)}</td><td>${r.p.g}</td><td>${r.p.a}</td><td>${r.p.shots}</td><td>${r.p.sog ?? '–'}</td><td>${num(r.p.ixg, 2)}</td>
        <td><span class="${cls(r.p.cf - r.p.ca)}">${signed(r.p.cf - r.p.ca, 0)}</span>${r.p.corsiOk === false ? '*' : ''}</td><td>${mmss(r.p.toi)}</td><td><b>${num(r.p.gs, 2)}</b></td></tr>`
        : `<tr class="idle"><td><a href="?game=${r.game.id}&tab=report">${esc(oppLabel(r))}</a></td><td>${resLabel(r)}</td><td colspan="8" class="muted">Ei kokoonpanossa</td></tr>`).join('')}
    </table></div></div>`;
}

// SM-2: the player's attempts from SaiPa games, plus a league comparison of slot share among peers
function skaterShots(id, rows, league, box) {
  const el = () => box.querySelector('#pShots');
  const mine = rows.flatMap(r => (r.raw.ctx.sm || []).filter(s => s.shooterId === id)).map(normShot);
  const missing = rows.filter(r => r.p && !(r.raw.ctx.sm || []).length).length;
  loadLeagueShots().then(L => {
    const group = new Map(league.sk.map(x => [x.id, x.group]));
    const me = league.sk.find(x => x.id === id);
    const g = me ? me.group : 'F';
    const per = new Map();
    for (const sm of L.shots.values()) for (const s of sm) {
      if (group.get(s.shooterId) !== g) continue;
      const o = per.get(s.shooterId) || per.set(s.shooterId, { n: 0, slot: 0 }).get(s.shooterId);
      o.n++; if (normShot(s).zone === 'slot') o.slot++;
    }
    const shares = [...per.entries()].filter(([, o]) => o.n >= 15).map(([pid, o]) => ({ pid, v: o.slot / o.n }));
    const myShare = mine.length ? mine.filter(s => s.zone === 'slot').length / mine.length : null;
    const p = mine.length >= 15 ? percentile(shares.map(x => x.v), myShare) : null;
    const z = k => mine.filter(s => s.zone === k);
    const html = mine.length ? `
      <div class="pf-grid">
        <div>${zoneHeat(mine, 'sai')}${mapLegend()}</div>
        <div>
          ${p != null ? `<p class="lead"><b>${pct(myShare, 0)}</b> yrityksistä tulee maalin edestä. Liigan ${GROUP_ELA[g]} (vähintään 15 yritystä) se on <b>${p}. persentiili</b>.</p>` : ''}
          <table class="mini"><tr><th>Alue</th><th data-tip="Individual Corsi For\nLaukausyritykset">iCF</th><th data-tip="Shots on Goal\nLaukaukset maalia kohti">SOG</th><th data-tip="Goals\nMaalit">G</th><th data-tip="Shooting Percentage\nMaalit / laukaukset maalia kohti">SH%</th></tr>
          ${ZONES.map(k => { const a = z(k.k); if (!a.length) return ''; const sog = a.filter(s => s.sog).length, gl = a.filter(s => s.goal).length;
            return `<tr><td title="${esc(k.d)}">${k.l}</td><td>${a.length}</td><td>${sog}</td><td><b>${gl}</b></td><td>${pct(sog ? gl / sog : null, 0)}</td></tr>`; }).join('')}
          <tr><td><b>Yhteensä</b></td><td>${mine.length}</td><td>${mine.filter(s => s.sog).length}</td><td><b>${mine.filter(s => s.goal).length}</b></td><td></td></tr></table>
          <p class="muted small">Mukana SaiPan ottelut, joista Liigalla on laukauskartta.${missing ? ` Kartta puuttuu ${missing} pelaajan ottelusta.` : ''} SH% = maalit / laukaukset maalia kohti.</p>
        </div>
      </div>` : '<p class="muted">Ei laukausyrityksiä laukauskartoissa.</p>';
    if (el()) el().innerHTML = `<h2>Laukauskartta</h2>${html}`;
  }).catch(e => { if (el()) el().innerHTML = `<h2>Laukauskartta</h2><p class="neg-num">${esc(e.message)}</p>`; });
}

function goaliePage(id, rows, bio, league) {
  const played = rows.filter(r => r.p && r.p.played);
  const t = played.reduce((s, r) => { s.saves += r.p.saves; s.ga += r.p.ga; s.xga += r.p.xga; s.toi += r.p.toi; return s; }, { saves: 0, ga: 0, xga: 0, toi: 0 });
  const sv = (t.saves + t.ga) ? t.saves / (t.saves + t.ga) : null, gsax = t.xga - t.ga;
  const starts = played.filter(r => r.p.mvNo === 1).length;
  const me = league.gks.find(x => x.id === id);
  const peers = league.gks.filter(x => x.gp >= 3);
  const P = (k, low) => me ? percentile(peers.map(x => x[k]), me[k], low) : null;
  const rank = me ? [...peers].sort((a, b) => b.gsax - a.gsax).findIndex(x => x.id === id) + 1 : 0;
  // Save profile by period, from per-period analysis of each game
  const per = {};
  for (const r of played) for (const n of [1, 2, 3, 4]) {
    const a = analyzeGame(r.raw.g, r.raw.st, n, r.raw.ctx).goalies.find(x => x.id === id && x.played);
    if (!a) continue;
    const o = per[n] = per[n] || { n, gp: 0, saves: 0, ga: 0, xga: 0 };
    o.gp++; o.saves += a.saves; o.ga += a.ga; o.xga += a.xga;
  }
  return `
    ${playerHero(bio, `${bigStat(played.length, 'GP', 'Games Played', `Ottelut, joista ${starts} aloittajana`)}${bigStat(pct(sv, 1), 'SV%', 'Save Percentage', 'Torjuntaprosentti')}${bigStat(`<span class="${cls(gsax)}">${signed(gsax, 2)}</span>`, 'GSAx', 'Goals Saved Above Expected', 'Odotettua enemmän torjutut maalit')}${bigStat(num(t.toi ? t.ga / t.toi * 3600 : null, 2), 'GAA', 'Goals Against Average', 'Päästetyt maalit 60 peliminuuttia kohden')}`)}
    <div class="card"><h2>GSAx kauden mittaan</h2>
      <p class="muted">Torjutut maalit yli odotusten, kertymä ottelu ottelulta. Nouseva käyrä = maalivahti torjuu enemmän kuin laukausten laatu antaisi odottaa.</p>${gsaxChart(rows)}</div>
    <div class="card"><h2><span class="tag">Liigavertailu</span></h2>
      ${me ? `<p class="lead">GSAx ${signed(me.gsax, 2)} on liigan <b>${rank}.</b> paras ${peers.length} maalivahdin joukossa (vähintään 3 ottelua).</p>
      ${pctBars([
        { l: 'GSAx', en: 'Goals Saved Above Expected', fi: 'Odotettua enemmän torjutut maalit', name: 'GSAx', v: signed(me.gsax, 2), p: P('gsax') },
        { l: 'GSAx/60', en: 'Goals Saved Above Expected per 60', fi: 'GSAx 60 peliminuuttia kohden', name: 'GSAx / 60', v: signed(me.gsax60, 2), p: P('gsax60') },
        { l: 'SV%', en: 'Save Percentage', fi: 'Torjuntaprosentti', name: 'torjuntaprosentti', v: pct(me.sv, 1), p: P('sv') },
        { l: 'GAA', en: 'Goals Against Average', fi: 'Päästetyt maalit 60 peliminuuttia kohden', name: 'päästetyt / 60', v: num(me.gaa, 2), p: P('gaa', true) },
        { l: 'SA', en: 'Shots Against', fi: 'Laukaukset maalia kohti häntä vastaan', name: 'laukauksia vastaan', v: me.shots, p: P('shots'), use: true },
      ])}
      <p class="muted small">Lähde: liiga.fi:n kausitilastot (${me.gp} ottelua). Persentiili 100 = liigan paras.</p>` : '<p class="muted">Maalivahti ei ole vielä Liigan kausitilastoissa.</p>'}
    </div>
    <div class="card"><h2>Erä erältä</h2><div class="tablewrap"><table class="mini">
      <tr><th></th><th data-tip="Games Played\nOttelut">GP</th><th data-tip="Saves\nTorjunnat">SV</th><th data-tip="Goals Against\nPäästetyt maalit">GA</th><th data-tip="Save Percentage\nTorjuntaprosentti">SV%</th><th data-tip="Expected Goals Against\nPäästetty maaliodottama">xGA</th><th data-tip="Goals Saved Above Expected\nxGA − päästetyt maalit">GSAx</th></tr>
      ${Object.values(per).map(o => `<tr><td><b>${PERIOD_LABEL(o.n)}</b></td><td>${o.gp}</td><td>${o.saves}</td><td>${o.ga}</td><td>${pct((o.saves + o.ga) ? o.saves / (o.saves + o.ga) : null, 1)}</td><td>${num(o.xga, 2)}</td><td><span class="${cls(o.xga - o.ga)}">${signed(o.xga - o.ga, 2)}</span></td></tr>`).join('')}
    </table></div></div>
    <div class="card"><h2>Mistä maalit tulevat</h2><div id="gkMap"><p class="loading">Haetaan laukauskarttoja…</p></div></div>
    <div class="card" id="careerCard"><h2>Ura</h2><p class="loading">Haetaan uraa…</p></div>
    <div class="card"><h2>Ottelut</h2><div class="tablewrap"><table class="mini glog">
      <tr><th>Ottelu</th><th>Tulos</th><th>Rooli</th><th data-tip="Time on Ice\nPeliaika">TOI</th><th data-tip="Saves\nTorjunnat">SV</th><th data-tip="Goals Against\nPäästetyt maalit">GA</th><th data-tip="Save Percentage\nTorjuntaprosentti">SV%</th><th data-tip="Expected Goals Against\nPäästetty maaliodottama">xGA</th><th data-tip="Goals Saved Above Expected\nxGA − päästetyt maalit">GSAx</th></tr>
      ${[...rows].reverse().map(r => r.p && r.p.played ? `<tr><td><a href="?game=${r.game.id}&tab=report">${esc(oppLabel(r))}</a></td><td>${resLabel(r)}</td><td>${r.p.status}</td><td>${mmss(r.p.toi)}</td><td>${r.p.saves}</td><td>${r.p.ga}</td>
        <td>${pct((r.p.saves + r.p.ga) ? r.p.saves / (r.p.saves + r.p.ga) : null, 1)}</td><td>${num(r.p.xga, 2)}</td><td><span class="${cls(r.p.gsax)}">${signed(r.p.gsax, 2)}</span></td></tr>`
        : `<tr class="idle"><td><a href="?game=${r.game.id}&tab=report">${esc(oppLabel(r))}</a></td><td>${resLabel(r)}</td><td colspan="7" class="muted">${r.roster?.line ? 'Varalla' : 'Ei kokoonpanossa'}</td></tr>`).join('')}
    </table></div></div>`;
}

/* ---------- navigation ---------- */
function openPlayer(id, push = true) {
  if (push) history.pushState({ player: id }, '', `?player=${id}`);
  show('pelaaja');
  window.scrollTo(0, 0);
  renderPlayer(Number(id));
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-pid]');
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  openPlayer(a.dataset.pid);
});
