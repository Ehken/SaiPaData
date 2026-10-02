/* SaiPa Data: live view for a SaiPa game in progress (LV-1).
 * Self-contained add-on: to remove it, delete this file and its <script> tag in index.html. app.js only calls
 * liveGameId() / renderLive() when they exist.
 * While the game is on, the page fetches fresh data every 30 seconds (no scheduling needed, keep the page open).
 * It shows what the TV broadcast does not: win probability over the game, xG and pressure, special teams,
 * a feed of notable moments, the preview's picks against tonight, ice time, intermission summaries,
 * and the full game report below. */

const LIVE_POLL_MS = 30000;
let liveTimer = null, livePeriod = 'all', liveSeen = new Set(), liveNotify = false;

// The game that is live now: SaiPa's next game from 10 minutes before puck drop until the API marks it ended
function liveGameId() {
  const g = typeof nextGameRow !== 'undefined' ? nextGameRow : null;
  if (!g || g.ended) return null;
  return Date.now() >= new Date(g.start).getTime() - 10 * 60000 ? String(g.id) : null;
}

// Fresh copies of the game endpoints, put into the shared cache so the report functions use them
async function liveFetch(id) {
  const paths = [`/games/${SEASON}/${id}`, `/games/stats/${SEASON}/${id}`, `/shotmap/${SEASON}/${id}`];
  const data = await Promise.all(paths.map(p => fetch(API + p, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : (p.includes('shotmap') ? [] : Promise.reject(new Error(`${r.status}`))))));
  paths.forEach((p, i) => cache.set(p, Promise.resolve(data[i])));
  return data;
}

// SaiPa's chance of winning from the score at a moment, with the pre-game goal rates for the time that is left.
// A tie after 60 minutes counts as half a win (overtime or shootout).
function liveWinProb(pre, score, elapsed, home) {
  if (!pre) return null;
  if (elapsed >= 3600) return score.h === score.a ? 0.5 : (score.h > score.a) === home ? 1 : 0;
  const r = (3600 - elapsed) / 3600, lh = pre.lh * r, la = pre.la * r;
  let w = 0, t = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const p = poisson(lh, i) * poisson(la, j), dh = score.h + i, da = score.a + j;
    if (dh === da) t += p; else if ((dh > da) === home) w += p;
  }
  return w + t / 2;
}

// Win probability over the game, one point per minute, with goals and penalties marked
function wpChart(pre, d, t, home) {
  if (!pre) return '';
  const goals = d.goals.filter(x => x.valid);
  const scoreAt = s => { let h = 0, a = 0; for (const x of goals) if (x.t <= s) { if (x.mine === home) h++; else a++; } return { h, a }; };
  const end = Math.max(3600, t), pts = [];
  for (let s = 0; s <= t; s += 60) pts.push([s, liveWinProb(pre, scoreAt(s), s, home)]);
  pts.push([t, liveWinProb(pre, scoreAt(t), t, home)]);
  const W = 760, H = 170, m = { l: 34, r: 12, t: 12, b: 22 };
  const x = s => m.l + s / end * (W - m.l - m.r), y = v => m.t + (1 - v) * (H - m.t - m.b);
  const line = pts.map(([s, v]) => `${x(s)},${y(v)}`).join(' ');
  const area = `${x(0)},${y(0.5)} ${line} ${x(t)},${y(0.5)}`;
  const per = [1200, 2400, 3600].filter(s => s < end).map(s => `<line x1="${x(s)}" x2="${x(s)}" y1="${m.t}" y2="${H - m.b}" class="gc-grid"/>`).join('');
  const gm = goals.map(g => `<circle cx="${x(g.t)}" cy="${y(liveWinProb(pre, scoreAt(g.t), g.t, home))}" r="5" class="${g.mine ? 'wp-g s' : 'wp-g'}" data-tip="${esc(`${inPeriod(g.t)}\n${g.scorer}\t${g.score}`)}"/>`).join('');
  const pen = d.penalties.filter(p => p.t <= t && p.min < 10).map(p => `<rect x="${x(p.t)}" y="${H - m.b - 4}" width="${Math.max(2, x(Math.min(p.end, t)) - x(p.t))}" height="4" class="${p.mine ? 'wp-p s' : 'wp-p'}"/>`).join('');
  const cols = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
  const tips = cols.map(([s, v]) => { const sc = scoreAt(s); return `${s >= 3600 ? 'JA' : `${Math.floor(s / 1200) + 1}. erä`} ${mmss(s % 1200)}\nTilanne\t${sc.h}–${sc.a}\nSaiPan voitto\t${pct(v, 0)}`; });
  return `<div class="lv-wp"><h3>Voittotodennäköisyys ottelun aikana</h3>
    <svg viewBox="0 0 ${W} ${H}" class="gs-chart">
      ${[0.25, 0.75].map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="gc-grid"/>`).join('')}
      <line x1="${m.l}" x2="${W - m.r}" y1="${y(0.5)}" y2="${y(0.5)}" class="gc-axis"/>
      ${[0, 0.5, 1].map(v => `<text x="${m.l - 4}" y="${y(v) + 4}" class="gc-l" text-anchor="end">${v * 100} %</text>`).join('')}
      ${per}<polygon points="${area}" class="wp-area"/><polyline points="${line}" class="wp-line"/>${pen}${gm}
      ${['1.', '2.', '3.'].map((l, i) => `<text x="${x(i * 1200 + 600)}" y="${H - 6}" class="gc-l" text-anchor="middle">${l} erä</text>`).join('')}
      ${hoverCols(cols.map(([s]) => x(s)), m.t, H - m.b, tips)}
    </svg></div>`;
}

// Notable moments the broadcast does not count for you. Each has a game time and a stable key.
function liveAlerts(d, t, full, oppName, xgf, xga, sf, sa) {
  const out = [];
  // Runs of shot attempts by one team
  const sh = [...d.shots].filter(x => x.t <= t).sort((a, b) => a.t - b.t);
  let run = 0, who = null;
  for (const x of sh) {
    if (x.mine === who) run++; else { who = x.mine; run = 1; }
    if (run === 8) out.push({ t: x.t, key: `run${x.t}`, txt: `${who ? 'SaiPa' : esc(oppName)}: 8 laukausyritystä putkeen`, tone: who ? 'pos' : 'neg' });
  }
  // No SaiPa attempt in the last 5 minutes
  const lastMine = [...sh].reverse().find(x => x.mine);
  if (t > 600 && (!lastMine || t - lastMine.t >= 300)) out.push({ t, key: `dry${Math.floor(t / 300)}`, txt: `SaiPalta ei laukausyritystä ${Math.floor((t - (lastMine?.t || 0)) / 60)} minuuttiin`, tone: 'neg' });
  // Power plays
  for (const p of d.penalties.filter(p => p.t <= t && p.min < 10)) out.push({ t: p.t, key: `pen${p.t}${p.player}`, txt: `${p.mine ? 'SaiPa alivoimalle' : 'SaiPa ylivoimalle'}: ${esc(p.player)}, ${esc(p.name || '')} ${p.min} min`, tone: p.mine ? 'neg' : 'pos' });
  // Goalie and finishing
  const gk = full.goalies.find(x => x.played);
  if (gk && gk.gsax >= 1) out.push({ t, key: `gkp${gk.id}`, txt: `${esc(gk.last)} ${signed(gk.gsax, 1)} GSAx: pitää SaiPaa pelissä`, tone: 'pos' });
  if (gk && gk.gsax <= -1) out.push({ t, key: `gkn${gk.id}`, txt: `${esc(gk.last)} ${signed(gk.gsax, 1)} GSAx: torjunnat jäävät odotetusta`, tone: 'neg' });
  if (xgf != null && xgf - xga >= 0.8 && sf < sa) out.push({ t, key: `xgl${sf}${sa}`, txt: `SaiPa on maalipaikoissa edellä (xG ${num(xgf, 1)}–${num(xga, 1)}), mutta tappiolla`, tone: 'pos' });
  if (xgf != null && xga - xgf >= 0.8 && sf > sa) out.push({ t, key: `xgw${sf}${sa}`, txt: `SaiPa johtaa, vaikka ${esc(oppName)} on maalipaikoissa edellä (xG ${num(xga, 1)}–${num(xgf, 1)})`, tone: 'neg' });
  return out.sort((a, b) => b.t - a.t);
}

// The preview's key player picks for both teams, against what they have done tonight
async function previewVsTonight(next, g, st) {
  const league = await loadLeague();
  const res = [];
  for (const tid of [teamNum(next.homeTeamId), teamNum(next.awayTeamId)]) {
    const games = (await loadTeamGames(league, tid)).filter(x => x.start < next.start);
    const picks = keyPicks(teamSummary(games));
    const tonight = new Map(teamGame(g, st, tid, next).players.map(p => [p.id, p]));
    res.push({ tid, picks, tonight });
  }
  return res;
}
function pvtHtml(rows, teams) {
  if (!rows.some(r => r.picks.length)) return '';
  const block = ({ tid, picks, tonight }) => `<div><div class="form-h"><b>${esc(teams.get(tid) || '')}</b></div>
    <table class="mini lv-pvt"><tr><th>Ennakko</th><th></th><th data-tip="G+A = maalit + syötöt tänään">G+A</th><th data-tip="iCF = laukausyritykset tänään">iCF</th><th data-tip="xG = maaliodottama tänään">xG</th></tr>
    ${picks.map(k => { const p = tonight.get(k.p.id); return `<tr><td><span class="lv-k">${k.k.replace(/<[^>]+>/g, '')}</span><br><b>${esc(k.p.first)} ${esc(k.p.last)}</b> <small class="muted">${k.v}</small></td><td></td>
      ${p && p.toi ? `<td><b>${p.g}+${p.a}</b></td><td>${p.shots}</td><td>${num(p.ixg, 2)}</td>` : '<td colspan="3" class="muted">ei vielä jäällä</td>'}</tr>`; }).join('')}</table></div>`;
  return `<div class="lv-sec"><h3>Ennakko vs. tänään</h3><div class="grid2 flat">${rows.map(block).join('')}</div></div>`;
}

// SaiPa's ice time so far, and who was on the ice for the latest goal
function iceHtml(full, d, g, per) {
  const sk = full.people.filter(p => !p.goalie && p.toi).sort((a, b) => b.toi - a.toi);
  if (!sk.length) return '';
  const max = sk[0].toi;
  const rows = sk.slice(0, 12).map(p => `<div class="lv-ice" data-tip="${esc(`${p.first} ${p.last}\nTOI\t${mmss(p.toi)}\nTämä erä\t${mmss(p.toiP?.[per] || 0)}\nG+A\t${p.g}+${p.a}\nC+/-\t${signed(p.cf - p.ca, 0)}`)}"><span>${esc(p.last)}</span><i style="width:${p.toi / max * 100}%"></i><b>${mmss(p.toi)}</b><small>${mmss(p.toiP?.[per] || 0)}</small></div>`).join('');
  const home = d.home, last = [...d.goals].filter(x => x.valid).pop();
  let onIce = '';
  if (last) {
    const roster = (home ? g.homeTeamPlayers : g.awayTeamPlayers) || [];
    const team = last.mine ? (home ? g.game.homeTeam : g.game.awayTeam) : (home ? g.game.awayTeam : g.game.homeTeam);
    const ev = (team.goalEvents || []).find(e => e.gameTime === last.t);
    const ids = String((last.mine ? ev?.plusPlayerIds : ev?.minusPlayerIds) || '').split(/\s+/).filter(Boolean).map(Number);
    const names = ids.map(j => roster.find(p => p.jersey === j)).filter(p => p && p.roleCode !== 'MV').map(p => esc(p.lastName));
    if (names.length) onIce = `<p class="small">${last.mine ? '🟡 SaiPan' : '⚫ Vastustajan'} maali ${inPeriod(last.t)}: SaiPalta jäällä ${names.join(', ')}</p>`;
  }
  return `<div class="lv-sec"><h3>Peliaika tähän asti <span class="muted small">koko ottelu · tämä erä</span></h3><div class="lv-ices">${rows}</div>${onIce}</div>`;
}

// Summary of the latest finished period: star, xG and attempts
function periodBreakHtml(g, st, ctx, t, home, intermission) {
  const n = Math.min(3, Math.floor(t / 1200));
  if (n < 1) return '';
  const r = periodSummary(g, st, home).find(x => x.n === n);
  const star = analyzeGame(g, st, n, ctx).people[0];
  if (!r) return '';
  return `<div class="lv-sec lv-brk ${intermission ? 'on' : ''}"><h3>${intermission ? '☕ Erätauko · ' : ''}${n}. erä</h3><div class="chips">
    <span class="chip"><small>Maalit</small><b>${hf(home, r.sg, r.og).join('–')}</b></span>
    <span class="chip"><small>xG</small><b>${hf(home, num(r.sxg, 1), num(r.oxg, 1)).join('–')}</b></span>
    <span class="chip"><small>iCF</small><b>${hf(home, r.ssh, r.osh).join('–')}</b></span>
    ${star ? `<span class="chip"><small>⭐ Erän tähti</small><b>${esc(star.last)}</b></span>` : ''}</div></div>`;
}

function liveToggleNotify(btn) {
  if (!('Notification' in window)) { btn.textContent = 'Selain ei tue ilmoituksia'; return; }
  Notification.requestPermission().then(p => { liveNotify = p === 'granted'; btn.textContent = liveNotify ? '🔔 Ilmoitukset päällä' : 'Ilmoitukset estetty'; });
}

async function renderLive(id, box) {
  clearInterval(liveTimer);
  liveSeen = new Set();
  box.innerHTML = '<p class="loading">Haetaan live-dataa…</p>';
  const next = nextGameRow;
  const pre = await loadForecast(next, next.start).then(F => F?.p).catch(() => null);
  const teams = new Map([[teamNum(next.homeTeamId), next.homeTeamName], [teamNum(next.awayTeamId), next.awayTeamName]]);
  let pvt = null, first = true;
  const draw = async () => {
    if (!box.isConnected) { clearInterval(liveTimer); return; }
    let g, st, sm;
    try { [g, st, sm] = await liveFetch(id); } catch (e) {
      const s = box.querySelector('.lv-stamp'); if (s) s.textContent = `päivitys epäonnistui (${e.message}), yritetään uudelleen`;
      return;
    }
    const G = g.game, home = isSaipa(G.homeTeam.teamId);
    if (!G.started) {
      box.innerHTML = `<div class="lv-panel"><div class="lv-head"><span class="lv-dot"></span><b>${esc(G.homeTeam.teamName)}–${esc(G.awayTeam.teamName)}</b><span>alkaa klo ${new Date(G.start).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' })}</span><span class="lv-stamp">päivitetty ${new Date().toLocaleTimeString('fi-FI')}</span></div>
        ${pre ? `<div class="chips"><span class="chip"><small>SaiPan voitto, ennuste</small><b>${pct(liveWinProb(pre, { h: 0, a: 0 }, 0, home), 0)}</b></span></div>` : ''}<p class="muted small">Päivittyy itsestään 30 sekunnin välein.</p></div>`;
      return;
    }
    const smA = Array.isArray(sm) ? sm : [], ctx = { sm: smA, sogFallback: null };
    const t = G.gameTime || 0, per = G.currentPeriod || Math.min(4, Math.floor(t / 1200) + 1);
    const intermission = !G.ended && t > 0 && t % 1200 === 0 && t < 3600;
    const d = reportData(g, st, smA);
    const score = { h: G.homeTeam.goals ?? 0, a: G.awayTeam.goals ?? 0 };
    const S = home ? G.homeTeam : G.awayTeam, O = home ? G.awayTeam : G.homeTeam;
    const sf = home ? score.h : score.a, sa = home ? score.a : score.h;
    const xgf = S.expectedGoals, xga = O.expectedGoals;
    const wp = G.ended ? null : liveWinProb(pre, score, t, home), wp0 = liveWinProb(pre, { h: 0, a: 0 }, 0, home);
    const recent = d.shots.filter(x => x.t > t - 300 && x.t <= t), rm = recent.filter(x => x.mine).length, ro = recent.length - rm;
    const onNow = d.penalties.filter(p => p.t <= t && p.end > t && p.min < 10);
    const pk = onNow.filter(p => p.mine), pp = onNow.filter(p => !p.mine);
    const left = arr => mmss(Math.max(...arr.map(p => p.end)) - t);
    const special = pk.length > pp.length ? { k: 'Alivoima', v: `${5 - pk.length + pp.length} v 5`, s: `${left(pk)} jäljellä`, tone: 'neg' }
      : pp.length > pk.length ? { k: 'Ylivoima', v: `5 v ${5 - pp.length + pk.length}`, s: `${left(pp)} jäljellä`, tone: 'pos' } : null;
    const full = analyzeGame(g, st, null, ctx);
    const star = full.people.filter(p => !p.goalie)[0], gk = full.goalies.find(x => x.played);
    const oppName = O.teamName;
    // Pressure bar: SaiPa's share of attempts in each of the last five minutes
    const bars = [4, 3, 2, 1, 0].map(k => { const w = d.shots.filter(x => x.t > t - (k + 1) * 60 && x.t <= t - k * 60), a = w.filter(x => x.mine).length, b = w.length - a; return `<i class="${a > b ? 's' : b > a ? 'o' : ''}" style="height:${6 + Math.min(24, (a + b) * 5)}px" data-tip="${esc(`${k ? `${k}–${k + 1} min sitten` : 'viimeinen minuutti'}\nSaiPa\t${a}\n${oppName}\t${b}`)}"></i>`; }).join('');
    const tiles = [
      wp != null ? tile('📊', 'Voittotodennäköisyys', pct(wp, 0), '', null, `ennen ottelua ${pct(wp0, 0)}`, wp >= wp0 ? 'pos' : 'neg',
        'Voittotodennäköisyys nyt\nNykyinen tilanne + ennusteen maalitahti jäljellä olevalle ajalle\nTasapeli 60 minuutin jälkeen lasketaan puolikkaaksi') : '',
      xgf != null ? tile('🎯', 'Maalipaikat (xG)', `${num(home ? xgf : xga, 1)}–${num(home ? xga : xgf, 1)}`, '', null, `${pre ? `ennuste ${num(pre.lh, 1)}–${num(pre.la, 1)} · ` : ''}SaiPa ${signed(sf - xgf, 1)} G−xG`) : '',
      `<div class="tile ${rm > ro + 2 ? 'pos' : ro > rm + 2 ? 'neg' : ''}"><div class="t-top"><span class="t-ic">🌊</span><span class="k">Painostus, 5 min</span></div><div class="v">${home ? rm : ro}–${home ? ro : rm}<small>iCF</small></div><div class="lv-bars">${bars}</div><div class="t-sub">${rm > ro + 2 ? 'SaiPa painostaa' : ro > rm + 2 ? `${esc(oppName)} painostaa` : 'tasaista'}</div></div>`,
      special ? tile('⏱️', special.k, special.v, '', null, special.s, special.tone) : '',
      star ? tile('⭐', 'SaiPan paras nyt', num(star.gs, 2), 'GS', star, `${star.g}+${star.a} · ${star.shots} iCF · ${mmss(star.toi)}`) : '',
      gk ? tile('🧤', 'Maalivahti', signed(gk.gsax, 2), 'GSAx', gk, `${gk.saves} torjuntaa · ${gk.ga} päästettyä`, gk.gsax >= 0 ? 'pos' : 'neg') : '',
    ].filter(Boolean);
    // Alerts: mark the ones that are new since the last refresh, and notify if the viewer allowed it
    const alerts = liveAlerts(d, t, full, oppName, xgf, xga, sf, sa);
    const fresh = alerts.filter(a => !liveSeen.has(a.key));
    if (!first && liveNotify) for (const a of fresh.slice(0, 3)) try { new Notification('SaiPa live', { body: a.txt.replace(/&[a-z#0-9]+;/g, ''), tag: a.key }); } catch (e) { /* not available */ }
    alerts.forEach(a => liveSeen.add(a.key));
    const feed = alerts.length ? `<div class="lv-sec"><h3>Huomiot <button class="sbtn sm lv-nb">${liveNotify ? '🔔 Ilmoitukset päällä' : '🔔 Ilmoitukset puhelimeen'}</button></h3><ul class="lv-feed">${alerts.slice(0, 8).map(a => `<li class="${a.tone} ${!first && fresh.includes(a) ? 'new' : ''}"><span>${a.t >= 3600 ? 'JA' : `${Math.floor(a.t / 1200) + 1}. ${mmss(a.t % 1200)}`}</span>${a.txt}</li>`).join('')}</ul></div>` : '';
    if (!pvt) pvt = await previewVsTonight(next, g, st).catch(() => null);
    else for (const r of pvt) r.tonight = new Map(teamGame(g, st, r.tid, next).players.map(p => [p.id, p]));
    const clock = G.ended ? 'Päättynyt' : intermission ? `Erätauko ${t / 1200}.–${t / 1200 + 1}.` : per > 3 ? `Jatkoaika ${mmss(t - 3600)}` : `${per}. erä ${mmss(t - (per - 1) * 1200)}`;
    box.innerHTML = `<div class="lv-panel">
      <div class="lv-head">${G.ended ? '' : '<span class="lv-dot"></span>'}<b>${esc(G.homeTeam.teamName)} ${score.h}–${score.a} ${esc(G.awayTeam.teamName)}</b><span>${clock}</span><span class="lv-stamp">päivitetty ${new Date().toLocaleTimeString('fi-FI')}</span></div>
      <div class="tiles s-hl" data-n="${tiles.length}">${tiles.join('')}</div>
      ${periodBreakHtml(g, st, ctx, t, home, intermission)}
      ${wpChart(pre, d, t, home)}
      ${feed}
      ${pvt ? pvtHtml(pvt, teams) : ''}
      ${iceHtml(full, d, g, per)}
      <p class="muted small">${G.ended ? 'Ottelu on päättynyt. Lataa sivu uudelleen, niin raportti avautuu Ottelu-välilehdelle.' : 'Päivittyy itsestään 30 sekunnin välein. Laukauskartta ja pelaajatilastot voivat laahata tapahtumien perässä.'}</p>
    </div><div id="liveReport"></div>`;
    const nb = box.querySelector('.lv-nb'); if (nb) nb.onclick = () => liveToggleNotify(nb);
    const keep = [SK_SET, GK_SET];
    await renderGame(id, $('#liveReport', box));
    [SK_SET, GK_SET] = keep;
    // Keep the chosen period across refreshes
    const pb = box.querySelector(`#liveReport .pbtn[data-p="${livePeriod}"]`);
    if (pb && livePeriod !== 'all') pb.click();
    box.querySelectorAll('#liveReport .pbtn').forEach(b => b.addEventListener('click', () => { livePeriod = b.dataset.p; }));
    first = false;
    if (G.ended) clearInterval(liveTimer);
  };
  await draw();
  liveTimer = setInterval(() => { if (!document.hidden) draw(); }, LIVE_POLL_MS);
}
