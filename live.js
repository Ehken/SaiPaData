/* SaiPa Data: live view for a SaiPa game in progress (LV-1).
 * Self-contained add-on: to remove it, delete this file and its <script> tag in index.html. app.js only calls
 * liveGameId() / renderLive() when they exist.
 * While the game is on, the page fetches fresh data every 15 seconds (60 s in intermissions; keep the page open).
 * Between fetches the game clock and penalty countdowns run locally at the pace the game clock moved during the
 * previous interval (so they stop when play is stopped) and snap to the real value on the next fetch.
 * It shows what the TV broadcast does not: win probability over the game, xG and pressure, special teams,
 * a feed of notable moments, the preview's picks against tonight, ice time, intermission summaries,
 * and the full game report below. */

const LIVE_POLL_MS = 15000, LIVE_POLL_BREAK_MS = 60000;
// Local clock: last known game time, when it was seen, and the game-clock pace (game s per real s) since the previous fetch
let liveClock = null, liveTick = null, liveLog = [], liveNextMs = LIVE_POLL_MS;
// Intermission clock. The API has no wall-clock time for a period's end, so the break starts when this page first
// sees the clock stopped at 20:00 (at most one poll late). Kept in sessionStorage so a reload keeps it.
// Liiga intermissions: 18 min on weekdays, 20 min at weekends.
let liveBreak = null;
// Event history popover in the score header: open state and how many events the viewer has already seen
let liveFeedOpen = false, liveFeedSeen = 0, liveFeedDocBound = false;
const breakLen = start => ['Sat', 'Sun'].includes(new Date(start).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/Helsinki' })) ? 1200 : 1080;
let liveTimer = null, livePeriod = 'all', liveSeen = new Set(), liveNotify = false, liveFirstT = new Map();

// Test mode: ?game=ID&tab=live&replay=1 replays a played SaiPa game with a time slider. The real data is cut
// to the chosen moment: goals, penalties and shots by their time, player stats by finished periods (the current
// period's xG pro rata). Nothing else on the site changes.
const LIVE_REPLAY = new URLSearchParams(location.search).get('replay') === '1';
let replayRaw = null, replayT = 1500, replayPlay = null;
function replayCut(raw, T) {
  const g = structuredClone(raw.g), st = structuredClone(raw.st);
  const cur = Math.min(4, Math.floor(Math.min(T, 3899) / 1200) + 1), frac = (T - (cur - 1) * 1200) / 1200;
  const G = g.game;
  Object.assign(G, { gameTime: T, currentPeriod: cur, started: true, ended: false });
  for (const side of ['home', 'away']) {
    const team = G[`${side}Team`];
    team.goalEvents = (team.goalEvents || []).filter(e => e.gameTime <= T);
    team.penaltyEvents = (team.penaltyEvents || []).filter(e => e.gameTime <= T);
    team.goals = team.goalEvents.filter(e => !(e.goalTypes || []).includes('VT0') && (e.period || 0) <= 4).length;
    const pers = st[`${side}Team`] || [];
    const xgOf = p => (p.periodPlayerStats || []).reduce((a, x) => a + (x.expectedGoalsPlayer || 0), 0);
    team.expectedGoals = pers.filter(p => p.period < cur).reduce((a, p) => a + xgOf(p), 0) + pers.filter(p => p.period === cur).reduce((a, p) => a + xgOf(p) * frac, 0);
    st[`${side}Team`] = pers.filter(p => p.period < cur);
  }
  const sm = (raw.sm || []).filter(x => x.gameTime <= T);
  return [g, st, sm];
}
function replayControls(box, redraw, maxT) {
  const bar = document.createElement('div');
  bar.className = 'lv-replay';
  bar.innerHTML = `<b>Testitila</b><button class="sbtn sm" data-a="play">${replayPlay ? '⏸' : '▶︎'}</button><button class="sbtn sm" data-a="-300">−5 min</button><button class="sbtn sm" data-a="300">+5 min</button>
    <input type="range" min="0" max="${maxT}" step="30" value="${replayT}"><span>${replayT >= 3600 ? 'JA' : `${Math.floor(replayT / 1200) + 1}. erä`} ${mmss(replayT % 1200)}</span>
    <small class="muted">Pelattu ottelu toistettuna. Pelaajatilastot päivittyvät erä kerrallaan.</small>`;
  const go = t => { replayT = Math.max(0, Math.min(maxT, t)); redraw(); };
  bar.querySelector('input').oninput = e => go(Number(e.target.value));
  bar.querySelectorAll('button').forEach(b => b.onclick = () => {
    if (b.dataset.a !== 'play') return go(replayT + Number(b.dataset.a));
    if (replayPlay) { clearInterval(replayPlay); replayPlay = null; redraw(); return; }
    replayPlay = setInterval(() => { if (!box.isConnected || replayT >= maxT) { clearInterval(replayPlay); replayPlay = null; } go(replayT + 60); }, 1500);
    redraw();
  });
  box.prepend(bar);
}

// The game that is live now: SaiPa's next game from 10 minutes before puck drop until the API marks it ended
function liveGameId() {
  if (LIVE_REPLAY) return urlState().game;
  const g = typeof nextGameRow !== 'undefined' ? nextGameRow : null;
  if (!g || g.ended) return null;
  return Date.now() >= new Date(g.start).getTime() - 10 * 60000 ? String(g.id) : null;
}

// Fresh copies of the game endpoints, put into the shared cache so the report functions use them
async function liveFetch(id) {
  if (LIVE_REPLAY) {
    if (!replayRaw) {
      const [g, st, sm] = await Promise.all([getJSON(`/games/${SEASON}/${id}`), getJSON(`/games/stats/${SEASON}/${id}`), getJSON(`/shotmap/${SEASON}/${id}`).catch(() => [])]);
      replayRaw = { g, st, sm: Array.isArray(sm) ? sm : [] };
    }
    const cut = replayCut(replayRaw, replayT);
    [`/games/${SEASON}/${id}`, `/games/stats/${SEASON}/${id}`, `/shotmap/${SEASON}/${id}`].forEach((p, i) => cache.set(p, Promise.resolve(cut[i])));
    return cut;
  }
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
  const gm = goals.map(g => `<circle cx="${x(g.t)}" cy="${y(liveWinProb(pre, scoreAt(g.t), g.t, home))}" r="5" class="${g.mine ? 'wp-g s' : 'wp-g'}" data-tip="${esc(`${g.valid ? `Maali ${g.score}${g.types.length ? ` (${g.types.join(', ')})` : ''}` : 'Hylätty maali'} · ${g.mine ? 'SaiPa' : d.O.teamName} · ${inPeriod(g.t)}\nTekijä\t${g.scorer}\nSyöttäjät\t${g.assists.length ? g.assists.join(', ') : 'ei syöttäjiä'}\nSaiPan voittotodennäköisyys\t${pct(liveWinProb(pre, scoreAt(g.t), g.t, home), 0)}`)}"/>`).join('');
  const pen = d.penalties.filter(p => p.t <= t && p.min < 10).map(p => `<g data-tip="${esc(`Jäähy · ${p.mine ? 'SaiPa' : d.O.teamName}\n${p.player}${p.name ? `\t${p.name}` : ''}\n${p.min} min\t${inPeriod(p.t)}–${inPeriod(Math.min(p.end, Math.max(t, p.t)))}`)}"><rect x="${x(p.t)}" y="${H - m.b - 10}" width="${Math.max(6, x(Math.min(p.end, t)) - x(p.t))}" height="12" fill="transparent"/><rect x="${x(p.t)}" y="${H - m.b - 4}" width="${Math.max(2, x(Math.min(p.end, t)) - x(p.t))}" height="4" class="${p.mine ? 'wp-p s' : 'wp-p'}"/></g>`).join('');
  const cols = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
  const tips = cols.map(([s, v]) => { const sc = scoreAt(s); return `${s >= 3600 ? 'JA' : `${Math.floor(s / 1200) + 1}. erä`} ${mmss(s % 1200)}\nTilanne\t${sc.h}–${sc.a}\nSaiPan voitto\t${pct(v, 0)}`; });
  return `<div class="lv-wp"><h3>Voittotodennäköisyys ottelun aikana</h3>
    <svg viewBox="0 0 ${W} ${H}" class="gs-chart">
      ${[0.25, 0.75].map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="gc-grid"/>`).join('')}
      <line x1="${m.l}" x2="${W - m.r}" y1="${y(0.5)}" y2="${y(0.5)}" class="gc-axis"/>
      ${[0, 0.5, 1].map(v => `<text x="${m.l - 4}" y="${y(v) + 4}" class="gc-l" text-anchor="end">${v * 100} %</text>`).join('')}
      ${per}<polygon points="${area}" class="wp-area"/><polyline points="${line}" class="wp-line"/>
      ${hoverCols(cols.map(([s]) => x(s)), m.t, H - m.b, tips)}${pen}${gm}
      ${['1.', '2.', '3.'].map((l, i) => `<text x="${x(i * 1200 + 600)}" y="${H - 6}" class="gc-l" text-anchor="middle">${l} erä</text>`).join('')}
    </svg></div>`;
}

// Notable moments the broadcast does not count for you. Each has a game time and a stable key.
// Game time as "2. erä 4:10" (JA for overtime)
const ptime = x => x >= 3600 ? `JA ${mmss(x - 3600)}` : `${Math.floor(x / 1200) + 1}. erä ${mmss(x % 1200)}`;
function liveAlerts(d, t, full, oppName, xgf, xga, sf, sa) {
  const out = [];
  // Runs of shot attempts by one team
  const sh = [...d.shots].filter(x => x.t <= t).sort((a, b) => a.t - b.t);
  // One entry per run of 5+ (about 3–4 per game), keyed by the run's first attempt and showing its final length
  const runs = []; let cur = null;
  for (const x of sh) { if (cur && x.mine === cur.mine) { cur.n++; cur.t = x.t; } else { cur = { mine: x.mine, n: 1, t0: x.t, t: x.t }; runs.push(cur); } }
  const span = (a, b) => Math.floor(a / 1200) === Math.floor(b / 1200) && b < 3600 ? `${Math.floor(a / 1200) + 1}. erä ${mmss(a % 1200)}–${mmss(b % 1200)}` : `${ptime(a)} – ${ptime(b)}`;
  for (const r of runs.filter(r => r.n >= 5)) out.push({ t: r.t0, key: `run${r.t0}`, tone: r.mine ? 'pos' : 'neg',
    txt: `🌊 ${r.mine ? 'SaiPa' : esc(oppName)} ${r.n}–0 laukausyrityksissä · ${r === cur ? `jatkuu, alkoi ${ptime(r.t0)}` : span(r.t0, r.t)}` });
  // No SaiPa attempt in the last 5 minutes
  const lastMine = [...sh].reverse().find(x => x.mine);
  if (t > 600 && (!lastMine || t - lastMine.t >= 300)) out.push({ t, key: `dry${Math.floor(t / 300)}`, txt: `SaiPalta ei laukausyritystä ${Math.floor((t - (lastMine?.t || 0)) / 60)} minuuttiin`, tone: 'neg' });
  // Goals: score home-first, scorer, assists and the situation (YV/AV/TM...)
  for (const g of d.goals.filter(x => x.t <= t)) out.push({ t: g.t, key: `goal${g.t}${g.valid}`,
    txt: g.valid ? `🚨 Maali ${esc(g.score)}${g.types.length ? ` (${esc(g.types.join(', '))})` : ''} · ${g.mine ? 'SaiPa' : esc(oppName)}: <b>${esc(g.scorer)}</b>${g.assists.length ? ` <span class="muted">(${g.assists.map(esc).join(', ')})</span>` : ''}` : `Hylätty maali · ${g.mine ? 'SaiPa' : esc(oppName)}`,
    tone: g.valid ? (g.mine ? 'pos goal' : 'neg goal') : '' });
  // Penalties: state who got what. Whistles at the same moment are one line, and no PP/PK claim is made here
  // (simultaneous penalties often cancel out; the strip under the score shows the real manpower).
  const penAt = new Map();
  for (const p of d.penalties.filter(p => p.t <= t)) { if (!penAt.has(p.t)) penAt.set(p.t, []); penAt.get(p.t).push(p); }
  for (const [pt, ps] of penAt) {
    const one = p => `${esc(p.player)}${p.name ? `, ${esc(p.name)}` : ''} ${p.min} min`;
    const side = mine => ps.filter(p => p.mine === mine);
    const parts = (d.home ? [[true, 'SaiPa'], [false, esc(oppName)]] : [[false, esc(oppName)], [true, 'SaiPa']]).filter(([m]) => side(m).length).map(([m, n]) => `${n}: ${side(m).map(one).join(' · ')}`);
    const both = side(true).length && side(false).length;
    out.push({ t: pt, key: `pen${pt}${ps.map(p => p.player).join('')}`, txt: `${ps.length > 1 ? 'Jäähyt' : 'Jäähy'} · ${parts.join(' | ')}`, tone: both ? '' : side(true).length ? 'neg' : 'pos' });
  }
  // Goalie and finishing
  const gk = full.goalies.find(x => x.played);
  if (gk && gk.gsax >= 1) out.push({ t, key: `gkp${gk.id}`, txt: `${/^piiroinen$/i.test(gk.last) ? '<b>PII-ROI-NEN!</b>' : esc(gk.last)} ${signed(gk.gsax, 1)} GSAx: torjunut selvästi enemmän kuin laukaisupaikat antaisivat odottaa`, tone: 'pos' });
  if (gk && gk.gsax <= -1) out.push({ t, key: `gkn${gk.id}`, txt: `${esc(gk.last)} ${signed(gk.gsax, 1)} GSAx: torjunnat jäävät odotetusta`, tone: 'neg' });
  if (xgf != null && xgf - xga >= 0.8 && sf < sa) out.push({ t, key: `xgl${sf}${sa}`, txt: `SaiPa luo maalipaikkoja, mutta on silti tappiolla (xG ${hf(d.home, num(xgf, 1), num(xga, 1)).join('–')})`, tone: 'pos' });
  if (xgf != null && xga - xgf >= 0.8 && sf > sa) out.push({ t, key: `xgw${sf}${sa}`, txt: `SaiPa johtaa, vaikka ${esc(oppName)} luo enemmän maalipaikkoja (xG ${hf(d.home, num(xgf, 1), num(xga, 1)).join('–')})`, tone: 'neg' });
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
    <table class="mini lv-pvt"><tr><th>Ennakko</th><th></th><th data-tip="${esc('Goals + Assists\nMaalit + syötöt')}">G+A</th><th data-tip="${esc('Individual Corsi For\nPelaajan laukausyritykset')}">iCF</th><th data-tip="${esc('Expected Goals\nMaaliodottama')}">xG</th></tr>
    ${picks.map(k => { const p = tonight.get(k.p.id); return `<tr><td><span class="lv-k">${k.k.replace(/<[^>]+>/g, '')}</span><br><b>${esc(k.p.first)} ${esc(k.p.last)}</b> <small class="muted">${k.v}</small></td><td></td>
      ${p && p.toi ? `<td><b>${p.g}+${p.a}</b></td><td>${p.shots}</td><td>${num(p.ixg, 2)}</td>` : '<td colspan="3" class="muted">ei vielä jäällä</td>'}</tr>`; }).join('')}</table></div>`;
  return `<div class="lv-sec"><h3>Ennakko vs. tänään</h3><div class="grid2 flat">${rows.map(block).join('')}</div></div>`;
}

// SaiPa's ice time so far, and who was on the ice for the latest goal
function iceHtml(full, d, g, per) {
  const sk = full.people.filter(p => !p.goalie && p.toi);
  if (!sk.length) return '';
  // One scale for everyone; each bar is split by period so the current period's share is visible
  const max = Math.max(...sk.map(p => p.toi)), nP = Math.max(1, Math.min(4, per));
  const PL = ['1. erä', '2. erä', '3. erä', 'JA'];
  const row = p => {
    const segs = [1, 2, 3, 4].slice(0, nP).map(k => [k, p.toiP?.[k] || 0]);
    const known = segs.reduce((s, [, v]) => s + v, 0), rest = Math.max(0, p.toi - known);
    const tip = `${p.first} ${p.last} · ${posEn(p.role)}\nTOI\t${mmss(p.toi)}${segs.map(([k, v]) => `\n${PL[k - 1]}\t${mmss(v)}`).join('')}${rest > 5 ? `\nEi vielä eräkohtaisena\t${mmss(rest)}` : ''}\nG+A\t${p.g}+${p.a}\nC+/-\t${signed(p.cf - p.ca, 0)}`;
    return `<div class="lv-ice" data-tip="${esc(tip)}"><span>${esc(p.last)}</span><div class="lv-ice-bar" style="width:${p.toi / max * 100}%">${segs.map(([k, v]) => v ? `<i class="p${k}${k === per ? ' now' : ''}" style="flex:${v}"></i>` : '').join('')}${rest > 5 ? `<i class="p0" style="flex:${rest}"></i>` : ''}</div><b>${mmss(p.toi)}</b></div>`;
  };
  const isD = p => /^(VP|OP|P)$/.test(p.role);
  const group = (title, arr) => arr.length ? `<div class="lv-ice-g"><h4>${title}</h4>${arr.sort((a, b) => b.toi - a.toi).map(row).join('')}</div>` : '';
  const rows = group('Puolustajat', sk.filter(isD)) + group('Hyökkääjät', sk.filter(p => !isD(p)));
  const legend = `<div class="legend lv-ice-leg">${[1, 2, 3, 4].slice(0, nP).map(k => `<span><i class="p${k}"></i>${PL[k - 1]}</span>`).join('')}</div>`;
  return `<div class="lv-sec"><h3>Peliaika tähän asti</h3>${legend}<div class="lv-ices">${rows}</div></div>`;
}

// Summary of the latest finished period: star, xG and attempts
// Finished periods, one row each (kept for the rest of the game) plus a total row; the latest is highlighted
// during an intermission. Team columns are home–away.
function periodBreakHtml(g, st, ctx, t, home, intermission, d) {
  const n = Math.min(3, Math.floor(t / 1200));
  if (t <= 0) return '';
  const sum = periodSummary(g, st, home);
  const H = esc(g.game.homeTeam.teamName), A = esc(g.game.awayTeam.teamName);
  const pair = (s, o) => hf(home, s, o).join('–');
  const inP = (x, k) => x.t > (k - 1) * 1200 && x.t <= k * 1200;
  const cnt = (arr, mine) => arr.filter(x => x.mine === mine).length;
  // Goals, SOG, CF and PIM come from the event data (always current); xG and puck control only from period stats
  const stats = ks => {
    const r = ks.map(k => sum.find(x => x.n === k)).filter(Boolean), full = r.length === ks.length;
    const add = f => r.reduce((s2, x) => s2 + (x[f] || 0), 0);
    const sh = d.shots.filter(x => x.t <= t && ks.some(k => inP(x, k))), sog = sh.filter(x => x.type === 'GOAL' || x.type === 'GOALIE_BLOCKED');
    const hasSm = d.shots.length > 0;
    const pen = d.penalties.filter(x => x.called <= t && ks.some(k => inP({ t: x.called }, k)));
    const pim = mine => pen.filter(x => x.mine === mine).reduce((s2, x) => s2 + (x.min || 0), 0);
    const gl = d.goals.filter(x => x.valid && x.t <= t && ks.some(k => inP(x, k)));
    const ppg = mine => gl.filter(x => x.mine === mine && x.types.some(y => y.startsWith('YV'))).length;
    const pk = full && r.every(x => x.spk != null) ? [add('spk'), add('opk')] : null;
    return { sg: cnt(gl, true), og: cnt(gl, false), sxg: full ? add('sxg') : null, oxg: full ? add('oxg') : null,
      ssh: hasSm ? cnt(sh, true) : full ? add('ssh') : null, osh: hasSm ? cnt(sh, false) : full ? add('osh') : null,
      ssog: cnt(sog, true), osog: cnt(sog, false), spim: pim(true), opim: pim(false), sppg: ppg(true), oppg: ppg(false), pk, hasSm };
  };
  const cells = (r, starHtml) => {
    const pkPct = r.pk && r.pk[0] + r.pk[1] ? r.pk[0] / (r.pk[0] + r.pk[1]) : null;
    return `<td>${pair(r.sg, r.og)}${r.sppg || r.oppg ? `<small> YV ${pair(r.sppg, r.oppg)}</small>` : ''}</td><td>${r.sxg == null ? '–' : pair(num(r.sxg, 1), num(r.oxg, 1))}</td>
      <td>${r.hasSm ? pair(r.ssog, r.osog) : '–'}</td><td>${r.ssh == null ? '–' : pair(r.ssh, r.osh)}</td>
      <td>${pkPct == null ? '–' : `${pair(Math.round(pkPct * 100), 100 - Math.round(pkPct * 100))}<small> %</small>`}</td><td>${pair(r.spim, r.opim)}</td>${starHtml}`;
  };
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const r = stats([k]); if (!r) continue;
    const star = analyzeGame(g, st, k, ctx).people[0];
    rows.push(`<tr class="${intermission && k === n ? 'on' : ''}"><th>${k}. erä</th>${cells(r, `<td class="lv-star"${star ? ` data-tip="${esc(`${star.first} ${star.last}\nGS\t${num(star.gs, 2)}\nG+A\t${star.g}+${star.a}\niCF\t${star.shots}`)}"` : ''}>${star ? `${esc(star.last)}<small> ${num(star.gs, 2)}</small>` : '–'}</td>`)}</tr>`);
  }
  // The period in progress: live row from event data, marked as running
  const cur = !g.game.ended && !intermission && t % 1200 !== 0 && t < 3600 ? Math.floor(t / 1200) + 1 : null;
  if (cur) rows.push(`<tr class="run"><th>${cur}. erä<small> käynnissä</small></th>${cells(stats([cur]), '<td>–</td>')}</tr>`);
  if (!rows.length) return '';
  const done = [1, 2, 3].slice(0, cur || n);
  if (done.length > 1) rows.push(`<tr class="tot"><th>Yhteensä</th>${cells(stats(done), '<td></td>')}</tr>`);
  const th = (abbr, en, fi) => `<th data-tip="${esc(`${en}\n${fi}, ${H}–${A}`)}">${abbr}</th>`;
  return `<div class="lv-sec lv-brk ${intermission ? 'on' : ''}"><h3>${intermission ? `☕ Erätauko · ${n}. erä päättyi` : 'Erät'}</h3>
    <div class="tbl-wrap"><table class="lv-ptab"><thead><tr><th></th>${th('G', 'Goals', 'Maalit (YV = ylivoimamaalit)')}${th('xG', 'Expected Goals', 'Maaliodottama')}${th('SOG', 'Shots on Goal', 'Laukaukset maalia kohti')}${th('CF', 'Corsi For', 'Laukausyritykset: maalia kohti, ohi ja blokatut')}${th('PC%', 'Puck Control', 'Kiekonhallinta-aika osuutena')}${th('PIM', 'Penalties in Minutes', 'Jäähyminuutit')}<th data-tip="${esc('SaiPan paras pelipisteillä (GS)')}">⭐ Erän tähti</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div></div>`;
}

function liveToggleNotify(btn) {
  if (!('Notification' in window)) { btn.textContent = 'Selain ei tue ilmoituksia'; return; }
  Notification.requestPermission().then(p => { liveNotify = p === 'granted'; btn.textContent = liveNotify ? '🔔 Ilmoitukset päällä' : 'Ilmoitukset estetty'; });
}

// Estimated game time now: runs at the pace of the last interval, never more than 45 s ahead of the data
function liveNow() {
  if (!liveClock) return null;
  const dt = (Date.now() - liveClock.wall) / 1000;
  return Math.min(liveClock.t + liveClock.rate * dt, liveClock.t + 45, liveClock.cap);
}
function liveTickDraw(box) {
  const t = liveNow(); if (t == null || !box.isConnected) return;
  box.querySelectorAll('[data-clk]').forEach(el => { el.textContent = `${el.dataset.pre}${mmss(Math.max(0, t - Number(el.dataset.clk)))}`; });
  box.querySelectorAll('[data-cd]').forEach(el => { el.textContent = `${mmss(Math.max(0, Number(el.dataset.cd) - t))} jäljellä`; });
  box.querySelectorAll('[data-wcd]').forEach(el => { const left = (Number(el.dataset.wcd) - Date.now()) / 1000; el.textContent = left > 0 ? `${mmss(Math.ceil(left))} jäljellä` : 'alkaa pian'; });
  box.querySelectorAll('[data-wbar]').forEach(el => { const [a, b] = el.dataset.wbar.split(',').map(Number); el.style.width = `${Math.max(0, Math.min(100, (b - Date.now()) / Math.max(1, b - a) * 100))}%`; });
  box.querySelectorAll('[data-bar]').forEach(el => { const [a, b] = el.dataset.bar.split(',').map(Number); el.style.width = `${Math.max(0, Math.min(100, (b - t) / Math.max(1, b - a) * 100))}%`; });
}

async function renderLive(id, box) {
  clearTimeout(liveTimer); clearInterval(liveTick); liveClock = null; liveLog = [];
  liveSeen = new Set(); liveFirstT = new Map();
  box.innerHTML = '<p class="loading">Haetaan live-dataa…</p>';
  const next = LIVE_REPLAY ? (await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`)).find(g => String(g.id) === String(id)) : nextGameRow;
  const pre = await loadForecast(next, next.start).then(F => F?.p).catch(() => null);
  const teams = new Map([[teamNum(next.homeTeamId), next.homeTeamName], [teamNum(next.awayTeamId), next.awayTeamName]]);
  let pvt = null, first = true;
  const draw = async () => {
    if (!box.isConnected) { clearTimeout(liveTimer); clearInterval(liveTick); return; }
    let g, st, sm;
    try { [g, st, sm] = await liveFetch(id); } catch (e) {
      const s = box.querySelector('.lv-stamp'); if (s) s.textContent = `päivitys epäonnistui (${e.message}), yritetään uudelleen`;
      return;
    }
    const G = g.game, home = isSaipa(G.homeTeam.teamId);
    if (!G.started) {
      box.innerHTML = `<div class="lv-panel"><div class="lv-head"><span class="lv-dot"></span><b>${esc(G.homeTeam.teamName)}–${esc(G.awayTeam.teamName)}</b><span>alkaa klo ${new Date(G.start).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Helsinki' })}</span><span class="lv-stamp">päivitetty ${new Date().toLocaleTimeString('fi-FI')}</span></div>
        ${pre ? `<div class="chips"><span class="chip"><small>SaiPan voitto, ennuste</small><b>${pct(liveWinProb(pre, { h: 0, a: 0 }, 0, home), 0)}</b></span></div>` : ''}<p class="muted small">Päivittyy itsestään 30 sekunnin välein.</p></div>`;
      liveNextMs = 30000;
      return;
    }
    const smA = Array.isArray(sm) ? sm : [], ctx = { sm: smA, sogFallback: null };
    const t = G.gameTime || 0, per = G.currentPeriod || Math.min(4, Math.floor(t / 1200) + 1);
    const intermission = !G.ended && t > 0 && t % 1200 === 0 && t < 3600;
    // Clock sync: pace = how much the game clock moved per real second since the previous fetch (0 when play is stopped)
    { const now = Date.now(), prev = liveClock, moved = prev ? t - prev.t : 0;
      const rate = G.ended || intermission || LIVE_REPLAY || !prev ? 0 : Math.max(0, Math.min(1, moved / Math.max(1, (now - prev.wall) / 1000)));
      if (prev && moved) liveLog.push(now); liveLog = liveLog.slice(-20);
      liveClock = { t, wall: now, rate, cap: per > 3 ? 3900 : per * 1200 };
      liveNextMs = LIVE_POLL_MS;
      if (intermission && !LIVE_REPLAY) {
        const k = `lvbrk:${id}:${t / 1200}`;
        if (liveBreak?.k !== k) {
          let w = null; try { w = Number(sessionStorage.getItem(k)) || null; } catch (e) { /* storage blocked */ }
          // Saw the period end happen (clock was running before this poll): the break started about now
          if (!w && prev && prev.t < t) w = now;
          if (w) try { sessionStorage.setItem(k, String(w)); } catch (e) { /* storage blocked */ }
          liveBreak = { k, start: w, end: w ? w + breakLen(G.start) * 1000 : null };
        }
        const left = liveBreak.end ? liveBreak.end - now : null;
        // Slow polling in the break, back to normal from one minute before the estimated restart
        liveNextMs = left == null ? 30000 : left <= 60000 ? LIVE_POLL_MS : Math.min(LIVE_POLL_BREAK_MS, left - 60000 + 500);
      } else if (!intermission) liveBreak = null; }
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
    // Transient states: shown in a separate strip under the score, only while they are true
    const nowItems = [];
    if (!G.ended && pk.length && pk.length === pp.length) {
      const n = Math.max(3, 5 - pk.length), all = [...pk, ...pp], end = Math.min(...all.map(p => p.end));
      nowItems.push(`<div class="lv-now-i mid" data-tip="${esc(`Molemmilla jäähy\n${all.map(p => `${p.mine ? 'SaiPa' : O.teamName}: ${p.player} ${p.min} min`).join('\n')}`)}"><b>Tasavajaa</b><span>${n} v ${n}</span><span class="lv-cd" data-cd="${end}">${mmss(Math.max(0, end - t))} jäljellä</span></div>`);
    }
    if (!G.ended && pk.length !== pp.length) {
      const mineDown = pk.length > pp.length, arr = mineDown ? pk : pp, end = Math.max(...arr.map(p => p.end)), start = Math.min(...arr.map(p => p.t));
      const us = Math.max(3, 5 - pk.length), them = Math.max(3, 5 - pp.length);
      const who = arr.map(p => `${p.player}${p.name ? `, ${p.name}` : ''} ${p.min} min`).join('\n');
      nowItems.push(`<div class="lv-now-i ${mineDown ? 'neg' : 'pos'}" data-tip="${esc(`${mineDown ? 'Jäähyllä (SaiPa)' : `Jäähyllä (${O.teamName})`}\n${who}`)}"><b>${mineDown ? 'Alivoima' : 'Ylivoima'}</b><span>SaiPa ${us} v ${them}</span><span class="lv-cd" data-cd="${end}">${left(arr)} jäljellä</span><i data-bar="${start},${end}" style="width:${Math.max(0, Math.min(100, (end - t) / Math.max(1, end - start) * 100))}%"></i></div>`);
    }
    if (intermission) { const be = liveBreak?.end;
      nowItems.push(`<div class="lv-now-i mid" data-tip="${esc(be ? `Erätauko ${breakLen(G.start) / 60} min (${breakLen(G.start) === 1200 ? 'viikonloppu' : 'arkipäivä'})\nTauko alkoi noin klo ${new Date(liveBreak.start).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}\nArvio: ${t / 1200 + 1}. erä alkaa klo ${new Date(be).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}` : 'Tauon alkuhetki ei ole tiedossa, koska sivu avattiin kesken tauon')}"><b>Erätauko</b><span>${t / 1200}. erä päättyi</span>${be ? `<span class="lv-cd" data-wcd="${be}">${mmss(Math.max(0, Math.ceil((be - Date.now()) / 1000)))} jäljellä</span>` : ''}${be ? `<i data-wbar="${liveBreak.start},${be}" style="width:${Math.max(0, Math.min(100, (be - Date.now()) / (be - liveBreak.start) * 100))}%"></i>` : ''}</div>`); }
    const lastGoal = d.goals.filter(x => x.valid && x.t <= t).pop();
    if (lastGoal && t - lastGoal.t <= 120 && !intermission) nowItems.push(`<div class="lv-now-i ${lastGoal.mine ? 'pos' : 'neg'}"><b>🚨 Maali</b><span>${esc(lastGoal.score)} · ${esc(lastGoal.scorer)}</span><span class="lv-cd">${mmss(t - lastGoal.t)} sitten</span></div>`);
    // Unanswered shot attempts by one team (e.g. 9–0), shown while still going
    { const sh = d.shots.filter(x => x.t <= t).sort((a, b) => a.t - b.t); let n = 0, who = null, t0 = 0;
      for (const x of sh) { if (x.mine === who) n++; else { who = x.mine; n = 1; t0 = x.t; } }
      const lastShot = sh[sh.length - 1];
      if (n >= 5 && lastShot && t - lastShot.t <= 90 && !intermission) nowItems.push(`<div class="lv-now-i ${who ? 'pos' : 'neg'}" data-tip="${esc(`Vastaamattomat laukausyritykset\n${who ? 'SaiPa' : O.teamName} ${n}, ${who ? O.teamName : 'SaiPa'} 0\nAlkoi\t${ptime(t0)}`)}"><b>🌊 ${who ? 'SaiPa' : esc(O.teamName)} ${n}–0</b><span>laukausyritykset putkeen</span><span class="lv-cd">${mmss(t - t0)}</span></div>`); }
    { const lastMine = d.shots.filter(x => x.mine && x.t <= t).pop(), dry = t - (lastMine?.t || 0);
      if (!G.ended && !intermission && t > 600 && dry >= 300) nowItems.push(`<div class="lv-now-i neg"><b>Kuiva kausi</b><span>SaiPalta ei laukausyritystä</span><span class="lv-cd">${Math.floor(dry / 60)} min</span></div>`); }
    // Always rendered (empty when nothing is on) so the sticky header keeps one height and the page does not jump
    const nowItemsHtml = nowItems.join('');
    const full = analyzeGame(g, st, null, ctx);
    const star = full.people.filter(p => !p.goalie)[0], gk = full.goalies.find(x => x.played);
    const oppName = O.teamName;
    // Pressure bar: SaiPa's share of attempts in each of the last five minutes
    const hn = G.homeTeam.teamName, an = G.awayTeam.teamName;
    const bars = [4, 3, 2, 1, 0].map(k => { const w = d.shots.filter(x => x.t > t - (k + 1) * 60 && x.t <= t - k * 60), a = w.filter(x => x.mine).length, b = w.length - a; const [hv, av] = hf(home, a, b); return `<i class="${a > b ? 's' : b > a ? 'o' : ''}" data-tip="${esc(`${k ? `${k}–${k + 1} min sitten` : 'viimeinen minuutti'}\n${hn}\t${hv}\n${an}\t${av}`)}"></i>`; }).join('');
    // The five permanent tiles: always present (a dash when data is missing), so the grid never changes shape
    const tiles = [
      wp != null ? tile('📊', 'Voitto\u00adtodennäköisyys', pct(wp, 0), '', null, `ennen ottelua ${pct(wp0, 0)}`, wp >= wp0 ? 'pos' : 'neg',
        'SaiPan voittotodennäköisyys nyt\nNykyinen tilanne + ennusteen maalitahti jäljellä olevalle ajalle\nTasapeli 60 minuutin jälkeen lasketaan puolikkaaksi')
        : tile('📊', 'Voitto\u00adtodennäköisyys', G.ended ? (sf > sa ? 'Voitto' : sf < sa ? 'Tappio' : '–') : '–', '', null, G.ended ? 'ottelu päättyi' : 'ei ennustetta'),
      tile('🎯', 'Maalipaikat (xG)', xgf != null ? `${num(home ? xgf : xga, 1)}–${num(home ? xga : xgf, 1)}` : '–', '', null, xgf != null ? `${pre ? `ennuste ${num(pre.lh, 1)}–${num(pre.la, 1)} · ` : ''}SaiPa ${signed(sf - xgf, 1)} G−xG` : 'ei dataa', '',
        `Expected Goals\nMaaliodottama: kuinka monta maalia laukaisupaikoista tulisi keskimäärin, ${hn}–${an}\nG−xG: SaiPan maalit miinus maaliodottama. Plus = maaleja enemmän kuin paikat antaisivat odottaa.`),
      `<div class="tile ${rm > ro + 2 ? 'pos' : ro > rm + 2 ? 'neg' : ''}" data-tip="${esc(`Corsi For\nLaukausyritykset viimeisen 5 minuutin aikana, ${hn}–${an}\nMukana maalia kohti, ohi ja blokatut laukaukset\nPalkki = minuutti kerrallaan, korkeus = yritysten määrä`)}"><div class="t-top"><span class="t-ic">🌊</span><span class="k">Painostus, 5 min</span></div><div class="v">${home ? rm : ro}–${home ? ro : rm}<small>CF</small></div><div class="lv-bars">${bars}</div><div class="t-sub">laukausyritykset · ${rm > ro + 2 ? 'SaiPa painostaa' : ro > rm + 2 ? `${esc(oppName)} painostaa` : 'tasaista'}</div></div>`,
      star ? tile('⭐', 'SaiPan paras nyt', num(star.gs, 2), 'GS', star, `${star.g}+${star.a} · ${star.shots} laukausyritystä · ${mmss(star.toi)}`, '',
        `Game Score\nPelipisteet: maalit, syötöt, laukaukset, kentällä-tilastot ja muut yhteen painotettuna\nMaalit + syötöt\t${star.g}+${star.a}\nLaukausyritykset\t${star.shots}\nPeliaika\t${mmss(star.toi)}`) : tile('⭐', 'SaiPan paras nyt', '–', '', null, 'pelaajatilastot päivittyvät'),
      gk ? tile('🧤', 'Maalivahti', signed(gk.gsax, 2), 'GSAx', gk, `${gk.saves} torjuntaa · ${gk.ga} päästettyä`, gk.gsax >= 0 ? 'pos' : 'neg',
        'Goals Saved Above Expected\nPlus = torjunut enemmän kuin laukaisupaikat antaisivat odottaa') : tile('🧤', 'Maalivahti', '–', '', null, 'pelaajatilastot päivittyvät'),
    ];
    // Alerts: mark the ones that are new since the last refresh, and notify if the viewer allowed it
    const alerts = liveAlerts(d, t, full, oppName, xgf, xga, sf, sa);
    for (const a of alerts) { if (!liveFirstT.has(a.key)) liveFirstT.set(a.key, a.t); a.t = liveFirstT.get(a.key); }
    alerts.sort((a, b) => b.t - a.t);
    const fresh = alerts.filter(a => !liveSeen.has(a.key));
    if (!first && liveNotify) for (const a of fresh.slice(0, 3)) try { new Notification('SaiPa live', { body: a.txt.replace(/&[a-z#0-9]+;/g, ''), tag: a.key }); } catch (e) { /* not available */ }
    alerts.forEach(a => liveSeen.add(a.key));
    // Header strip: what is on right now, plus a button that opens the full event history (newest first)
    if (liveFeedOpen) liveFeedSeen = alerts.length;
    const unread = Math.max(0, alerts.length - liveFeedSeen);
    const feedList = alerts.length ? `<ul class="lv-feed">${alerts.map(a => `<li class="${a.tone} ${!first && fresh.includes(a) ? 'new' : ''}"><span class="lv-ft"><small>${a.t >= 3600 ? 'Jatkoaika' : `${Math.min(3, Math.floor(a.t / 1200) + 1)}. erä`}</small><b>${mmss(a.t >= 3600 ? a.t - 3600 : a.t % 1200 || (a.t ? 1200 : 0))}</b></span><span class="lv-fx">${a.txt}</span></li>`).join('')}</ul>` : '<p class="muted small">Ei vielä tapahtumia.</p>';
    const pop = `<div class="lv-pop"${liveFeedOpen ? '' : ' hidden'}><div class="lv-pop-h"><b>Tapahtumat</b><button class="sbtn sm lv-nb">${liveNotify ? '🔔 Ilmoitukset päällä' : '🔔 Ilmoitukset'}</button></div>${feedList}</div>`;
    const histBtn = `<button class="lv-hist${liveFeedOpen ? ' on' : ''}" aria-expanded="${liveFeedOpen}">🕘<span class="lbl"> Tapahtumat</span>${alerts.length ? ` <span class="n">${alerts.length}</span>` : ''}${unread && !first ? `<span class="dot" title="${unread} uutta"></span>` : ''}</button>`;
    const nowStrip = G.ended ? `<div class="lv-now">${histBtn}</div>${pop}` : `<div class="lv-now">${nowItemsHtml}${histBtn}</div>${pop}`;
    if (!pvt) pvt = await previewVsTonight(next, g, st).catch(() => null);
    else for (const r of pvt) r.tonight = new Map(teamGame(g, st, r.tid, next).players.map(p => [p.id, p]));
    const clock = G.ended ? 'Päättynyt' : intermission ? `Erätauko ${t / 1200}.–${t / 1200 + 1}.` : per > 3 ? `<span data-clk="3600" data-pre="Jatkoaika ">Jatkoaika ${mmss(t - 3600)}</span>` : `<span data-clk="${(per - 1) * 1200}" data-pre="${per}. erä ">${per}. erä ${mmss(t - (per - 1) * 1200)}</span>`;
    const gaps = liveLog.slice(1).map((w, i) => Math.round((w - liveLog[i]) / 1000));
    const stampTip = `Haku ${liveNextMs / 1000} s välein\nKello liikkui viime välillä\t${pct(liveClock.rate, 0)} reaaliajasta${gaps.length ? `\nData muuttui (s välein)\t${gaps.slice(-8).join(', ')}` : ''}`;
    box.innerHTML = `<div class="lv-panel">
      <div class="lv-head">${G.ended ? '' : '<span class="lv-dot"></span>'}<b>${esc(G.homeTeam.teamName)} ${score.h}–${score.a} ${esc(G.awayTeam.teamName)}</b><span>${clock}</span><span class="lv-stamp" data-tip="${esc(stampTip)}">päivitetty ${new Date().toLocaleTimeString('fi-FI')}</span>${nowStrip}</div>
      <div class="tiles lv-tiles">${tiles.join('')}</div>
      ${periodBreakHtml(g, st, ctx, t, home, intermission, d)}
      ${wpChart(pre, d, t, home)}
      ${pvt ? pvtHtml(pvt, teams) : ''}
      ${iceHtml(full, d, g, per)}
      ${G.ended ? '<p class="muted small">Ottelu on päättynyt. Lataa sivu uudelleen, niin raportti avautuu Ottelu-välilehdelle.</p>' : ''}
    </div><div id="liveReport"></div>`;
    const nb = box.querySelector('.lv-nb'); if (nb) nb.onclick = () => liveToggleNotify(nb);
    const hb = box.querySelector('.lv-hist'), popEl = box.querySelector('.lv-pop');
    if (hb && popEl) hb.onclick = e => { e.stopPropagation(); liveFeedOpen = popEl.hidden; popEl.hidden = !liveFeedOpen; hb.classList.toggle('on', liveFeedOpen); hb.setAttribute('aria-expanded', liveFeedOpen);
      if (liveFeedOpen) { liveFeedSeen = alerts.length; hb.querySelector('.dot')?.remove(); } };
    if (popEl) popEl.onclick = e => e.stopPropagation();
    if (!liveFeedDocBound) { liveFeedDocBound = true; document.addEventListener('click', () => { if (!liveFeedOpen) return; liveFeedOpen = false; document.querySelectorAll('.lv-pop').forEach(x => x.hidden = true); document.querySelectorAll('.lv-hist').forEach(x => x.classList.remove('on')); }); }
    const keep = [SK_SET, GK_SET];
    await renderGame(id, $('#liveReport', box));
    [SK_SET, GK_SET] = keep;
    // Keep the chosen period across refreshes
    const pb = box.querySelector(`#liveReport .pbtn[data-p="${livePeriod}"]`);
    if (pb && livePeriod !== 'all') pb.click();
    box.querySelectorAll('#liveReport .pbtn').forEach(b => b.addEventListener('click', () => { livePeriod = b.dataset.p; }));
    first = false;
    if (LIVE_REPLAY) replayControls(box, draw, (replayRaw.g.game.gameTime || 3600) > 3600 ? replayRaw.g.game.gameTime : 3600);
    if (G.ended) { liveNextMs = 0; clearInterval(liveTick); }
  };
  await draw();
  if (LIVE_REPLAY) return;
  liveTick = setInterval(() => { if (!document.hidden) liveTickDraw(box); }, 1000);
  // Poll with setTimeout so the interval can change (intermission) and requests never overlap
  const loop = async () => { if (!liveNextMs || !box.isConnected) return; if (!document.hidden) await draw(); if (liveNextMs) liveTimer = setTimeout(loop, liveNextMs); };
  liveTimer = setTimeout(loop, liveNextMs);
}
