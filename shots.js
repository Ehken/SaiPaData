/* SaiPa Data: shot maps, team shot profiles, goalie maps, deserved standings and game-state splits.
 * Uses helpers from app.js and preview.js (esc, num, pct, signed, getJSON, SEASON, SAIPA_NUM, teamNum, isSog, validGoal, logoImg, gen). */

/* ---------- rink geometry ----------
 * Shot map coordinates: x 0–1000 along the rink, y 0–510 across it (60 m × 30 m, ≈16.7 units per metre).
 * The left team attacks the right net and the teams switch ends between periods.
 * normShot() rotates every shot so that the shooting team attacks the right net (x = 933, y = 255). */
const RINK = { w: 1000, h: 510, goalX: 933, cy: 255, blue: 650, perM: 16.7 };
// Zones follow the NHL EDGE definitions in SI units: distance from the centre of the goal, bounded on both
// sides by lines from the faceoff dot to 0.6 m outside the goal post. Outside those lines = wings.
const ZG = (() => {
  const m = RINK.perM, y0 = 15 + 0.6 * m;            // post at 15 units from the centre (net 30 units wide)
  return { r1: 8.8 * m, r2: 13.1 * m, y0, k: (119 - y0) / 100 };   // faceoff dot 100 units out, 119 to the side
})();
const ZONES = [
  { k: 'slot', l: 'Maalin edusta', from: 'maalin edestä', d: 'Maalin edusta (NHL:n High-Danger): enintään 8,8 m maalin keskeltä, sivuilla aloituspisteestä 0,6 m maalitolpan ulkopuolelle kulkevat linjat' },
  { k: 'mid', l: 'Keskietäisyys', from: 'keskietäisyydeltä', d: 'Keskietäisyys (NHL:n Mid-Range): 8,8–13,1 m maalin keskeltä samojen linjojen sisällä' },
  { k: 'long', l: 'Kaukaa', from: 'kaukaa', d: 'Kaukaa (NHL:n Long-Range): yli 13,1 m maalin keskeltä hyökkäysalueella samojen linjojen sisällä' },
  { k: 'wing', l: 'Laidat', from: 'laidoilta', d: 'Laidat: linjojen ulkopuolelta maaliviivan edestä' },
  { k: 'behind', l: 'Maalin takaa', from: 'maalin takaa', d: 'Maaliviivan takaa' },
];
const SITU = { EvenStrengthShot: 'TV', PowerplayShot: 'YV', ShorthandedShot: 'AV' };

function normShot(s) {
  const flip = s.shootingTeamId !== s.leftTeam;
  const x = flip ? RINK.w - s.shotX : s.shotX, y = flip ? RINK.h - s.shotY : s.shotY;
  return { ...s, x, y, zone: zoneOf(x, y), situ: SITU[s.type] || 'TV', sog: isSog(s), goal: s.eventType === 'GOAL' };
}
function zoneOf(x, y) {
  const dx = RINK.goalX - x, dy = Math.abs(y - RINK.cy);
  if (dx < 0) return 'behind';
  if (dy > ZG.y0 + ZG.k * dx) return 'wing';
  const d = Math.hypot(dx, dy);
  return d <= ZG.r1 ? 'slot' : d <= ZG.r2 ? 'mid' : 'long';
}
// Zone outlines for the right net. P(r, ±1) = where a side line meets the circle of radius r around the goal.
function zgPoint(r, side) {
  const { y0, k } = ZG, a = 1 + k * k, b = 2 * y0 * k, c = y0 * y0 - r * r;
  const dx = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return [RINK.goalX - dx, RINK.cy + side * (y0 + k * dx)];
}
function zonePaths() {
  const gx = RINK.goalX, cy = RINK.cy, { r1, r2, y0, k } = ZG, f = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  const a1 = zgPoint(r1, -1), b1 = zgPoint(r1, 1), a2 = zgPoint(r2, -1), b2 = zgPoint(r2, 1);
  const edge = (cy - 2 - y0) / k;                    // side line meets the boards this far out
  const tE = [gx - edge, 2], bE = [gx - edge, 508];
  return {
    slot: `M ${gx} ${cy - y0} L ${f(a1)} A ${r1} ${r1} 0 0 0 ${f(b1)} L ${gx} ${cy + y0} Z`,
    mid: `M ${f(a1)} L ${f(a2)} A ${r2} ${r2} 0 0 0 ${f(b2)} L ${f(b1)} A ${r1} ${r1} 0 0 1 ${f(a1)} Z`,
    long: `M ${f(a2)} L ${f(tE)} L ${RINK.blue} 2 L ${RINK.blue} 508 L ${f(bE)} L ${f(b2)} A ${r2} ${r2} 0 0 1 ${f(a2)} Z`,
    wingL: `M ${gx} ${cy - y0} L ${f(tE)} L ${gx} 2 Z`,
    wingR: `M ${gx} ${cy + y0} L ${f(bE)} L ${gx} 508 Z`,
    behind: `M ${gx} 2 H 998 V 508 H ${gx} Z`,
  };
}
// Shooter's side: facing the right net, y < 255 is the shooter's left.
const sideOf = s => s.y < RINK.cy ? 'vasen' : 'oikea';

/* ---------- SVG ---------- */
function rinkLines(half) {
  const c = (x, y, r, cls = 'rk-l') => `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>`;
  const dot = (x, y) => `<circle class="rk-dot" cx="${x}" cy="${y}" r="6"/>`;
  const end = (gx, dir) => `
    <line class="rk-red" x1="${gx}" y1="18" x2="${gx}" y2="492"/>
    <path class="rk-crease" d="M ${gx} 225 A 30 30 0 0 ${dir > 0 ? 0 : 1} ${gx} 285 Z"/>
    <rect class="rk-net" x="${dir > 0 ? gx : gx - 18}" y="240" width="18" height="30"/>
    ${c(gx - dir * 100, 136, 76)}${c(gx - dir * 100, 374, 76)}${dot(gx - dir * 100, 136)}${dot(gx - dir * 100, 374)}`;
  return `
    ${half ? '' : `<rect class="rk-ice" x="2" y="2" width="996" height="506" rx="140"/>`}
    ${half ? `<path class="rk-ice" d="M 500 2 H 858 A 140 140 0 0 1 998 142 V 368 A 140 140 0 0 1 858 508 H 500 Z"/>` : ''}
    ${half ? '' : `<line class="rk-blue" x1="350" y1="2" x2="350" y2="508"/>`}
    <line class="rk-blue" x1="${RINK.blue}" y1="2" x2="${RINK.blue}" y2="508"/>
    <line class="rk-red" x1="500" y1="2" x2="500" y2="508"/>
    ${half ? '' : c(500, 255, 76) + end(67, -1)}
    ${end(RINK.goalX, 1)}`;
}
// Slot (NHL High-Danger) outline for the right net
const slotBox = () => `<path class="rk-slot" d="${zonePaths().slot}"><title>${ZONES[0].d}</title></path>`;

function marker(s, cls) {
  const t = `${s.goal ? 'Maali' : s.eventType === 'GOALIE_BLOCKED' ? 'Torjuttu' : s.eventType === 'PLAYER_BLOCKED' ? 'Blokattu' : 'Ohi'} · ${s.situ}${s.label ? ' · ' + s.label : ''}`;
  // A goal whose scorer was corrected from the official goal events gets a dashed ring and a note
  const fix = s.goal && s.mapShooterId ? `\nTekijä korjattu virallisten maalitietojen mukaan. Liigan laukauskartassa: ${s.mapShooter || 'toinen pelaaja'}` : '';
  if (s.goal) return `<g class="mk ${cls}${fix ? ' mk-fixed' : ''}"><title>${esc(t + fix)}</title>${fix ? `<circle cx="${s.x}" cy="${s.y}" r="22" class="mk-fix"/>` : ''}<circle cx="${s.x}" cy="${s.y}" r="15" class="mk-goal"/><circle cx="${s.x}" cy="${s.y}" r="5" class="mk-goal-c"/></g>`;
  if (s.eventType === 'GOALIE_BLOCKED') return `<circle class="mk ${cls} mk-sog" cx="${s.x}" cy="${s.y}" r="8"><title>${esc(t)}</title></circle>`;
  if (s.eventType === 'PLAYER_BLOCKED') return `<path class="mk ${cls} mk-blk" d="M ${s.x - 6} ${s.y - 6} L ${s.x + 6} ${s.y + 6} M ${s.x + 6} ${s.y - 6} L ${s.x - 6} ${s.y + 6}"><title>${esc(t)}</title></path>`;
  return `<circle class="mk ${cls} mk-miss" cx="${s.x}" cy="${s.y}" r="7"><title>${esc(t)}</title></circle>`;
}
const mapLegend = (fixed = false) => `<div class="sm-legend"><span><i class="lg-goal"></i>Maali</span><span><i class="lg-sog"></i>Torjuttu</span><span><i class="lg-miss"></i>Ohi</span><span><i class="lg-blk">×</i>Blokattu</span>${fixed ? '<span data-tip="Liigan laukauskartassa maalin tekijänä on eri pelaaja kuin virallisissa maalitiedoissa. Sivu käyttää virallista tekijää."><i class="lg-fix"></i>Tekijä korjattu</span>' : ''}</div>`;

/* ---------- SM-1: game shot map ---------- */
// SaiPa attacks the right net and the opponent the left net, for the whole game.
function shotMapCard(sm, g, oppName) {
  if (!sm || !sm.length) return '';
  return `<div class="card" id="shotCard">
    <h2>Laukauskartta</h2>
    <div class="sm-filters">
      <div class="seg" data-f="team"><button data-v="all" class="on">Molemmat</button><button data-v="sai">SaiPa</button><button data-v="opp">${esc(oppName)}</button></div>
      <div class="seg" data-f="situ"><button data-v="all" class="on">Kaikki</button><button data-v="TV">Tasakentällisin</button><button data-v="YV">Ylivoima</button><button data-v="AV">Alivoima</button></div>
      <div class="seg" data-f="kind"><button data-v="all" class="on">Kaikki yritykset</button><button data-v="sog">Maalia kohti</button></div>
      <select class="sm-player"><option value="">Kaikki pelaajat</option></select>
    </div>
    <div class="sm-dir"><span><i class="dot opp"></i>← ${esc(oppName)} hyökkää</span><span>SaiPa hyökkää →<i class="dot sai"></i></span></div>
    <svg viewBox="0 0 1000 510" class="rink" id="shotSvg"></svg>
    ${mapLegend(sm.some(x => x.eventType === 'GOAL' && x.mapShooterId))}
    <div class="sm-sum" id="shotSum"></div>
  </div>`;
}

function initShotMap(box, sm, g, oppName) {
  const card = box.querySelector('#shotCard');
  if (!card) return () => {};
  const names = new Map([...(g.homeTeamPlayers || []), ...(g.awayTeamPlayers || [])].map(p => [p.id, `${p.firstName} ${p.lastName}`]));
  const shots = sm.map(s => {
    const n = normShot(s), mine = s.shootingTeamId === SAIPA_NUM;
    // SaiPa shoots at the right net, the opponent at the left net (rotate back).
    return { ...n, mine, x: mine ? n.x : RINK.w - n.x, y: mine ? n.y : RINK.h - n.y, label: names.get(s.shooterId) || '' };
  });
  const st = { team: 'all', situ: 'all', kind: 'all', player: '', period: null };
  const sel = card.querySelector('.sm-player');
  const players = [...new Set(shots.map(s => s.shooterId))].filter(id => names.has(id))
    .map(id => ({ id, n: names.get(id), mine: shots.find(s => s.shooterId === id).mine, c: shots.filter(s => s.shooterId === id).length }))
    .sort((a, b) => (b.mine - a.mine) || b.c - a.c);
  sel.innerHTML += `<optgroup label="SaiPa">${players.filter(p => p.mine).map(p => `<option value="${p.id}">${esc(p.n)} (${p.c})</option>`).join('')}</optgroup>
    <optgroup label="${esc(oppName)}">${players.filter(p => !p.mine).map(p => `<option value="${p.id}">${esc(p.n)} (${p.c})</option>`).join('')}</optgroup>`;
  const draw = () => {
    const f = shots.filter(s => (st.team === 'all' || (st.team === 'sai') === s.mine)
      && (st.situ === 'all' || s.situ === st.situ) && (st.kind === 'all' || s.sog)
      && (!st.player || String(s.shooterId) === st.player) && (st.period == null || s.period === st.period));
    const order = s => s.goal ? 3 : s.sog ? 2 : 1;
    card.querySelector('#shotSvg').innerHTML = rinkLines(false) + f.sort((a, b) => order(a) - order(b)).map(s => marker(s, s.mine ? 'sai' : 'opp')).join('');
    const sum = side => {
      const a = f.filter(s => s.mine === side);
      return `<b>${a.length}</b> yritystä · <b>${a.filter(s => s.sog).length}</b> maalia kohti · <b>${a.filter(s => s.goal).length}</b> maalia · maalin edestä <b>${a.filter(s => s.zone === 'slot').length}</b>`;
    };
    card.querySelector('#shotSum').innerHTML = `<div><span class="dot sai"></span>SaiPa: ${sum(true)}</div><div><span class="dot opp"></span>${esc(oppName)}: ${sum(false)}</div>
      ${st.period != null ? `<div class="muted small">Näytetään ${PERIOD_LABEL(st.period).toLowerCase()} (valittu eräpainikkeista).</div>` : ''}`;
  };
  card.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.onclick = () => {
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    st[seg.dataset.f] = b.dataset.v; draw();
  }));
  sel.onchange = () => { st.player = sel.value; draw(); };
  draw();
  return period => { st.period = period; draw(); };
}

/* ---------- league shot data ---------- */
let leagueShotsP = null;
// Shot maps of every ended regular-season game. Fetched with limited concurrency and cached.
function loadLeagueShots() {
  if (leagueShotsP) return leagueShotsP;
  leagueShotsP = (async () => {
    const sched = await getJSON(`/schedule?tournament=${TOURNAMENT}&season=${SEASON}`);
    const ended = sched.filter(g => g.ended);
    const out = new Map();
    let i = 0;
    const worker = async () => {
      while (i < ended.length) {
        const g = ended[i++];
        const sm = await getJSON(`/shotmap/${SEASON}/${g.id}`).catch(() => []);
        out.set(g.id, Array.isArray(sm) ? sm : []);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    return { sched, ended, shots: out };
  })();
  leagueShotsP.catch(() => { leagueShotsP = null; });
  return leagueShotsP;
}

// Per-team zone profile for (own attempts) and against (opponent attempts). Before = ISO date to rebuild past previews.
function teamShotProfiles(L, before = null) {
  const T = new Map();
  const get = id => T.get(id) || T.set(id, { id, gp: 0, missing: 0, f: blankZones(), a: blankZones() }).get(id);
  for (const g of L.ended) {
    if (before && g.start >= before) continue;
    const h = teamNum(g.homeTeamId), a = teamNum(g.awayTeamId);
    const sm = L.shots.get(g.id) || [];
    get(h).gp++; get(a).gp++;
    if (!sm.length) { get(h).missing++; get(a).missing++; continue; }
    for (const s of sm) {
      const n = normShot(s), shooter = s.shootingTeamId, other = shooter === h ? a : h;
      addZone(get(shooter).f, n); addZone(get(other).a, n);
    }
  }
  for (const t of T.values()) {
    const n = t.gp - t.missing;
    t.n = n;
    for (const side of ['f', 'a']) {
      const z = t[side];
      z.slotShare = z.all ? z.slot.att / z.all : null;
      z.slotPg = n ? z.slot.att / n : null;
      z.slotSogPg = n ? z.slot.sog / n : null;
      z.slotSh = z.slot.sog ? z.slot.g / z.slot.sog : null;
      z.allPg = n ? z.all / n : null;
      z.rebPg = n ? z.reb.att / n : null;
      z.rushPg = n ? z.rush.att / n : null;
    }
  }
  // League ranks (1 = most). For "against" metrics rank 1 means conceding the most.
  const teams = [...T.values()].filter(t => t.n > 0);
  const rank = (f, key) => {
    const sorted = [...teams].sort((x, y) => (f(y) ?? -1) - (f(x) ?? -1));
    sorted.forEach((t, i) => { (t.rank = t.rank || {})[key] = i + 1; });
  };
  rank(t => t.f.slotPg, 'fSlotPg'); rank(t => t.a.slotPg, 'aSlotPg');
  rank(t => t.f.slotShare, 'fSlotShare'); rank(t => t.a.slotShare, 'aSlotShare');
  rank(t => t.f.slotSh, 'fSlotSh'); rank(t => t.a.slotSh, 'aSlotSh');
  rank(t => t.f.rebPg, 'fRebPg'); rank(t => t.a.rebPg, 'aRebPg');
  rank(t => t.f.rushPg, 'fRushPg'); rank(t => t.a.rushPg, 'aRushPg');
  return { teams: T, nTeams: teams.length };
}
function blankZones() { const z = { all: 0, goals: 0, reb: { att: 0, g: 0 }, rush: { att: 0, g: 0 } }; for (const k of ZONES) z[k.k] = { att: 0, sog: 0, g: 0 }; return z; }
function addZone(z, n) {
  z.all++; const c = z[n.zone]; c.att++; if (n.sog) c.sog++; if (n.goal) { c.g++; z.goals++; }
  for (const k of ['reb', 'rush']) if (n[k]) { z[k].att++; if (n.goal) z[k].g++; }
}
// Off-wing shot: a left-handed shooter from the right side or a right-handed shooter from the left side (facing the
// net). Shots within 1.5 m of the middle line, from behind the net or without a known stick hand give null.
const offWing = n => !n.hand || n.zone === 'behind' || Math.abs(n.y - RINK.cy) < 1.5 * RINK.perM ? null : (n.hand === 'L') === (n.y > RINK.cy);
const CTX_DEF = 'Rebound = laukaus enintään 3 s saman joukkueen torjutun laukauksen jälkeen. Nopea hyökkäys = laukaus enintään 10 s vastustajan laukausyrityksen jälkeen ilman omaa laukausta välissä.';

/* ---------- SM-3: team shot profile ---------- */
function zoneHeat(shots, cls) {
  // Half-rink view: dots for every attempt, goals on top
  const order = s => s.goal ? 3 : s.sog ? 2 : 1;
  return `<svg viewBox="500 0 500 510" class="rink half">${rinkLines(true)}${slotBox()}${[...shots].sort((a, b) => order(a) - order(b)).map(s => marker(s, cls)).join('')}</svg>`;
}

function profileRow(label, t, side, key, rankKey, nTeams, fmt, note) {
  const v = t[side][key], r = t.rank?.[rankKey];
  const w = r ? Math.round((nTeams - r + 1) / nTeams * 100) : 0;
  return `<div class="pf-row"><div class="pf-l">${label}${note ? `<small>${note}</small>` : ''}</div><div class="pf-v">${fmt(v)}</div>
    <div class="pf-bar"><i style="width:${w}%"></i></div><div class="pf-r">${r ? `${r}.` : '–'}</div></div>`;
}

// Headline sentences for the preview: only when a team is in the top or bottom three of the league
function profileHeadlines(P, sai, opp, oppName) {
  const out = [], N = P.nTeams, s = P.teams.get(SAIPA_NUM), o = P.teams.get(opp);
  if (!s || !o) return out;
  const top = r => r && r <= 3, bottom = r => r && r >= N - 2;
  if (top(o.rank.aSlotPg)) out.push({ k: `${esc(oppName)} päästää eteensä`, v: num(o.a.slotPg, 1), t: `vastustajan yritystä maalin edestä / ottelu · Liigan ${o.rank.aSlotPg === 1 ? 'eniten' : `${o.rank.aSlotPg}. eniten`}`, cls: 'good' });
  if (bottom(o.rank.aSlotPg)) out.push({ k: `${esc(oppName)} suojaa maalinsa`, v: num(o.a.slotPg, 1), t: `vastustajan yritystä maalin edestä / ottelu · Liigan ${N - o.rank.aSlotPg + 1}. vähiten`, cls: 'bad' });
  if (top(s.rank.fSlotPg)) out.push({ k: 'SaiPa maalin edessä', v: num(s.f.slotPg, 1), t: `yritystä maalin edestä / ottelu · Liigan ${s.rank.fSlotPg}.`, cls: 'good' });
  if (top(s.rank.fRebPg)) out.push({ k: 'SaiPa reboundeilla', v: num(s.f.rebPg, 1), t: `rebound-yritystä / ottelu · Liigan ${s.rank.fRebPg}.`, cls: 'good' });
  if (top(o.rank.aRebPg)) out.push({ k: `${esc(oppName)} antaa reboundeja`, v: num(o.a.rebPg, 1), t: `vastustajan rebound-yritystä / ottelu · Liigan ${o.rank.aRebPg === 1 ? 'eniten' : `${o.rank.aRebPg}. eniten`}`, cls: 'good' });
  if (top(o.rank.fRushPg)) out.push({ k: `${esc(oppName)} nopeissa hyökkäyksissä`, v: num(o.f.rushPg, 1), t: `yritystä nopeista hyökkäyksistä / ottelu · Liigan ${o.rank.fRushPg}.`, cls: 'opp' });
  if (top(o.rank.aRushPg)) out.push({ k: `${esc(oppName)} altis nopeille hyökkäyksille`, v: num(o.a.rushPg, 1), t: `vastustajan yritystä nopeista hyökkäyksistä / ottelu · Liigan ${o.rank.aRushPg === 1 ? 'eniten' : `${o.rank.aRushPg}. eniten`}`, cls: 'good' });
  if (top(o.rank.fSlotPg)) out.push({ k: `${esc(oppName)} maalin edessä`, v: num(o.f.slotPg, 1), t: `yritystä maalin edestä / ottelu · Liigan ${o.rank.fSlotPg}.`, cls: 'opp' });
  return out;
}

// Preview: where each team scores and concedes. One row per attacking direction, each row a pair of half rinks
// with the net on the right: the attacker's goals scored next to the defender's goals conceded, so the same zone
// sits at the same spot in both pictures. Home team's pictures are always on the left.
const SECTORS = [
  { k: 'slot', l: 'Maalin edusta', from: 'maalin edestä' }, { k: 'mid', l: 'Keskietäisyys', from: 'keskietäisyydeltä' },
  { k: 'long', l: 'Kaukaa', from: 'kaukaa' }, { k: 'wingL', l: 'Vasen laita', from: 'vasemmalta laidalta' },
  { k: 'wingR', l: 'Oikea laita', from: 'oikealta laidalta' }, { k: 'behind', l: 'Maalin takaa', from: 'maalin takaa' },
];
function sectorOf(n) {
  const z = n.zone || zoneOf(n.x, n.y);
  return z === 'wing' ? (n.y < RINK.cy ? 'wingL' : 'wingR') : z;
}
function sectorProfiles(L, before) {
  const T = new Map(), blank = () => Object.fromEntries(SECTORS.map(s => [s.k, { att: 0, sog: 0, g: 0 }]));
  const get = id => T.get(id) || T.set(id, { n: 0, f: blank(), a: blank() }).get(id);
  let teamGames = 0;
  for (const g of L.ended) {
    if (before && g.start >= before) continue;
    const sm = L.shots.get(g.id) || [];
    if (!sm.length) continue;
    const h = teamNum(g.homeTeamId), a = teamNum(g.awayTeamId);
    get(h).n++; get(a).n++; teamGames += 2;
    for (const s of sm) {
      const n = normShot(s), k = sectorOf(n), other = s.shootingTeamId === h ? a : h;
      for (const z of [get(s.shootingTeamId).f[k], get(other).a[k]]) { z.att++; if (n.sog) z.sog++; if (n.goal) z.g++; }
    }
  }
  const avg = Object.fromEntries(SECTORS.map(s => [s.k, [...T.values()].reduce((t, x) => t + x.f[s.k].att, 0) / Math.max(1, teamGames)]));
  return { T, avg };
}
function previewProfileHtml(P, sai, opp, oppName, oppTeam = null, L = null, before = null) {
  if (!L) return '';
  const { T } = sectorProfiles(L, before);
  const S = T.get(SAIPA_NUM), O = T.get(opp);
  if (!S?.n || !O?.n) return '';
  // Goal locations for both teams, scored (f) and conceded (a), normalised to the right net
  const dots = { [SAIPA_NUM]: { f: [], a: [] }, [opp]: { f: [], a: [] } };
  for (const g of L.ended) {
    if (before && g.start >= before) continue;
    const h = teamNum(g.homeTeamId), a = teamNum(g.awayTeamId);
    for (const s of L.shots.get(g.id) || []) {
      if (s.eventType !== 'GOAL') continue;
      const n = normShot(s), other = s.shootingTeamId === h ? a : h;
      if (dots[s.shootingTeamId]) dots[s.shootingTeamId].f.push(n);
      if (dots[other]) dots[other].a.push(n);
    }
  }
  // Liiga has not published a shot map for every game, so count how many of each team's games are on the map
  const played = id => L.ended.filter(g => (!before || g.start < before) && (teamNum(g.homeTeamId) === id || teamNum(g.awayTeamId) === id)).length;
  const swap = typeof PV_SWAP !== 'undefined' && PV_SWAP;
  const mk = (t, id, name) => ({ t, d: dots[id], name, sai: id === SAIPA_NUM, gp: played(id) });
  const home = swap ? mk(O, opp, oppName) : mk(S, SAIPA_NUM, 'SaiPa'), away = swap ? mk(S, SAIPA_NUM, 'SaiPa') : mk(O, opp, oppName);
  const ZP = zonePaths();
  const LBL = { long: [700, 70, 26], mid: [752, 264, 26], slot: [842, 264, 28], wingL: [880, 70, 28], wingR: [880, 466, 28], behind: [966, 160, 24] };
  const ICE = 'M 500 2 H 858 A 140 140 0 0 1 998 142 V 368 A 140 140 0 0 1 858 508 H 500 Z';
  const share = (x, side) => { const tot = SECTORS.reduce((a, s) => a + x.t[side][s.k].g, 0); return { tot, of: k => tot ? x.t[side][k].g / tot : 0 }; };
  let uid = 0;
  const pic = (x, side) => {
    const sh = share(x, side), id = `srC${++uid}`, max = Math.max(0.01, ...SECTORS.map(s => sh.of(s.k)));
    let shapes = '', labels = '';
    for (const s of SECTORS) {
      const [lx, ly, fs] = LBL[s.k], z = x.t[side][s.k], f = sh.of(s.k);
      const tip = `${s.l}\n${side === 'f' ? 'Tehdyt maalit' : 'Päästetyt maalit'}\t${z.g} (${pct(f, 0)})\n${side === 'f' ? 'Laukausyritykset' : 'Vastustajan yritykset'}\t${num(z.att / x.t.n, 1)} / ott.`;
      shapes += `<path d="${ZP[s.k]}" class="sr" style="fill:rgba(26,26,26,${(0.03 + 0.2 * f / max).toFixed(2)})" data-tip="${esc(tip)}"/>`;
      if (z.g) labels += `<text x="${lx}" y="${ly}" text-anchor="middle" class="sr-t" font-size="${fs}">${Math.round(f * 100)} %</text>`;
    }
    const pts = x.d[side].map(n => `<circle cx="${n.x}" cy="${n.y}" r="7" class="sr-dot${x.sai && side === 'f' ? ' s' : ''}"/>`).join('');
    return `<figure class="sr-fig">
      <figcaption><b>${esc(x.name)}</b> ${side === 'f' ? 'tekee' : 'päästää'} <span>${sh.tot} maalia</span></figcaption>
      <svg viewBox="630 0 370 510" class="rink half sr-svg">
        <defs><clipPath id="${id}"><path d="${ICE}"/></clipPath></defs>
        <path class="rk-ice" d="${ICE}"/>
        <g clip-path="url(#${id})">${shapes}</g>
        ${rinkLines(true).replace(/<path class="rk-ice"[^>]*\/>/, '')}
        <g class="sr-dots">${pts}</g>${labels}
      </svg></figure>`;
  };
  // League share of goals per zone, and the zone in the row that differs most from it (attacker or defender)
  const lgTot = [...T.values()].reduce((a, t) => a + SECTORS.reduce((b, s) => b + t.f[s.k].g, 0), 0);
  const lg = k => lgTot ? [...T.values()].reduce((a, t) => a + t.f[k].g, 0) / lgTot : 0;
  const meet = (att, def) => {
    const A = share(att, 'f'), D = share(def, 'a');
    const c = SECTORS.flatMap(s => [{ s, x: att, w: 'tekee', v: A.of(s.k), n: A.tot }, { s, x: def, w: 'päästää', v: D.of(s.k), n: D.tot }])
      .filter(o => o.n >= 5).map(o => ({ ...o, d: o.v - lg(o.s.k) })).sort((a, b) => b.d - a.d)[0];
    return c && c.d >= 0.08 ? `<div class="sr-best">Liigasta poikkeaa: <b>${esc(c.x.name)} ${c.w} ${c.s.from} ${pct(c.v, 0)}</b> · liiga ${pct(lg(c.s.k), 0)}</div>` : '';
  };
  // Season view: SaiPa only, scored next to conceded, each compared with the league
  if (opp === SAIPA_NUM) {
    const x = home, dev = side => {
      const A = share(x, side);
      if (A.tot < 5) return '';
      const c = SECTORS.map(s => ({ s, v: A.of(s.k), d: A.of(s.k) - lg(s.k) })).sort((a, b) => b.d - a.d)[0];
      return c && c.d >= 0.05 ? `<div class="sr-best">Liigasta poikkeaa: <b>${c.s.l.toLowerCase()} ${pct(c.v, 0)}</b> · liiga ${pct(lg(c.s.k), 0)}</div>` : '';
    };
    return `<div class="sr-two wide"><div>${pic(x, 'f')}${dev('f')}</div><div>${pic(x, 'a')}${dev('a')}</div></div>
      <p class="muted small">● maali · % osuus SaiPan maaleista${x.t.n < x.gp ? ` · laukauskartta julkaistu ${x.t.n}/${x.gp} ottelusta` : ''}</p>`;
  }
  const row = (att, def, attFirst) => `<div class="sr-row">
      <div class="sr-h"><b>${esc(att.name)} hyökkää</b> <span>→ ${esc(gen(def.name))} maali</span></div>
      <div class="sr-two">${attFirst ? pic(att, 'f') + pic(def, 'a') : pic(def, 'a') + pic(att, 'f')}</div>
      ${meet(att, def)}
    </div>`;
  return `<div class="sr-pair">${row(home, away, true)}${row(away, home, false)}</div>
    <p class="muted small">● maali · % osuus joukkueen maaleista${[home, away].some(x => x.t.n < x.gp) ? ` · laukauskartta julkaistu: ${[home, away].map(x => `${esc(x.name)} ${x.t.n}/${x.gp} ottelua`).join(', ')}` : ''}</p>`;
}

// Season view: where SaiPa scores and concedes, against the league's shares
const seasonProfileHtml = L => previewProfileHtml(null, null, SAIPA_NUM, 'SaiPa', null, L, null) || '<p class="muted">Laukausdataa ei vielä ole.</p>';

/* ---------- rebounds, quick attacks and off-wing shots ---------- */
// Rank text: for conceded numbers rank 1 = concedes the most
const ctxRank = (r, N, conceded) => !r ? '' : conceded && r > N / 2 ? `Liigan ${N - r + 1}. vähiten` : `Liigan ${r}. eniten`;
function ctxLeague(P) {
  const teams = [...P.teams.values()].filter(t => t.n), gp = teams.reduce((a, t) => a + t.n, 0), goals = teams.reduce((a, t) => a + t.f.goals, 0);
  const one = k => { const att = teams.reduce((a, t) => a + t.f[k].att, 0), g = teams.reduce((a, t) => a + t.f[k].g, 0); return { pg: gp ? att / gp : null, share: goals ? g / goals : null, sh: att ? g / att : null }; };
  return { reb: one('reb'), rush: one('rush') };
}
// Season view: SaiPa's rebounds and quick attacks for and against, and the players' shot types
function contextHtml(L, sk = []) {
  const P = teamShotProfiles(L), s = P.teams.get(SAIPA_NUM), N = P.nTeams;
  if (!s?.n) return '<p class="muted">Laukausdataa ei vielä ole.</p>';
  const lg = ctxLeague(P), K = { reb: 'Reb', rush: 'Rush' };
  const cells = (side, k) => {
    const z = s[side][k], key = `${side}${K[k]}Pg`, r = s.rank[key];
    return `<td data-tip="${esc(`${ctxRank(r, N, side === 'a')}\nLiigan keskiarvo\t${num(lg[k].pg, 1)} / ott.`)}"><b>${num(z.att / s.n, 1)}</b> <small class="muted">${r}.</small></td>`
      + `<td data-tip="${esc(`Maaliin\t${pct(z.att ? z.g / z.att : null, 0)} yrityksistä\nLiigassa\t${pct(lg[k].sh, 0)}`)}">${z.g} <small class="muted">${pct(s[side].goals ? z.g / s[side].goals : null, 0)}</small></td>`;
  };
  const th = (l, tip) => `<th data-tip="${esc(tip)}">${l}</th>`;
  const team = `<div class="tablewrap"><table class="mini ctx-t"><thead><tr><th></th>
    ${th('Reboundit / ott.', 'Rebound-yritykset per ottelu ja sija liigassa')}${th('Rebound-maalit', 'Maalit reboundeista ja osuus kaikista maaleista')}
    ${th('Nopeat hyökkäykset / ott.', 'Yritykset nopeista hyökkäyksistä per ottelu ja sija liigassa')}${th('Maalit nopeista', 'Maalit nopeista hyökkäyksistä ja osuus kaikista maaleista')}</tr></thead><tbody>
    <tr><td>SaiPa tekee</td>${cells('f', 'reb')}${cells('f', 'rush')}</tr>
    <tr><td>SaiPa päästää</td>${cells('a', 'reb')}${cells('a', 'rush')}</tr>
    <tr class="muted"><td>Liigan keskiarvo</td><td>${num(lg.reb.pg, 1)}</td><td>${pct(lg.reb.share, 0)}</td><td>${num(lg.rush.pg, 1)}</td><td>${pct(lg.rush.share, 0)}</td></tr>
    </tbody></table></div>`;
  // SaiPa players
  const byId = new Map(sk.map(p => [p.id, p])), P2 = new Map();
  for (const g of L.ended) for (const x of L.shots.get(g.id) || []) {
    if (x.shootingTeamId !== SAIPA_NUM || !byId.has(x.shooterId)) continue;
    const n = normShot(x), o = P2.get(x.shooterId) || P2.set(x.shooterId, { cf: 0, rb: 0, rbg: 0, ru: 0, rug: 0, ow: 0, owN: 0, owg: 0, hand: null }).get(x.shooterId);
    o.cf++; o.hand = o.hand || x.hand; if (n.reb) { o.rb++; if (n.goal) o.rbg++; } if (n.rush) { o.ru++; if (n.goal) o.rug++; }
    const w = offWing(n); if (w != null) { o.owN++; if (w) { o.ow++; if (n.goal) o.owg++; } }
  }
  const rows = [...P2.entries()].filter(([, o]) => o.cf >= 10).sort((a, b) => b[1].cf - a[1].cf).map(([id, o]) => {
    const p = byId.get(id), hand = o.hand;
    return `<tr><td>${plink(p, `${esc(p.first)} ${esc(p.last)}`)}${hand ? ` <small class="muted">(${hand})</small>` : ''}</td><td>${o.cf}</td><td>${o.rb}</td><td><b>${o.rbg}</b></td><td>${o.ru}</td><td><b>${o.rug}</b></td><td>${pct(o.owN ? o.ow / o.owN : null, 0)}</td><td><b>${o.owg}</b></td></tr>`;
  }).join('');
  const pth = (l, en, fi) => `<th data-tip="${esc(`${en}\n${fi}`)}">${l}</th>`;
  const players = rows ? `<h3>Pelaajat</h3><div class="tablewrap"><table class="mini ctx-p"><thead><tr><th>Pelaaja</th>
    ${pth('iCF', 'Individual Corsi For', 'Laukausyritykset')}${pth('RB', 'Rebound Attempts', 'Yritykset reboundista')}${pth('RBG', 'Rebound Goals', 'Maalit reboundista')}
    ${pth('RU', 'Rush Attempts', 'Yritykset nopeista hyökkäyksistä')}${pth('RUG', 'Rush Goals', 'Maalit nopeista hyökkäyksistä')}
    ${pth('OW%', 'Off-Wing Shot Share', 'Osuus yrityksistä väärältä laidalta: vasenkätinen oikealta tai oikeakätinen vasemmalta. Keskeltä (alle 1,5 m keskilinjasta) ja maalin takaa tulleet eivät ole mukana.')}
    ${pth('OWG', 'Off-Wing Goals', 'Maalit väärältä laidalta')}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">Vähintään 10 laukausyritystä · (L) / (R) = mailakäsi</p>` : '';
  return `${team}${players}<p class="muted small">${CTX_DEF}${s.n < s.gp ? ` Laukauskartta julkaistu ${s.n}/${s.gp} ottelusta.` : ''}</p>`;
}
// Preview: both teams' rebounds and quick attacks, home team first
function contextPreviewHtml(P, opp, oppName) {
  const s = P?.teams.get(SAIPA_NUM), o = P?.teams.get(opp), N = P?.nTeams;
  if (!s?.n || !o?.n) return '';
  const lg = ctxLeague(P), swap = typeof PV_SWAP !== 'undefined' && PV_SWAP;
  const cell = (t, side, k) => { const key = `${side}${k === 'reb' ? 'Reb' : 'Rush'}Pg`, r = t.rank[key];
    return `<td data-tip="${esc(`${ctxRank(r, N, side === 'a')}\nLiigan keskiarvo\t${num(lg[k].pg, 1)} / ott.`)}"><b>${num(t[side][`${k}Pg`], 1)}</b> <small class="muted">${r}.</small></td>`; };
  const row = (t, name) => `<tr><td>${esc(name)}</td>${cell(t, 'f', 'reb')}${cell(t, 'a', 'reb')}${cell(t, 'f', 'rush')}${cell(t, 'a', 'rush')}</tr>`;
  const th = (l, tip) => `<th data-tip="${esc(tip)}">${l}</th>`;
  return `<h3>Reboundit ja nopeat hyökkäykset</h3><div class="tablewrap"><table class="mini ctx-t"><thead><tr><th></th>
    ${th('Reboundit', 'Omat rebound-yritykset per ottelu ja sija liigassa')}${th('Päästetyt reboundit', 'Vastustajan rebound-yritykset per ottelu ja sija liigassa (1. = päästää eniten)')}
    ${th('Nopeat hyökkäykset', 'Omat yritykset nopeista hyökkäyksistä per ottelu ja sija liigassa')}${th('Päästetyt nopeat', 'Vastustajan yritykset nopeista hyökkäyksistä per ottelu ja sija liigassa (1. = päästää eniten)')}</tr></thead>
    <tbody>${swap ? row(o, oppName) + row(s, 'SaiPa') : row(s, 'SaiPa') + row(o, oppName)}</tbody></table></div>
    <p class="muted small">${CTX_DEF}</p>`;
}

/* ---------- SM-4: goalie map ---------- */
// Shots on goal faced by each SaiPa goalie. The shot map's blockerId is the goalie for goals and saves.
function goalieMapsHtml(L, goalies) {
  const faced = new Map(goalies.map(g => [g.id, []])), mapped = new Map(goalies.map(g => [g.id, new Set()]));
  for (const g of L.ended) {
    if (teamNum(g.homeTeamId) !== SAIPA_NUM && teamNum(g.awayTeamId) !== SAIPA_NUM) continue;
    for (const s of L.shots.get(g.id) || []) {
      if (s.shootingTeamId === SAIPA_NUM || !isSog(s) || !faced.has(s.blockerId)) continue;
      faced.get(s.blockerId).push(normShot(s));
      mapped.get(s.blockerId).add(g.id);
    }
  }
  const blocks = goalies.filter(g => faced.get(g.id).length).map(gk => {
    const f = faced.get(gk.id), ga = f.filter(s => s.goal);
    const by = k => f.filter(s => s.zone === k), gBy = k => ga.filter(s => s.zone === k);
    const zoneRows = ZONES.map(z => {
      const n = by(z.k).length, g = gBy(z.k).length;
      return n ? `<tr><td title="${esc(z.d)}">${z.l}</td><td>${n}</td><td>${g}</td><td>${pct(n ? 1 - g / n : null, 1)}</td></tr>` : '';
    }).join('');
    // The single most telling sentence: where most goals came from
    let line = '';
    if (ga.length >= 3) {
      const wingGoals = ga.filter(s => s.zone === 'wing');
      const bySide = { vasen: wingGoals.filter(s => sideOf(s) === 'vasen').length, oikea: wingGoals.filter(s => sideOf(s) === 'oikea').length };
      const topZone = ZONES.map(z => ({ z, n: gBy(z.k).length })).sort((a, b) => b.n - a.n)[0];
      line = topZone.z.k === 'wing' && Math.max(bySide.vasen, bySide.oikea) >= ga.length / 2
        ? `${Math.max(bySide.vasen, bySide.oikea)}/${ga.length} päästetystä maalista tuli ampujan ${bySide.vasen >= bySide.oikea ? 'vasemmalta' : 'oikealta'} laidalta.`
        : `${topZone.n}/${ga.length} päästetystä maalista tuli ${topZone.z.from}.`;
    }
    return `<div class="gk-map">
      <h3>${esc(gk.first)} ${esc(gk.last)}</h3>
      <svg viewBox="500 0 500 510" class="rink half">${rinkLines(true)}${slotBox()}${f.filter(s => !s.goal).map(s => marker(s, 'opp')).join('')}${ga.map(s => marker(s, 'opp')).join('')}</svg>
      ${line ? `<p class="gk-line">${line}</p>` : ''}
      ${gk.gp && mapped.get(gk.id).size < gk.gp ? `<p class="muted small">Laukauskartta ${mapped.get(gk.id).size}/${gk.gp} ottelusta</p>` : ''}
    </div>`;
  });
  return blocks.length ? `<div class="gk-maps">${blocks.join('')}</div>
    <p class="muted small">Vastustajan laukaukset maalia kohti · iso rengas = maali</p>` : '<p class="muted">Ei vielä laukausdataa.</p>';
}

/* ---------- SE-1: deserved standings ---------- */
// Liiga's expectedPoints field is always 0, so expected points are computed here.
// Each team's goals are modelled as Poisson with mean = its game xG. P(regulation win) gives 3 points;
// P(tie after 60 min) gives 1.5 points to each team (winner 2, loser 1 in OT or shootout, split evenly).
function poisson(l, k) { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; }
function gameOutcome(xh, xa) {
  let w = 0, t = 0, l = 0;
  for (let i = 0; i <= 15; i++) for (let j = 0; j <= 15; j++) {
    const p = poisson(xh, i) * poisson(xa, j);
    if (i > j) w += p; else if (i === j) t += p; else l += p;
  }
  return { w, t, l };
}
function deservedTable(sched, teamsInfo) {
  const T = new Map();
  const get = id => T.get(id) || T.set(id, { id, gp: 0, pts: 0, xpts: 0, xgf: 0, xga: 0, gf: 0, ga: 0, luckGames: [] }).get(id);
  for (const g of sched) {
    if (!g.ended || g.expectedHomeTeamGoals == null) continue;
    const h = teamNum(g.homeTeamId), a = teamNum(g.awayTeamId);
    const o = gameOutcome(g.expectedHomeTeamGoals, g.expectedAwayTeamGoals);
    const extra = g.finishedType !== 'ENDED_DURING_REGULAR_GAME_TIME';
    const hw = g.homeTeamGoals > g.awayTeamGoals;
    const ph = extra ? (hw ? 2 : 1) : (hw ? 3 : 0), pa = extra ? (hw ? 1 : 2) : (hw ? 0 : 3);
    for (const [id, pts, xp, xf, xa] of [[h, ph, 3 * o.w + 1.5 * o.t, g.expectedHomeTeamGoals, g.expectedAwayTeamGoals], [a, pa, 3 * o.l + 1.5 * o.t, g.expectedAwayTeamGoals, g.expectedHomeTeamGoals]]) {
      const t = get(id); t.gp++; t.pts += pts; t.xpts += xp; t.xgf += xf; t.xga += xa;
    }
  }
  const rows = [...T.values()];
  rows.sort((x, y) => y.pts - x.pts || y.xpts - x.xpts).forEach((t, i) => t.rank = i + 1);
  [...rows].sort((x, y) => y.xpts - x.xpts).forEach((t, i) => t.xrank = i + 1);
  for (const t of rows) { const i = teamsInfo.get(t.id); t.name = i?.name || String(t.id); t.logo = i?.logo || null; t.diff = t.pts - t.xpts; }
  // Use the official standings position (Liiga's tie-breakers) whenever every team has one.
  if (rows.every(t => teamsInfo.get(t.id)?.ranking)) {
    for (const t of rows) t.rank = teamsInfo.get(t.id).ranking;
    rows.sort((a, b) => a.rank - b.rank);
  }
  return rows;
}
function deservedHtmlSeason(rows) {
  if (!rows.length) return '<p class="muted">Odotettuja maaleja ei vielä ole saatavilla.</p>';
  const s = rows.find(t => t.id === SAIPA_NUM);
  const maxAbs = Math.max(1, ...rows.map(t => Math.abs(t.diff)));
  const th = (l, en, fi, cls = '') => `<th${cls ? ` class="${cls}"` : ''} data-tip="${en}\n${fi}">${l}</th>`;
  return `
    ${s ? `<div class="chips"><span class="chip"><small>SaiPa</small><b>${s.rank}.</b></span><span class="chip"><small>xRank</small><b>${s.xrank}.</b></span><span class="chip"><small>PTS − xPTS</small><b class="${cls(s.diff)}">${signed(s.diff, 1)}</b></span></div>` : ''}
    <div class="tablewrap"><table class="dsv">
      <tr><th>#</th><th>Joukkue</th>${th('GP', 'Games Played', 'Ottelut')}${th('PTS', 'Points', 'Pisteet')}${th('xPTS', 'Expected Points', 'Odotetut pisteet ottelukohtaisesta xG:stä')}${th('xRank', 'Expected Rank', 'Sija odotettujen pisteiden mukaan')}${th('PTS − xPTS', 'Points minus Expected Points', 'Plussalla pisteitä on tullut enemmän kuin maalipaikat ennustavat', 'dsv-bar-h')}<th></th>${th('xGF–xGA', 'Expected Goals For – Against', 'Omat–vastustajan maalipaikat')}</tr>
      ${rows.map(t => `<tr class="${t.id === SAIPA_NUM ? 'me' : ''}">
        <td>${t.rank}.</td><td class="tn">${t.logo ? `<img class="tlogo" src="${esc(t.logo)}" alt="">` : ''}${esc(t.name)}</td><td>${t.gp}</td><td><b>${t.pts}</b></td><td>${num(t.xpts, 1)}</td>
        <td><span class="${t.xrank < t.rank ? 'neg-num' : t.xrank > t.rank ? 'pos-num' : ''}">${t.xrank}.</span></td>
        <td class="dsv-bar"><div class="db"><i class="${t.diff >= 0 ? 'p' : 'n'}" style="width:${Math.abs(t.diff) / maxAbs * 50}%;${t.diff >= 0 ? 'left:50%' : `right:50%`}"></i></div></td><td class="${cls(t.diff)}">${signed(t.diff, 1)}</td>
        <td>${num(t.xgf, 1)}–${num(t.xga, 1)}</td></tr>`).join('')}
    </table></div>`;
}

/* ---------- SE-2: SaiPa by period and game state ---------- */
// Game state at each moment from valid goal times. Shot attempts are matched to the state just before the shot.
function stateSplits(raws) {
  const ST = { lead: 'Johdossa', tied: 'Tasan', trail: 'Tappiolla' };
  const S = {}, P = {};
  for (const k of Object.keys(ST)) S[k] = { toi: 0, cf: 0, ca: 0, sf: 0, sa: 0, gf: 0, ga: 0 };
  for (const { g, st, ctx } of raws) {
    const home = isSaipa(g.game.homeTeam.teamId);
    const mineT = home ? g.game.homeTeam : g.game.awayTeam, oppT = home ? g.game.awayTeam : g.game.homeTeam;
    const goals = [...(mineT.goalEvents || []).filter(validGoal).map(e => ({ t: e.gameTime, d: 1 })), ...(oppT.goalEvents || []).filter(validGoal).map(e => ({ t: e.gameTime, d: -1 }))].filter(x => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
    const end = Math.max(3600, g.game.gameTime || 0);
    const stateAt = t => { let d = 0; for (const x of goals) if (x.t < t) d += x.d; return d > 0 ? 'lead' : d < 0 ? 'trail' : 'tied'; };
    // Time in each state
    let prev = 0, d = 0;
    for (const x of [...goals, { t: end, d: 0 }]) {
      S[d > 0 ? 'lead' : d < 0 ? 'trail' : 'tied'].toi += Math.max(0, Math.min(x.t, end) - prev);
      prev = Math.min(x.t, end); d += x.d;
    }
    for (const x of goals) { const s = stateAt(x.t); if (x.d > 0) S[s].gf++; else S[s].ga++; }
    for (const s of ctx.sm) {
      // Shot map times run 2–3 s before the matching goal event, so a scoring shot still gets the state before its goal.
      const k = stateAt(s.gameTime), mine = s.shootingTeamId === SAIPA_NUM;
      if (mine) { S[k].cf++; if (isSog(s)) S[k].sf++; } else { S[k].ca++; if (isSog(s)) S[k].sa++; }
    }
    // By period: goals and xG from the per-period stats
    const side = home ? 'home' : 'away', oside = home ? 'away' : 'home';
    for (const n of [1, 2, 3, 4]) {
      const a = (st[`${side}Team`] || []).find(p => p.period === n), b = (st[`${oside}Team`] || []).find(p => p.period === n);
      if (!a || !(a.periodPlayerStats || []).some(x => x.period?.timeofice > 0)) continue;
      const xg = per => (per?.periodPlayerStats || []).reduce((s, p) => s + (p.expectedGoalsPlayer || 0), 0);
      const p = P[n] = P[n] || { n, gp: 0, gf: 0, ga: 0, xgf: 0, xga: 0, cf: 0, ca: 0 };
      p.gp++; p.xgf += xg(a); p.xga += xg(b);
      p.gf += (mineT.goalEvents || []).filter(e => validGoal(e) && e.period === n).length;
      p.ga += (oppT.goalEvents || []).filter(e => validGoal(e) && e.period === n).length;
      for (const s of ctx.sm) if (s.period === n) { if (s.shootingTeamId === SAIPA_NUM) p.cf++; else p.ca++; }
    }
  }
  return { ST, S, P: Object.values(P).sort((a, b) => a.n - b.n) };
}
function stateHtml(x) {
  const share = (a, b) => (a + b) ? a / (a + b) : null;
  const bar = v => v == null ? '' : `<div class="sh-bar"><i style="width:${v * 100}%"></i><b style="left:50%"></b></div>`;
  const th = (l, en, fi) => `<th data-tip="${en}\n${fi}">${l}</th>`;
  const states = Object.keys(x.ST).map(k => ({ k, l: x.ST[k], ...x.S[k], cfp: share(x.S[k].cf, x.S[k].ca) }));
  const pers = x.P.map(p => ({ ...p, xgp: share(p.xgf, p.xga) }));
  return `
    <div class="grid2 flat">
      <div><h3>Tilanteen mukaan</h3>
        <div class="tablewrap"><table class="mini st-t"><tr><th></th>${th('TOI', 'Time on Ice', 'Peliaika tilanteessa')}${th('GF–GA', 'Goals For – Against', 'Tehdyt–päästetyt maalit')}${th('SAT', 'Shot Attempts For – Against', 'Omat–vastustajan laukausyritykset, kaikki pelitilanteet')}${th('SAT%', 'Shot Attempt Percentage', 'SaiPan osuus laukausyrityksistä')}${th('GF/60', 'Goals For – Against per 60', 'Tehdyt–päästetyt maalit 60 minuutissa')}</tr>
        ${states.map(s => `<tr><td><b>${s.l}</b></td><td>${Math.round(s.toi / 60)} min</td><td>${s.gf}–${s.ga}</td><td>${s.cf}–${s.ca}</td><td>${pct(s.cfp, 0)}${bar(s.cfp)}</td><td>${s.toi ? num(s.gf / s.toi * 3600, 2) : '–'}–${s.toi ? num(s.ga / s.toi * 3600, 2) : '–'}</td></tr>`).join('')}
        </table></div></div>
      <div><h3>Erittäin</h3>
        <div class="tablewrap"><table class="mini st-t"><tr><th></th>${th('GP', 'Games Played', 'Ottelut')}${th('GF–GA', 'Goals For – Against', 'Tehdyt–päästetyt maalit')}${th('xGF–xGA', 'Expected Goals For – Against', 'Omat–vastustajan maalipaikat')}${th('xGF%', 'Expected Goals For Percentage', 'SaiPan osuus maaliodottamasta')}${th('SAT', 'Shot Attempts For – Against', 'Omat–vastustajan laukausyritykset')}</tr>
        ${pers.map(p => `<tr><td><b>${PERIOD_LABEL(p.n)}</b></td><td>${p.gp}</td><td>${p.gf}–${p.ga}</td><td>${num(p.xgf, 1)}–${num(p.xga, 1)}</td><td>${pct(p.xgp, 0)}${bar(p.xgp)}</td><td>${p.cf}–${p.ca}</td></tr>`).join('')}
        </table></div></div>
    </div>
    <p class="muted small">Pelitilanne maalien ajankohdista · ilman hylättyjä ja voittolaukausmaaleja</p>`;
}
