/* SaiPa Data: game report extras (deserved result, game flow, goal list).
 * Uses helpers from app.js (esc, num, signed, mmss, validGoal, SAIPA_NUM, isSaipa). */

const GOAL_TYPE_LABEL = { YV: 'YV', YV2: 'YV2', AV: 'AV', AV2: 'AV2', TM: 'TM', RL: 'RL' };
// Home team first in every score shown in the game report (the scoreboard order)
const hf = (home, s, o) => home ? [s, o] : [o, s];
const clock = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const inPeriod = t => t < 3600 ? `${Math.floor(t / 1200) + 1}. erä ${clock(t % 1200)}` : `JA ${clock(t - 3600)}`;
const span = (a, b) => Math.floor(a / 1200) === Math.floor(b / 1200) || (b % 1200 === 0 && b - a <= 1200 && Math.floor(a / 1200) === b / 1200 - 1)
  ? `${inPeriod(a)}–${clock(b % 1200 || 1200)}` : `${inPeriod(a)} – ${inPeriod(b)}`;

// Collect everything the extras need from the raw game data
function reportData(g, st, sm) {
  const F = focusNum(g), home = teamNum(g.game.homeTeam.teamId) === F;
  const S = home ? g.game.homeTeam : g.game.awayTeam, O = home ? g.game.awayTeam : g.game.homeTeam;
  const names = new Map([...(g.homeTeamPlayers || []), ...(g.awayTeamPlayers || [])].map(p => [p.id, `${p.firstName} ${p.lastName}`]));
  const goals = [];
  for (const [team, mine] of [[S, true], [O, false]]) for (const e of team.goalEvents || []) {
    if ((e.period || 0) > 4) continue;  // shootout goals are not game goals
    goals.push({ mine, t: e.gameTime, period: e.period, valid: !(e.goalTypes || []).includes('VT0'), types: (e.goalTypes || []).filter(x => !x.startsWith('VT')),
      scorer: e.scorerPlayer ? `${e.scorerPlayer.firstName} ${e.scorerPlayer.lastName}` : names.get(e.scorerPlayerId) || '?',
      assists: (e.assistantPlayers || []).map(a => `${a.firstName} ${a.lastName}`), winning: e.winningGoal });
  }
  goals.sort((a, b) => a.t - b.t);
  let s = 0, o = 0;
  for (const x of goals) if (x.valid) { if (x.mine) s++; else o++; x.score = hf(home, s, o).join('–'); }
  const penalties = [];
  for (const [team, mine] of [[S, true], [O, false]]) for (const p of team.penaltyEvents || []) {
    // A stacked penalty (e.g. 2+2) is called at gameTime but starts serving at penaltyBegintime
    const begin = p.penaltyBegintime ?? p.gameTime;
    penalties.push({ mine, called: p.gameTime, t: begin, end: p.penaltyEndtime || begin + (p.penaltyMinutes || 0) * 60, min: p.penaltyMinutes, name: p.penaltyFaultName, player: names.get(p.playerId) || '' });
  }
  const shots = (sm || []).map(x => ({ mine: x.shootingTeamId === F, t: x.gameTime, type: x.eventType }));
  const end = Math.max(3600, g.game.gameTime || 0, ...goals.map(x => x.t));
  const so = g.game.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION';
  // Score excluding the shootout-deciding goal
  const gf = goals.filter(x => x.valid && x.mine).length, ga = goals.filter(x => x.valid && !x.mine).length;
  // now: game time of a game in progress (null when finished), used to stop the timeline at the present moment
  const now = g.game.ended || !g.game.started ? null : (g.game.gameTime || 0);
  return { home, F, sName: S.teamName, S, O, goals, penalties, shots, end, now, so, gf, ga, xgf: S.expectedGoals, xga: O.expectedGoals,
    ppGF: goals.filter(x => x.valid && x.mine && x.types.some(t => t.startsWith('YV'))).length,
    ppGA: goals.filter(x => x.valid && !x.mine && x.types.some(t => t.startsWith('YV'))).length,
    shGF: goals.filter(x => x.valid && x.mine && x.types.some(t => t.startsWith('AV'))).length,
    shGA: goals.filter(x => x.valid && !x.mine && x.types.some(t => t.startsWith('AV'))).length,
    enGF: goals.filter(x => x.valid && x.mine && x.types.includes('TM')).length,
    enGA: goals.filter(x => x.valid && !x.mine && x.types.includes('TM')).length };
}

// Strongest 5-minute stretch for each team by shot attempts (needs the shot map)
function momentum(d) {
  if (!d.shots.length) return null;
  const W = 300, best = { mine: null, opp: null };
  for (let a = 0; a + W <= Math.min(d.end, 3600); a += 30) {
    const s = d.shots.filter(x => x.t >= a && x.t < a + W);
    const m = s.filter(x => x.mine).length, o = s.length - m;
    if (!best.mine || m - o > best.mine.m - best.mine.o) best.mine = { a, m, o };
    if (!best.opp || o - m > best.opp.o - best.opp.m) best.opp = { a, m, o };
  }
  return best;
}

function deservedHtml(d, gkSai, oppName) {
  if (d.xgf == null || d.xga == null) return '';
  const fin = d.gf - d.xgf, gk = d.xga - d.ga;
  const pair = (s, o) => hf(d.home, s, o).join('–');
  const part = (label, v, sub) => `<div class="dr-part"><div class="k">${label}</div><div class="dr-v ${cls(v)}">${signed(v, 2)}</div><div class="muted small">${sub}</div></div>`;
  const special = [];
  if (d.ppGF || d.ppGA) special.push(`YV-maalit ${pair(d.ppGF, d.ppGA)}`);
  if (d.shGF || d.shGA) special.push(`AV-maalit ${pair(d.shGF, d.shGA)}`);
  if (d.enGF || d.enGA) special.push(`tyhjiin ${pair(d.enGF, d.enGA)}`);
  const teams = esc(hf(d.home, d.sName, oppName).join('–'));
  return `<div class="card live-hide">
    <h2><span class="tag">Tulos vs. maalipaikat</span></h2>
    <div class="dr">
      <div class="dr-score"><div class="k">Maalit</div><div class="dr-big">${pair(d.gf, d.ga)}</div><div class="muted small">${teams}${d.so ? ' · ilman voittolaukausta' : ''}</div></div>
      <div class="dr-score"><div class="k">Odotetut maalit</div><div class="dr-big">${pair(num(d.xgf, 2), num(d.xga, 2))}</div><div class="muted small">${teams}</div></div>
      ${part(`${gen(d.sName)} viimeistely`, fin, `maalit − xG · ${d.gf} maalia, xG ${num(d.xgf, 2)}`)}
      ${part(`${gen(d.sName)} maalivahti`, gk, `xGA − päästetyt · ${d.ga} päästettyä${gkSai ? ' · ' + esc(gkSai) : ''}`)}
    </div>
    ${special.length ? `<p class="muted small">${special.join(' · ')}</p>` : ''}
  </div>`;
}

// Period by period, home team on the left: big number = goals, small = xG. Hover adds attempts and puck control.
function periodVsGame(rows, saiName, oppName, home, gameXg) {
  if (!rows.length) return '<p class="muted">Erädataa ei saatavilla.</p>';
  const tot = rows.reduce((t, r) => ({ sg: t.sg + r.sg, og: t.og + r.og, sxg: t.sxg + r.sxg, oxg: t.oxg + r.oxg, ssh: t.ssh + r.ssh, osh: t.osh + r.osh, spk: t.spk + (r.spk || 0), opk: t.opk + (r.opk || 0) }), { sg: 0, og: 0, sxg: 0, oxg: 0, ssh: 0, osh: 0, spk: 0, opk: 0 });
  // The total uses the game's official xG so it matches the scoreboard (period sums can differ by rounding)
  if (gameXg?.sxg != null && gameXg?.oxg != null) Object.assign(tot, gameXg);
  const names = hf(home, saiName, oppName).join(' – ');
  // Fenwick (unblocked attempts) and even-strength PDO from the shot map
  const sm = typeof GAME_SM !== 'undefined' ? GAME_SM : [];
  const extra = n => {
    const x = sm.filter(q => n == null || q.period === n);
    if (!x.length) return [];
    const mine = q => q.shootingTeamId === GAME_FOCUS;
    const fen = m => x.filter(q => mine(q) === m && q.eventType !== 'PLAYER_BLOCKED').length;
    const ev = x.filter(q => q.type === 'EvenStrengthShot' && isSog(q));
    const sh = m => { const t = ev.filter(q => mine(q) === m); return t.length ? t.filter(q => q.eventType === 'GOAL').length / t.length : null; };
    const ss = sh(true), os = sh(false);
    const pdo = ss != null && os != null ? (ss + 1 - os) * 100 : null;
    return [`Fenwick\t${hf(home, fen(true), fen(false)).join('–')}`, ...(pdo != null ? [`PDO tasakentin (${saiName})\t${num(pdo, 1)}`] : [])];
  };
  const line = (label, r) => {
    const tip = [`${label}\t${names}`, `Maalit\t${hf(home, r.sg, r.og).join('–')}`, `xG\t${hf(home, num(r.sxg, 2), num(r.oxg, 2)).join('–')}`,
      `Laukausyritykset\t${hf(home, r.ssh, r.osh).join('–')}`, ...extra(r.n), ...(r.spk != null && (r.spk + r.opk) > 0 ? [`Kiekonhallinta\t${hf(home, mmss(r.spk), mmss(r.opk)).join('–')}`] : [])].join('\n');
    return vsRow(label, r.sg, r.og, `xG ${num(r.sxg, 2)}`, `xG ${num(r.oxg, 2)}`, r.sg > r.og ? 'a' : r.og > r.sg ? 'b' : '', tip);
  };
  return `${vsHead({ name: saiName }, { name: oppName })}<div class="vs per-vs">${rows.map(r => line(PERIOD_LABEL(r.n), r)).join('')}${line('Yhteensä', tot)}</div>
`;
}

function flowHtml(d, oppName) {
  // Penalties are drawn in lanes so that overlapping penalties (5 vs 3, 2+2) are all visible
  const lanes = mine => {
    const out = [], ends = [];
    for (const p of d.penalties.filter(q => q.mine === mine).sort((a, b) => a.t - b.t)) {
      let k = ends.findIndex(e => e <= p.t);
      if (k === -1) { k = ends.length; ends.push(0); }
      ends[k] = p.end; out.push({ ...p, lane: k });
    }
    return { list: out, n: Math.max(1, ends.length) };
  };
  const LS = lanes(true), LO = lanes(false), LH = 9;
  const Wd = 1000, H0 = 248, m = { l: 40, r: 96, t: 34, b: 18 + (LS.n + LO.n) * LH + 16 };
  const H = H0 + m.b;
  const end = d.end;
  const x = t => m.l + (t / end) * (Wd - m.l - m.r);
  const hasShots = d.shots.length > 0;
  // Cumulative attempts as step lines
  const steps = mine => {
    const ts = d.shots.filter(s => s.mine === mine).map(s => s.t).sort((a, b) => a - b);
    return ts;
  };
  const sT = steps(true), oT = steps(false);
  const maxN = Math.max(1, sT.length, oT.length);
  const y = n => H - m.b - (n / maxN) * (H - m.t - m.b);
  const live = d.now != null && d.now < end, tEnd = live ? d.now : end, xe = x(tEnd);
  const path = ts => { let p = `M${x(0)},${y(0)}`; ts.forEach((t, i) => { p += ` H${x(t)} V${y(i + 1)}`; }); return p + ` H${xe}`; };
  // Live: a "now" line, and the rest of the game shaded as not yet played
  const nowMark = live ? `<rect x="${xe}" y="${m.t - 10}" width="${x(end) - xe}" height="${H - m.b - m.t + 10}" fill="#f4f4f1"/>
    <line x1="${xe}" x2="${xe}" y1="${m.t - 22}" y2="${H - m.b}" stroke="#e53935" stroke-width="2"/>
    <text x="${xe}" y="${m.t - 26}" font-size="11" font-weight="700" text-anchor="middle" fill="#e53935">NYT ${esc(inPeriod(d.now))}</text>` : '';
  const periodLines = [1200, 2400, 3600].filter(t => t < end).map(t => `<line x1="${x(t)}" x2="${x(t)}" y1="${m.t - 10}" y2="${H - m.b}" stroke="#d6d6d0" stroke-dasharray="3 3"/>`).join('');
  const periodLabels = [[0, '1. erä'], [1200, '2. erä'], [2400, '3. erä'], [3600, 'JA']].filter(([t]) => t < end).map(([t, l]) => `<text x="${x(t) + 4}" y="${m.t - 16}" font-size="11" fill="#6b6b6b">${l}</text>`).join('');
  const goalMarks = d.goals.map(g => {
    const cx = x(g.t), col = g.mine ? 'var(--yellow)' : '#6f6f6a';
    const stroke = g.valid ? '#111' : '#c0392b';
    return `<g><line x1="${cx}" x2="${cx}" y1="${m.t - 6}" y2="${H - m.b}" stroke="${g.valid ? col : '#c0392b'}" stroke-width="${g.valid ? 2 : 1}" ${g.valid ? '' : 'stroke-dasharray="2 2"'} opacity=".8"/>
      <circle cx="${cx}" cy="${m.t - 6}" r="7" fill="${g.valid ? col : '#fff'}" stroke="${stroke}" stroke-width="1.5" data-tip="${esc([`${g.valid ? `Maali ${g.score}${g.types.length ? ` (${g.types.join(', ')})` : ''}` : 'Hylätty maali'} · ${g.mine ? d.sName : oppName} · ${inPeriod(g.t)}`, ...(g.valid ? [`Tekijä\t${g.scorer}`, `Syöttäjät\t${g.assists.length ? g.assists.join(', ') : 'ei syöttäjiä'}`] : [])].join('\n'))}"/></g>`;
  }).join('');
  const penRow = (L, mine, y0) => L.list.map(p => {
    const tip = [`${esc(p.player)}`, `Rike\t${esc(p.name)}`, `Rangaistus\t${p.min} min`, `Tuomittu\t${inPeriod(p.called)}`, ...(p.t > p.called ? [`Alkoi\t${inPeriod(p.t)}`] : []), `Päättyi\t${(t => t > 0 && t % 1200 === 0 && t <= 3600 ? `${t / 1200}. erä 20:00` : inPeriod(t))(Math.min(p.end, end))}`, ].join('\n');
    const yy = y0 + p.lane * LH;
    return `<g data-tip="${tip}">${p.t > p.called ? `<line x1="${x(p.called)}" x2="${x(p.t)}" y1="${yy + 3.5}" y2="${yy + 3.5}" stroke="${mine ? '#e0a800' : '#9a9a94'}" stroke-dasharray="2 2"/>` : ''}<rect x="${x(p.t)}" y="${yy}" width="${Math.max(3, x(Math.min(p.end, tEnd)) - x(p.t))}" height="7" rx="2" fill="${mine ? '#e0a800' : '#9a9a94'}" stroke="#fff" stroke-width="1"/></g>`;
  }).join('');
  // Penalty lanes: home team on top
  const top = d.home ? LS : LO, bot = d.home ? LO : LS;
  const yT = H - m.b + 10, yB = yT + top.n * LH + 6;
  const yS = d.home ? yT : yB, yO = d.home ? yB : yT;
  const abbr = n => esc(n.slice(0, 3).toUpperCase());
  const mo = momentum(d);
  const moChips = mo ? [
    mo.mine && mo.mine.m - mo.mine.o >= 3 ? { cls: 'mine', k: `Kovin painostus (${d.sName})`, v: span(mo.mine.a, mo.mine.a + 300), s: `Laukausyritykset ${hf(d.home, mo.mine.m, mo.mine.o).join('–')}` } : null,
    mo.opp && mo.opp.o - mo.opp.m >= 3 ? { cls: 'opp', k: `Kovin painostus (${esc(oppName)})`, v: span(mo.opp.a, mo.opp.a + 300), s: `Laukausyritykset ${hf(d.home, mo.opp.m, mo.opp.o).join('–')}` } : null,
  ].filter(Boolean) : [];
  const band = mo?.mine && mo.mine.m - mo.mine.o >= 3 ? `<rect x="${x(mo.mine.a)}" y="${m.t}" width="${x(mo.mine.a + 300) - x(mo.mine.a)}" height="${H - m.t - m.b}" fill="var(--yellow)" opacity=".12"/>` : '';
  const band2 = mo?.opp && mo.opp.o - mo.opp.m >= 3 ? `<rect x="${x(mo.opp.a)}" y="${m.t}" width="${x(mo.opp.a + 300) - x(mo.opp.a)}" height="${H - m.t - m.b}" fill="#6f6f6a" opacity=".10"/>` : '';
  return `<div class="card">
    <h2>Ottelun virta</h2>
    ${hasShots ? '' : '<p class="muted small">Laukauskartta puuttuu, joten laukausyrityksiä ei ole aikajanalla.</p>'}
    <div class="flow-wrap"><svg class="flow" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Ottelun virta">
      ${nowMark}${band}${band2}${periodLines}${periodLabels}
      ${hasShots ? `<path d="${path(oT)}" fill="none" stroke="#6f6f6a" stroke-width="2.5"/><path d="${path(sT)}" fill="none" stroke="#e0b400" stroke-width="3"/>
      <text x="${xe + 6}" y="${y(sT.length) + (sT.length >= oT.length ? -2 : 12)}" font-size="12" font-weight="700" fill="#8a6d00">${esc(d.sName)} ${sT.length}</text>
      <text x="${xe + 6}" y="${y(oT.length) + (oT.length > sT.length ? -2 : 12)}" font-size="12" font-weight="700" fill="#555">${esc(oppName)} ${oT.length}</text>` : ''}
      ${goalMarks}
      ${penRow(LS, true, yS)}${penRow(LO, false, yO)}
      <text x="${m.l - 6}" y="${yS + 7}" font-size="10" text-anchor="end" fill="#6b6b6b">SAI</text>
      <text x="${m.l - 6}" y="${yO + 7}" font-size="10" text-anchor="end" fill="#6b6b6b">${abbr(oppName)}</text>
    </svg></div>
    <div class="legend">${hf(d.home, `<span><i style="background:#e0b400"></i>${esc(d.sName)}</span>`, `<span><i style="background:#6f6f6a"></i>${esc(oppName)}</span>`).join('')}<span class="muted">viiva = laukausyritykset · ● maali · ○ hylätty · palkit = jäähyt</span></div>
    ${moChips.length ? `<div class="flow-mo">${(d.home ? moChips : [...moChips].reverse()).map(c => `<div class="fm ${c.cls}"><div class="k">${c.k}</div><div class="v">${c.v}</div><div class="s">${c.s}</div></div>`).join('')}</div>` : ''}
  </div>`;
}

function goalsHtml(d, gameId, season) {
  if (!d.goals.length) return '';
  const rows = d.goals.map(g => `<div class="gl ${g.mine ? 'mine' : ''} ${g.valid ? '' : 'void'}">
      <div class="gl-t">${inPeriod(g.t)}</div>
      <div class="gl-s">${g.valid ? g.score : '–'}</div>
      <div class="gl-p"><b>${g.valid || g.scorer !== '?' ? esc(g.scorer) : (g.mine ? d.sName : 'Vastustaja')}</b>${g.assists.length ? ` <span class="muted">(${g.assists.map(esc).join(', ')})</span>` : ''}
        ${g.types.map(t => `<span class="badge">${esc(GOAL_TYPE_LABEL[t] || t)}</span>`).join(' ')}
        ${g.valid ? '' : '<span class="badge b-luck">Hylätty videotarkistuksessa</span>'}${g.winning && g.valid ? '<span class="badge b-fire">Voittomaali</span>' : ''}</div>
    </div>`).join('');
  return `<div class="card live-hide">
    <h2>Maalit</h2>
    <div class="goals">${rows}</div>
    <p class="small"><a href="https://liiga.fi/fi/peli/${season}/${gameId}/seuranta" target="_blank" rel="noopener">Maalivideot liiga.fi:ssä ↗</a></p>
  </div>`;
}
