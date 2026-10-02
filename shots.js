/* SaiPa Data: shot maps, team shot profiles, goalie maps, deserved standings and game-state splits.
 * Uses helpers from app.js and preview.js (esc, num, pct, signed, getJSON, SEASON, SAIPA_NUM, teamNum, isSog, validGoal, logoImg, gen). */

/* ---------- rink geometry ----------
 * Shot map coordinates: x 0–1000 along the rink, y 0–510 across it (60 m × 30 m, ≈16.7 units per metre).
 * The left team attacks the right net and the teams switch ends between periods.
 * normShot() rotates every shot so that the shooting team attacks the right net (x = 933, y = 255). */
const RINK = { w: 1000, h: 510, goalX: 933, cy: 255, blue: 650, perM: 16.7 };
const ZONES = [
  { k: 'slot', l: 'Maalin edusta', from: 'maalin edestä', d: 'Maalin edusta: enintään 10 m maaliviivasta ja 5 m sivuun maalin keskeltä' },
  { k: 'wing', l: 'Laidat', from: 'laidoilta', d: 'Hyökkäysalue maalin edustan sivuilla' },
  { k: 'point', l: 'Siniviiva ja kaukaa', from: 'siniviivalta tai kaukaa', d: 'Yli 14 m maaliviivasta' },
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
  if (dx <= 10 * RINK.perM && dy <= 5 * RINK.perM) return 'slot';
  if (dx > 14 * RINK.perM) return 'point';
  return 'wing';
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
// Slot outline for the right net
const slotBox = () => `<rect class="rk-slot" x="${RINK.goalX - 10 * RINK.perM}" y="${RINK.cy - 5 * RINK.perM}" width="${10 * RINK.perM}" height="${10 * RINK.perM}"/>`;

function marker(s, cls) {
  const t = `${s.goal ? 'Maali' : s.eventType === 'GOALIE_BLOCKED' ? 'Torjuttu' : s.eventType === 'PLAYER_BLOCKED' ? 'Blokattu' : 'Ohi'} · ${s.situ}${s.label ? ' · ' + s.label : ''}`;
  if (s.goal) return `<g class="mk ${cls}"><title>${esc(t)}</title><circle cx="${s.x}" cy="${s.y}" r="15" class="mk-goal"/><circle cx="${s.x}" cy="${s.y}" r="5" class="mk-goal-c"/></g>`;
  if (s.eventType === 'GOALIE_BLOCKED') return `<circle class="mk ${cls} mk-sog" cx="${s.x}" cy="${s.y}" r="8"><title>${esc(t)}</title></circle>`;
  if (s.eventType === 'PLAYER_BLOCKED') return `<path class="mk ${cls} mk-blk" d="M ${s.x - 6} ${s.y - 6} L ${s.x + 6} ${s.y + 6} M ${s.x + 6} ${s.y - 6} L ${s.x - 6} ${s.y + 6}"><title>${esc(t)}</title></path>`;
  return `<circle class="mk ${cls} mk-miss" cx="${s.x}" cy="${s.y}" r="7"><title>${esc(t)}</title></circle>`;
}
const mapLegend = () => `<div class="sm-legend"><span><i class="lg-goal"></i>Maali</span><span><i class="lg-sog"></i>Torjuttu</span><span><i class="lg-miss"></i>Ohi</span><span><i class="lg-blk">×</i>Blokattu</span></div>`;

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
    ${mapLegend()}
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
  return { teams: T, nTeams: teams.length };
}
function blankZones() { const z = { all: 0 }; for (const k of ZONES) z[k.k] = { att: 0, sog: 0, g: 0 }; return z; }
function addZone(z, n) { z.all++; const c = z[n.zone]; c.att++; if (n.sog) c.sog++; if (n.goal) c.g++; }

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
  if (top(o.rank.fSlotPg)) out.push({ k: `${esc(oppName)} maalin edessä`, v: num(o.f.slotPg, 1), t: `yritystä maalin edestä / ottelu · Liigan ${o.rank.fSlotPg}.`, cls: 'opp' });
  return out;
}

// Preview: where each team scores and concedes. One row per attacking direction, each row a pair of half rinks
// with the net on the right: the attacker's goals scored next to the defender's goals conceded, so the same zone
// sits at the same spot in both pictures. Home team's pictures are always on the left.
const SECTORS = [
  { k: 'slot', l: 'Maalin edusta' }, { k: 'wingL', l: 'Vasen laita' }, { k: 'wingR', l: 'Oikea laita' },
  { k: 'point', l: 'Siniviiva' }, { k: 'behind', l: 'Maalin takaa' },
];
function sectorOf(n) {
  const dx = RINK.goalX - n.x, dy = n.y - RINK.cy, m = RINK.perM;
  if (dx < 0) return 'behind';
  if (dx <= 10 * m && Math.abs(dy) <= 5 * m) return 'slot';
  if (dx > 12 * m) return 'point';
  return dy < 0 ? 'wingL' : 'wingR';
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
  const m = RINK.perM, gx = RINK.goalX, cy = RINK.cy, p1 = gx - 12 * m;
  const R = { point: [RINK.blue, 2, p1, 508], wingL: [p1, 2, gx, cy], wingR: [p1, cy, gx, 508], slot: [gx - 10 * m, cy - 5 * m, gx, cy + 5 * m], behind: [gx, 2, 998, 508] };
  const LBL = { point: [700, 70, 30], wingL: [800, 70, 30], wingR: [800, 470, 30], slot: [865, 205, 30], behind: [966, 70, 26] };
  const ICE = 'M 500 2 H 858 A 140 140 0 0 1 998 142 V 368 A 140 140 0 0 1 858 508 H 500 Z';
  const share = (x, side) => { const tot = SECTORS.reduce((a, s) => a + x.t[side][s.k].g, 0); return { tot, of: k => tot ? x.t[side][k].g / tot : 0 }; };
  let uid = 0;
  const pic = (x, side) => {
    const sh = share(x, side), id = `srC${++uid}`, max = Math.max(0.01, ...SECTORS.map(s => sh.of(s.k)));
    let shapes = '', labels = '';
    for (const s of SECTORS) {
      const [x0, y0, x1, y1] = R[s.k], [lx, ly, fs] = LBL[s.k], z = x.t[side][s.k], f = sh.of(s.k);
      const tip = `${s.l}\n${side === 'f' ? 'Tehdyt maalit' : 'Päästetyt maalit'}\t${z.g} (${pct(f, 0)})\n${side === 'f' ? 'Laukausyritykset' : 'Vastustajan yritykset'}\t${num(z.att / x.t.n, 1)} / ott.`;
      shapes += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" class="sr" style="fill:rgba(26,26,26,${(0.03 + 0.2 * f / max).toFixed(2)})" data-tip="${esc(tip)}"/>`;
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
    return c && c.d >= 0.08 ? `<div class="sr-best">Liigasta poikkeaa: <b>${esc(c.x.name)} ${c.w} ${c.s.l.toLowerCase().replace('maalin edusta', 'maalin edestä').replace('maalin takaa', 'maalin takaa').replace('siniviiva', 'siniviivalta').replace('vasen laita', 'vasemmalta laidalta').replace('oikea laita', 'oikealta laidalta')} ${pct(c.v, 0)}</b> · liiga ${pct(lg(c.s.k), 0)}</div>` : '';
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
  const th = (l, en, fi, cls = '') => `<th${cls ? ` class="${cls}"` : ''} data-tip="${l} = ${en}\n${fi}">${l}</th>`;
  return `
    ${s ? `<div class="chips"><span class="chip"><small>SaiPa</small><b>${s.rank}.</b></span><span class="chip"><small>xRank</small><b>${s.xrank}.</b></span><span class="chip"><small>PTS − xPTS</small><b class="${cls(s.diff)}">${signed(s.diff, 1)}</b></span></div>` : ''}
    <div class="tablewrap"><table class="dsv">
      <tr><th>#</th><th>Joukkue</th>${th('GP', 'Games Played', 'Ottelut')}${th('PTS', 'Points', 'Pisteet')}${th('xPTS', 'Expected Points', 'Odotetut pisteet ottelukohtaisesta xG:stä')}${th('xRank', 'Expected Rank', 'Sija odotettujen pisteiden mukaan')}${th('PTS − xPTS', 'Points minus Expected Points', 'Plussalla pisteitä on tullut enemmän kuin maalipaikat ennustavat', 'dsv-bar-h')}<th></th>${th('xGF–xGA', 'Expected Goals For – Against', 'Maaliodottama puolesta–vastaan')}</tr>
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
  const th = (l, en, fi) => `<th data-tip="${l} = ${en}\n${fi}">${l}</th>`;
  const states = Object.keys(x.ST).map(k => ({ k, l: x.ST[k], ...x.S[k], cfp: share(x.S[k].cf, x.S[k].ca) }));
  const pers = x.P.map(p => ({ ...p, xgp: share(p.xgf, p.xga) }));
  return `
    <div class="grid2 flat">
      <div><h3>Tilanteen mukaan</h3>
        <div class="tablewrap"><table class="mini st-t"><tr><th></th>${th('TOI', 'Time on Ice', 'Peliaika tilanteessa')}${th('GF–GA', 'Goals For – Against', 'Maalit puolesta–vastaan')}${th('SAT', 'Shot Attempts For – Against', 'Laukausyritykset puolesta–vastaan, kaikki pelitilanteet')}${th('SAT%', 'Shot Attempt Percentage', 'SaiPan osuus laukausyrityksistä')}${th('GF/60', 'Goals For – Against per 60', 'Maalit puolesta–vastaan 60 minuuttia kohden')}</tr>
        ${states.map(s => `<tr><td><b>${s.l}</b></td><td>${Math.round(s.toi / 60)} min</td><td>${s.gf}–${s.ga}</td><td>${s.cf}–${s.ca}</td><td>${pct(s.cfp, 0)}${bar(s.cfp)}</td><td>${s.toi ? num(s.gf / s.toi * 3600, 2) : '–'}–${s.toi ? num(s.ga / s.toi * 3600, 2) : '–'}</td></tr>`).join('')}
        </table></div></div>
      <div><h3>Erittäin</h3>
        <div class="tablewrap"><table class="mini st-t"><tr><th></th>${th('GP', 'Games Played', 'Ottelut')}${th('GF–GA', 'Goals For – Against', 'Maalit puolesta–vastaan')}${th('xGF–xGA', 'Expected Goals For – Against', 'Maaliodottama puolesta–vastaan')}${th('xGF%', 'Expected Goals For Percentage', 'SaiPan osuus maaliodottamasta')}${th('SAT', 'Shot Attempts For – Against', 'Laukausyritykset puolesta–vastaan')}</tr>
        ${pers.map(p => `<tr><td><b>${PERIOD_LABEL(p.n)}</b></td><td>${p.gp}</td><td>${p.gf}–${p.ga}</td><td>${num(p.xgf, 1)}–${num(p.xga, 1)}</td><td>${pct(p.xgp, 0)}${bar(p.xgp)}</td><td>${p.cf}–${p.ca}</td></tr>`).join('')}
        </table></div></div>
    </div>
    <p class="muted small">Pelitilanne maalien ajankohdista · ilman hylättyjä ja voittolaukausmaaleja</p>`;
}
