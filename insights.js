/* SaiPa Data: season insights (M7): lines and pairs (LN-1), league speed and shot lists (PL-5),
 * season trend (SE-3) and streaks (PL-3). Uses helpers from app.js, shots.js, preview.js and player.js. */

/* ---------- LN-1: lines and pairs from goal events ---------- */
// The only exact on-ice data in the API: every goal lists the jersey numbers of the skaters on ice
// (plusPlayerIds for the scoring team, minusPlayerIds for the conceding team). Shots carry only a player count.
// So every figure here is exact: a unit is counted only when ALL its players were on ice for the goal.
const FWD = ['VL', 'KH', 'OL'], DEF = ['VP', 'OP'];
const jerseys = s => String(s || '').split(/\s+/).filter(Boolean).map(Number);
const isEvGoal = e => !(e.goalTypes || []).some(t => /^(YV|AV)/.test(t));
const goalSit = e => (e.goalTypes || []).some(t => /^YV/.test(t)) ? 'pp' : (e.goalTypes || []).some(t => /^AV/.test(t)) ? 'sh' : 'ev';

function lineStats(raws) {
  const units = new Map(), fives = new Map(), duos = new Map(), names = new Map();
  const key = ids => [...ids].sort((a, b) => a - b).join('-');
  const unit = (kind, ids) => { const k = kind + ':' + key(ids); return units.get(k) || units.set(k, { key: k, kind, ids, gp: 0, lines: new Set(), ev: [0, 0], pp: [0, 0], sh: [0, 0], own: 0, all: 0 }).get(k); };
  let goals = 0, missing = 0;
  for (const { g } of raws) {
    const home = isSaipa(g.game.homeTeam.teamId);
    const roster = (home ? g.homeTeamPlayers : g.awayTeamPlayers) || [];
    const byJersey = new Map(roster.filter(p => p.line != null).map(p => [p.jersey, p]));
    for (const p of roster) names.set(p.id, p.lastName);
    const listed = [];
    for (const n of [1, 2, 3, 4]) {
      const f = FWD.map(r => roster.find(p => p.line === n && p.roleCode === r)).filter(Boolean);
      const d = DEF.map(r => roster.find(p => p.line === n && p.roleCode === r)).filter(Boolean);
      if (f.length === 3) { const u = unit('F', f.map(p => p.id)); u.gp++; u.lines.add(n); listed.push(u); }
      if (d.length === 2) { const u = unit('D', d.map(p => p.id)); u.gp++; u.lines.add(n); listed.push(u); }
    }
    const mine = home ? g.game.homeTeam : g.game.awayTeam, opp = home ? g.game.awayTeam : g.game.homeTeam;
    for (const [team, scored] of [[mine, true], [opp, false]]) for (const e of team.goalEvents || []) {
      if (!validGoal(e)) continue;
      const sk = jerseys(scored ? e.plusPlayerIds : e.minusPlayerIds).map(j => byJersey.get(j)).filter(p => p && p.roleCode !== 'MV');
      if (!sk.length) { missing++; continue; }
      goals++;
      // From SaiPa's side: a power-play goal by the opponent is a SaiPa penalty-kill goal against, and vice versa
      const sit0 = goalSit(e), sit = scored ? sit0 : sit0 === 'pp' ? 'sh' : sit0 === 'sh' ? 'pp' : 'ev';
      const on = new Set(sk.map(p => p.id));
      const pointIds = scored ? [e.scorerPlayerId, ...(e.assistantPlayerIds || [])] : [];
      for (const u of listed) {
        if (sit !== 'ev' || !u.ids.every(id => on.has(id))) continue;
        u[sit][scored ? 0 : 1]++;
        if (scored && u.ids.includes(e.scorerPlayerId)) u.own++;
        if (scored && pointIds.filter(id => u.ids.includes(id)).length >= Math.min(3, u.ids.length)) u.all++;
      }
      // Five-man units (exactly the skaters on ice) at even strength, and pairs of any two skaters
      if (sit === 'ev' && sk.length === 5) {
        const k = key(on), f = fives.get(k) || fives.set(k, { ids: [...on], gf: 0, ga: 0 }).get(k);
        if (scored) f.gf++; else f.ga++;
      }
      if (sit !== 'ev') continue;
      const ids = [...on];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = Math.min(ids[i], ids[j]), b = Math.max(ids[i], ids[j]), k = a + '-' + b;
        const d = duos.get(k) || duos.set(k, { a, b, gf: 0, ga: 0 }).get(k);
        if (scored) d.gf++; else d.ga++;
      }
    }
  }
  return { units: [...units.values()], fives: [...fives.values()], duos: [...duos.values()], names, goals, missing };
}

function linesHtml(x) {
  const nm = id => esc(x.names.get(id) || '?');
  const who = ids => ids.map(id => plink({ id }, nm(id))).join(' – ');
  const pair = ([f, a]) => `${f}–${a}`;
  // One card per unit: even-strength goals for–against as the headline, the rest as small facts
  const card = u => {
    const d = u.ev[0] - u.ev[1], gf = u.ev[0];
    const facts = [
      gf ? `<span data-tip="${esc(`Maaleista ${u.own}/${gf} teki ${u.kind === 'F' ? 'ketjun' : 'parin'} oma pelaaja`)}">omat ${u.own}/${gf}</span>` : '',
      u.all ? `<span data-tip="${esc(u.kind === 'F' ? 'Maalit, joissa kaikki kolme saivat pisteen' : 'Maalit, joissa molemmat saivat pisteen')}">${u.kind === 'F' ? 'koko kolmikko' : 'molemmat'} ${u.all}</span>` : '',
    ].filter(Boolean).join('');
    return `<div class="ln-c ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}${u.gp < 2 ? ' few' : ''}">
      <div class="ln-h"><div class="ln-who">${who(u.ids)}</div><div class="ln-meta">${[...u.lines].map(n => n + '.').join(', ')} ${u.kind === 'F' ? 'ketju' : 'pari'} · ${u.gp} ott.</div></div>
      <div class="ln-v" data-tip="${esc(`Tasakentin tehdyt–päästetyt maalit, kun koko ${u.kind === 'F' ? 'ketju' : 'pari'} oli jäällä`)}"><b>${pair(u.ev)}</b><small>${d ? signed(d, 0) : '±0'}</small></div>
      <div class="ln-f">${facts}</div></div>`;
  };
  const list = (kind, title) => {
    const rows = x.units.filter(u => u.kind === kind && (u.gp >= 2 || u.ev[0] + u.ev[1] > 0))
      .sort((a, b) => (b.ev[0] - b.ev[1]) - (a.ev[0] - a.ev[1]) || b.ev[0] - a.ev[0] || b.gp - a.gp);
    return `<h3>${title}</h3><div class="ln-list">${rows.map(card).join('') || '<p class="muted small">Ei vielä dataa.</p>'}</div>`;
  };
  // Five-man units: the exact five skaters on ice for at least 3 even-strength goals
  const fives = x.fives.filter(f => f.gf + f.ga >= 3).sort((a, b) => (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf).slice(0, 6);
  const fiveHtml = fives.length ? `<h3>Viisikot <small class="muted">tasakentin, vähintään 3 maalia jäällä</small></h3><ol class="duo">${fives.map(f => `<li><span>${who(f.ids)}</span><b class="${cls(f.gf - f.ga)}" data-tip="Tasakentin tehdyt–päästetyt maalit, kun koko viisikko oli jäällä">${f.gf}–${f.ga}</b></li>`).join('')}</ol>` : '';
  const duos = x.duos.filter(d => d.gf + d.ga >= 5);
  const best = duos.filter(d => d.gf > d.ga).sort((a, b) => (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf).slice(0, 5);
  const worst = duos.filter(d => d.gf < d.ga).sort((a, b) => (a.gf - a.ga) - (b.gf - b.ga) || b.ga - a.ga).slice(0, 5);
  const duoList = (arr, kind) => !arr.length ? '<p class="muted small">Ei vielä yhtään.</p>' : `<ol class="duo ${kind}">${arr.map(d => `<li><span>${plink({ id: d.a }, nm(d.a))} + ${plink({ id: d.b }, nm(d.b))}</span><b class="${cls(d.gf - d.ga)}" data-tip="Tasakentin tehdyt–päästetyt maalit, kun molemmat olivat jäällä">${d.gf}–${d.ga}</b></li>`).join('')}</ol>`;
  return `
    <div class="grid2 flat">
      <div>${list('F', 'Hyökkäysketjut')}</div>
      <div>${list('D', 'Puolustusparit')}</div>
    </div>
    ${fiveHtml}
    <div class="grid2 flat">
      <div><h3>Parhaat kaksikot <small class="muted">tasakentin</small></h3>${duoList(best, 'good')}</div>
      <div><h3>Heikoimmat kaksikot <small class="muted">tasakentin</small></h3>${duoList(worst, 'bad')}</div>
    </div>
    <p class="muted small">Luvut ovat tarkkoja: yksikkö lasketaan vain, kun kaikki sen pelaajat olivat jäällä maalin hetkellä (Liigan maalitapahtumien kentällä olleet pelaajat). Mukana tasakentin maalit: ylivoima- ja alivoimamaaleihin Liiga ei merkitse kentällä olleita, eikä laukauksiin koskaan. · ${x.goals} maalia, joista tiedossa kentällä olleet</p>`;
}

/* ---------- PL-5: fastest skaters and hardest shots in the league ---------- */
function topListsHtml(league, teams) {
  const tname = id => esc(teams.get(id)?.name || '');
  const list = (key, label) => {
    const all = league.sk.filter(p => p[key]).sort((a, b) => b[key] - a[key]);
    const top = all.slice(0, 10);
    const sai = all.map((p, i) => ({ p, r: i + 1 })).filter(x => x.p.team === SAIPA_NUM);
    const outside = sai.filter(x => x.r > 10).slice(0, 3);
    const li = (p, r) => `<li class="${p.team === SAIPA_NUM ? 'me' : ''}"><span class="tl-r">${r}.</span><span class="tl-n">${p.team === SAIPA_NUM ? plink(p, esc(p.name)) : esc(p.name)} <small>${tname(p.team)}</small></span><b>${kmh(p[key])}</b></li>`;
    return `<div><h3>${label}</h3><ol class="toplist">${top.map((p, i) => li(p, i + 1)).join('')}</ol>
      ${outside.length ? `<ol class="toplist more">${outside.map(x => li(x.p, x.r)).join('')}</ol>` : ''}
      <p class="muted small">${sai.length ? `Paras SaiPa-pelaaja: ${esc(sai[0].p.name)}, ${sai[0].r}. / ${all.length}.` : ''}</p></div>`;
  };
  return `<div class="grid2 flat">${list('speed', 'Nopeimmat luistelijat')}${list('shot', 'Kovimmat laukaukset')}</div>
    <p class="muted small">Lähde: liiga.fi:n kausitilastot</p>`;
}

/* ---------- SE-3: season trend ---------- */
function trendData(sched) {
  return fcPlayed(sched).filter(g => teamNum(g.homeTeamId) === SAIPA_NUM || teamNum(g.awayTeamId) === SAIPA_NUM).map(g => {
    const home = teamNum(g.homeTeamId) === SAIPA_NUM, [h, a] = fcGoals(g);
    return { g, home, opp: home ? g.awayTeamName : g.homeTeamName, gf: home ? h : a, ga: home ? a : h,
      xgf: home ? g.expectedHomeTeamGoals : g.expectedAwayTeamGoals, xga: home ? g.expectedAwayTeamGoals : g.expectedHomeTeamGoals, res: fcResult(g) };
  });
}
function trendHtml(rows) {
  if (rows.length < 3) return '<p class="muted">Trendi näytetään kolmen ottelun jälkeen.</p>';
  const W = 760, H = 220, pad = 34, n = rows.length;
  const x = i => pad + i * (W - pad * 2) / (n - 1);
  // Rolling 5-game xG share
  const roll = rows.map((_, i) => { const w = rows.slice(Math.max(0, i - 4), i + 1); const f = w.reduce((s, r) => s + r.xgf, 0), a = w.reduce((s, r) => s + r.xga, 0); return f / (f + a); });
  const yS = v => pad + (0.75 - v) / 0.5 * (H - pad * 2);
  // Cumulative goal difference vs. cumulative xG difference
  let cg = 0, cx = 0;
  const cum = rows.map(r => ({ g: cg += r.gf - r.ga, x: cx += r.xgf - r.xga }));
  const lo = Math.min(0, ...cum.map(c => Math.min(c.g, c.x))) - 1, hi = Math.max(0, ...cum.map(c => Math.max(c.g, c.x))) + 1;
  const yC = v => pad + (hi - v) / (hi - lo) * (H - pad * 2);
  const grid = (vals, y, fmt) => vals.map(v => `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}" class="gc-grid"/><text x="${pad - 4}" y="${y(v) + 4}" class="gc-l" text-anchor="end">${fmt(v)}</text>`).join('');
  const cStep = hi - lo > 24 ? 10 : hi - lo > 10 ? 5 : 2;
  const cTicks = []; for (let v = Math.ceil(lo / cStep) * cStep; v <= hi; v += cStep) if (v !== 0) cTicks.push(v);
  const lbl = (r, i) => `<text x="${x(i)}" y="${H - 6}" class="gc-l">${fiDate(r.g.start)}</text>`;
  const dots = (arr, y, cls) => arr.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" class="${cls}"><title>${esc(fiDate(rows[i].g.start) + ' ' + rows[i].opp)}</title></circle>`).join('');
  const last = cum[n - 1];
  return `
    <div class="chips"><span class="chip"><small>GF−GA</small><b class="${cls(last.g)}">${signed(last.g, 0)}</b></span><span class="chip"><small>xGF−xGA</small><b class="${cls(last.x)}">${signed(last.x, 1)}</b></span><span class="chip"><small>xGF% L5</small><b>${pct(roll[n - 1], 0)}</b></span></div>
    <div class="trend">
      <div><h3>xGF%, 5 ottelun liukuva</h3>
        <svg viewBox="0 0 ${W} ${H}" class="gs-chart">
          ${grid([0.3, 0.4, 0.6, 0.7], yS, v => pct(v, 0))}<line x1="${pad}" x2="${W - pad}" y1="${yS(0.5)}" y2="${yS(0.5)}" class="gc-axis"/><text x="${pad - 4}" y="${yS(0.5) + 4}" class="gc-l" text-anchor="end">50 %</text>
          ${rows.map((r, i) => `<rect x="${x(i) - 3}" y="${yS(Math.max(0.25, Math.min(0.75, r.xgf / (r.xgf + r.xga)))) - 3}" width="6" height="6" class="tr-g ${r.res === 'H' && r.home || r.res === 'A' && !r.home ? 'w' : r.res === 'T' ? 't' : 'l'}"><title>${esc(r.opp)}: xG ${num(r.xgf, 1)}–${num(r.xga, 1)}</title></rect>`).join('')}
          <polyline class="gc-avg tr-line" points="${roll.map((v, i) => `${x(i)},${yS(v)}`).join(' ')}"/>
          ${rows.map(lbl).join('')}
          ${hoverCols(rows.map((_, i) => x(i)), pad / 2, H - 16, rows.map((r, i) => [`${fiDate(r.g.start)} ${r.home ? 'vs' : '@'} ${r.opp}, ${r.gf}–${r.ga}${r.g.finishedType === 'ENDED_DURING_EXTENDED_GAME_TIME' ? ' JA' : r.g.finishedType === 'ENDED_DURING_WINNING_SHOT_COMPETITION' ? ' VL' : ''}`, `xG\t${num(r.xgf, 2)}–${num(r.xga, 2)}`, `xG-osuus\t${pct(r.xgf / (r.xgf + r.xga), 0)}`, `5 ottelun xG-osuus\t${pct(roll[i], 0)}`].join('\n')))}
        </svg>
        <p class="muted small">Viiva = 5 ottelun liukuva · ■ ottelu: vihreä voitto, harmaa tasan, punainen tappio (60 min)</p></div>
      <div><h3>Maaliero vs. odotettu maaliero, kertymä</h3>
        <svg viewBox="0 0 ${W} ${H}" class="gs-chart">
          ${grid(cTicks, yC, v => signed(v, 0))}<line x1="${pad}" x2="${W - pad}" y1="${yC(0)}" y2="${yC(0)}" class="gc-axis"/><text x="${pad - 4}" y="${yC(0) + 4}" class="gc-l" text-anchor="end">0</text>
          <polyline class="tr-x" points="${cum.map((c, i) => `${x(i)},${yC(c.x)}`).join(' ')}"/>
          <polyline class="tr-gd" points="${cum.map((c, i) => `${x(i)},${yC(c.g)}`).join(' ')}"/>
          ${dots(cum.map(c => c.g), yC, 'gc-pos')}
          <text x="${x(n - 1) + 6}" y="${yC(last.g) + 4}" class="gc-v end" text-anchor="start">${signed(last.g, 0)}</text>
          <text x="${x(n - 1) + 6}" y="${yC(last.x) + 4}" class="gc-l" text-anchor="start">${signed(last.x, 1)}</text>
          ${rows.map(lbl).join('')}
          ${hoverCols(rows.map((_, i) => x(i)), pad / 2, H - 16, rows.map((r, i) => [`${fiDate(r.g.start)} ${r.home ? 'vs' : '@'} ${r.opp}, ${r.gf}–${r.ga}`, `Maaliero, kertymä\t${signed(cum[i].g, 0)}`, `Maaliero, ottelu\t${signed(r.gf - r.ga, 0)}`, `Odotettu, kertymä\t${signed(cum[i].x, 1)}`, `Odotettu, ottelu\t${signed(r.xgf - r.xga, 1)}`].join('\n')))}
        </svg>
        <p class="muted small">Musta = GF−GA · katkoviiva = xGF−xGA · ilman voittolaukausmaaleja</p></div>
    </div>`;
}

/* ---------- PL-3: streaks and form ---------- */
function streaksData(games) {
  // games: analyzeGame results in chronological order
  const P = new Map();
  for (const a of games) for (const p of a.lineup || []) {
    if (!p.played) continue;
    const t = P.get(p.id) || P.set(p.id, { id: p.id, first: p.first, last: p.last, log: [] }).get(p.id);
    t.log.push({ pts: p.g + p.a, g: p.g, date: a.start });
  }
  const out = [];
  for (const t of P.values()) {
    const run = f => { let n = 0; for (let i = t.log.length - 1; i >= 0 && f(t.log[i]); i--) n++; return n; };
    let best = 0, cur = 0;
    for (const x of t.log) { cur = x.pts ? cur + 1 : 0; best = Math.max(best, cur); }
    const l5 = t.log.slice(-5);
    out.push({ ...t, gp: t.log.length, pts: t.log.reduce((s, x) => s + x.pts, 0), goals: t.log.reduce((s, x) => s + x.g, 0),
      ptStreak: run(x => x.pts > 0), gStreak: run(x => x.g > 0), dry: run(x => x.pts === 0), gDry: run(x => x.g === 0), best,
      l5pts: l5.reduce((s, x) => s + x.pts, 0), l5 });
  }
  return out;
}
function streaksHtml(S) {
  const by = (f, min = 1) => S.filter(p => f(p) >= min).sort((a, b) => f(b) - f(a) || b.pts - a.pts);
  const card = (k, list, txt, kind = '') => list.length ? `<div class="nosto ${kind}"><div class="k">${k}</div><div class="t">${list.slice(0, 3).map(p => `<b>${plink(p, `${esc(p.first)} ${esc(p.last)}`)}</b> ${txt(p)}`).join('<br>')}</div></div>` : '';
  const scorers = S.filter(p => p.pts >= 3);
  const form = [...S].filter(p => p.l5.length >= 3).sort((a, b) => b.l5pts - a.l5pts || b.pts - a.pts).slice(0, 8);
  return `
    <div class="nostot">
      ${card('🔥 Pisteputki käynnissä', by(p => p.ptStreak, 2), p => `${p.ptStreak} ottelua peräkkäin pisteitä`, 'good')}
      ${card('🚨 Maaliputki käynnissä', by(p => p.gStreak, 2), p => `${p.gStreak} ottelua peräkkäin maali`, 'good')}
      ${card('📏 Kauden pisin pisteputki', by(p => p.best, 3), p => `${p.best} ottelua`)}
      ${card('🥶 Kylmä putki', scorers.filter(p => p.dry >= 3).sort((a, b) => b.dry - a.dry), p => `${p.dry} ottelua ilman pisteitä · kausi ${p.pts} P`, 'bad')}
    </div>
    <h3>Vire: viisi viime ottelua</h3>
    <div class="tablewrap"><table class="mini form-t"><tr><th>Pelaaja</th><th data-tip="Last 5 Games\nViisi viime ottelua, vanhin ensin. Numero = pisteet">L5</th><th data-tip="Points\nPisteet viidessä viime ottelussa">P</th><th data-tip="Kauden pisteet ja ottelut">Kausi</th></tr>
      ${form.map(p => `<tr><td>${plink(p, `${esc(p.first)} ${esc(p.last)}`)}</td><td>${p.l5.map(x => `<i class="fd ${x.g ? 'g' : x.pts ? 'p' : ''}" title="${fiDate(x.date)}: ${x.g}+${x.pts - x.g}">${x.pts || ''}</i>`).join('')}</td><td><b>${p.l5pts}</b></td><td>${p.pts} P / ${p.gp} GP</td></tr>`).join('')}
    </table></div>
    <p class="muted small">Keltainen = maali · vaalea = vain syöttöpisteitä</p>`;
}

/* ---------- season view hook ---------- */
async function seasonInsights(games) {
  const put = (sel, title, html) => { const el = $(sel); if (el) el.innerHTML = `<h2>${title}</h2>${html}`; };
  const fail = (sel, title) => e => put(sel, title, `<p class="neg-num">Lataus epäonnistui: ${esc(e.message)}</p>`);
  const chrono = [...games].sort((a, b) => a.start.localeCompare(b.start));
  try { put('#streakCard', 'Putket ja vire', streaksHtml(streaksData(chrono))); } catch (e) { fail('#streakCard', 'Putket ja vire')(e); }
  getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`).then(s => put('#trendCard', 'Kauden kulku', trendHtml(trendData(s)))).catch(fail('#trendCard', 'Kauden kulku'));
  Promise.all(saipaGames.map(g => loadRaw(g.id))).then(raws => put('#lineCard', 'Ketjut ja parit', linesHtml(lineStats(raws)))).catch(fail('#lineCard', 'Ketjut ja parit'));
  Promise.all([loadLeagueSkaters(), getJSON(`/standings/?season=${SEASON}`)]).then(([L, stn]) => {
    const teams = new Map((stn.season || []).map(t => [t.internalId, { name: t.teamName }]));
    put('#topCard', 'Liigan nopeimmat ja kovimmat', topListsHtml(L, teams));
  }).catch(fail('#topCard', 'Liigan nopeimmat ja kovimmat'));
}
