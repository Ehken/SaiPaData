/* SaiPa Data: lineup editor (LE-1).
 * Build SaiPa's lines from the season's skaters and see what the numbers say about each line and the whole team.
 * A unit's strength is the average of its players' own on-ice rates (expected goals for and against per 60 minutes
 * while the player is on ice, all situations), pulled towards the team average when the player has little ice time.
 * Each line also gets a profile of five parts against the team average: chances for (xGF/60), defence (xGA/60),
 * possession (CF%), finishing (own goals vs. own expected goals) and faceoffs (the centre's FO%). Finishing also
 * nudges the line's total, at half weight, because it is noisy in small samples.
 * The model adds players up; it cannot know whether two players work well together, because the API gives the
 * players on ice only for goals. Optional add-on: remove this file and its script tag to drop the feature. */

const LE_K = 18000;                                  // shrinkage weight: 300 minutes of team-average play
const LE_EV_MIN = 48;                                // even-strength-like minutes per game used for the totals
const LE_F_SHARE = [0.32, 0.30, 0.23, 0.15];         // share of forward ice time by line
const LE_D_SHARE = [0.38, 0.34, 0.28, 0];            // share of defence ice time by pair
const LE_SLOTS = ['VL', 'KH', 'OL', 'VP', 'OP'];
const LE_CF_K = 150, LE_FIN_K = 6, LE_FO_K = 60;     // shrinkage: shot attempts, expected goals, faceoffs
let LE = null;                                       // { players, rate, base, cur, pick }

async function renderLineupEditor(el, sk) {
  const last = saipaGames[0];
  if (!last) { el.innerHTML = '<h2>Kokoonpanoeditori</h2><p class="muted">Ei vielä pelattuja otteluita.</p>'; return; }
  const raw = await loadRaw(last.id);
  const home = isSaipa(raw.g.game.homeTeam.teamId);
  const roster = (home ? raw.g.homeTeamPlayers : raw.g.awayTeamPlayers) || [];
  const hand = new Map(roster.map(p => [p.id, p.handedness]));
  const players = sk.filter(p => p.gp && p.toi).map(p => ({ ...p, hand: hand.get(p.id) || null, group: posGroup(p.role) }));
  const byId = new Map(players.map(p => [p.id, p]));
  // Team averages per 60 and each player's shrunk rates
  const T = players.reduce((s, p) => ({ toi: s.toi + p.toi, xgf: s.xgf + p.xgf, xga: s.xga + p.xga }), { toi: 0, xgf: 0, xga: 0 });
  const tf = T.xgf / T.toi * 3600, ta = T.xga / T.toi * 3600;
  const Dp = players.filter(p => p.group === 'D'), tb = Dp.reduce((s, p) => s + p.blk, 0) / Math.max(1, Dp.reduce((s, p) => s + p.toi, 0)) * 3600;
  const C = players.reduce((s, p) => ({ cf: s.cf + p.cf, ca: s.ca + p.ca }), { cf: 0, ca: 0 }), tcf = C.cf / Math.max(1, C.cf + C.ca);
  const rate = new Map(players.map(p => [p.id, {
    f: (p.xgf * 3600 + tf * LE_K) / (p.toi + LE_K),
    a: (p.xga * 3600 + ta * LE_K) / (p.toi + LE_K),
    cf: (p.cf + tcf * LE_CF_K) / (p.cf + p.ca + LE_CF_K),
    fin: (p.g + LE_FIN_K) / (p.ixg + LE_FIN_K),             // 1 = scores as many as expected
    ixg: p.ixg, g: p.g,
    fo: p.fot ? (p.fow + 0.5 * LE_FO_K) / (p.fot + LE_FO_K) : null, fot: p.fot,
    p60: p.toi ? (p.g + p.a) / p.toi * 3600 : 0,
    blk60: (p.blk * 3600 + tb * LE_K) / (p.toi + LE_K),
    min: p.toi / 60,
  }]));
  // Lines of the latest game as the starting point
  const base = [1, 2, 3, 4].map(n => Object.fromEntries(LE_SLOTS.map(r => [r, roster.find(p => p.line === n && p.roleCode === r && byId.has(p.id))?.id || null])));
  LE = { players, byId, rate, tf, ta, tcf, tb, base, cur: base.map(l => ({ ...l })), pick: null, last };
  leDraw(el);
}

// Unit values: average of the players' rates; empty slots count as team average
function leUnit(ids) {
  const r = ids.map(id => id ? LE.rate.get(id) : { f: LE.tf, a: LE.ta, cf: LE.tcf, fin: 1, ixg: 0, blk60: LE.tb });
  const avg = k => r.reduce((s, x) => s + x[k], 0) / r.length;
  const ixg = r.reduce((s, x) => s + (x.ixg || 0), 0), g = r.reduce((s, x) => s + (x.g || 0), 0);
  // Finishing weighted by each player's own expected goals (the shooters matter most)
  const fin = ixg ? r.reduce((s, x) => s + (x.fin ?? 1) * (x.ixg || 0), 0) / ixg : 1;
  const f = avg('f');
  return { f, a: avg('a'), cf: avg('cf'), fin, fAdj: f * (1 + 0.5 * (fin - 1)), blk: avg('blk60'), g, ixg };
}
// A full line (three forwards + pair): forwards weigh 3/5, defence 2/5; the centre's faceoffs
// Forward line and defence pair are rated separately: pairs move between lines during a game
function leFwd(l) { const u = leUnit(['VL', 'KH', 'OL'].map(r => l[r])), c = l.KH ? LE.rate.get(l.KH) : null; return { ...u, fo: c?.fo ?? null, fot: c?.fot || 0 }; }
function leDef(l) { return leUnit(['VP', 'OP'].map(r => l[r])); }
function leTeam(lines) {
  let f = 0, a = 0;
  lines.forEach((l, i) => {
    const F = leFwd(l), D = leDef(l);
    f += LE_F_SHARE[i] * F.fAdj * 0.6 + LE_D_SHARE[i] * D.fAdj * 0.4; a += LE_F_SHARE[i] * F.a * 0.6 + LE_D_SHARE[i] * D.a * 0.4;
  });
  return { f, a, perGame: (f - a) * LE_EV_MIN / 60 };
}

function leDraw(el) {
  const { cur, byId, pick } = LE;
  const used = new Set(cur.flatMap(l => LE_SLOTS.map(r => l[r])).filter(Boolean));
  const chip = (id, slot) => {
    const p = id ? byId.get(id) : null, sel = pick && pick.id === id && pick.slot === slot;
    if (!p) return `<button class="le-p empty${sel ? ' sel' : ''}" data-slot="${slot}">+</button>`;
    const want = slot ? (/^(VP|OP)$/.test(slot.split(':')[1]) ? 'D' : 'F') : null, wrong = want && p.group !== want;
    const r = LE.rate.get(id);
    const tip = `${p.first} ${p.last}${p.hand ? ` (${p.hand[0]})` : ''}\nxGF/60\t${num(r.f, 2)}\nxGA/60\t${num(r.a, 2)}\nCF%\t${pct(r.cf, 0)}\nMaalit\t${p.g}\nMaaliodottama\t${num(p.ixg, 1)}${p.fot ? `\nFO%\t${pct(p.fow / p.fot, 0)}` : ''}\nPeliaika\t${Math.round(r.min)} min${wrong ? '\nPelaa yleensä ' + (p.group === 'D' ? 'puolustajana' : 'hyökkääjänä') : ''}`;
    return `<button class="le-p${sel ? ' sel' : ''}${wrong ? ' wrong' : ''}" data-id="${id}" ${slot ? `data-slot="${slot}"` : ''} data-tip="${esc(tip)}"><b>${esc(p.last)}</b><small>#${p.jersey ?? ''} ${esc(posEn(p.role))}</small></button>`;
  };
  const val = (u, kind) => { const d = u.fAdj - u.a; return `<span class="le-v ${d > 0.05 ? 'pos' : d < -0.05 ? 'neg' : ''}" data-tip="${esc(`Expected Goal Differential per 60\nMaalipaikkaero 60 minuutissa\nxGF/60\t${num(u.f, 2)}\nxGA/60\t${num(u.a, 2)}\nViimeistely\t${signed((u.fAdj - u.f), 2)}`)}">${signed(d, 2)}<small>xG±/60</small></span>`; };
  // Profiles against the team average, as small centred bars (right = better). Forward lines and defence
  // pairs have their own parts and are compared only with their own kind.
  // [label, score (higher = better), tooltip rows, explanation, shown value]
  const P_F = [
    ['Paikat', L => (L.f / LE.tf - 1) * 100, L => [['xGF/60', num(L.f, 2)], ['Joukkue', num(LE.tf, 2)]], 'Omat maalipaikat 60 minuutissa', L => num(L.f, 2)],
    ['Puolustus', L => (1 - L.a / LE.ta) * 100, L => [['xGA/60', num(L.a, 2)], ['Joukkue', num(LE.ta, 2)]], 'Vastustajan maalipaikat 60 minuutissa. Pienempi on parempi', L => num(L.a, 2)],
    ['Hallinta', L => (L.cf - LE.tcf) * 100, L => [['CF%', pct(L.cf, 1)], ['Joukkue', pct(LE.tcf, 1)]], 'Laukausyritysten osuus, kun ketju on jäällä', L => pct(L.cf, 0)],
    ['Viimeistely', L => (L.fin - 1) * 100, L => [['Maalit', String(L.g)], ['Maaliodottama', num(L.ixg, 1)]], 'Maalit suhteessa maalipaikkoihin. Yli 1 = tehokkaampi kuin odotettu', L => num(L.fin, 2)],
    ['Aloitukset', L => L.fo == null ? null : (L.fo - 0.5) * 100, L => L.fo == null ? [] : [['FO%', pct(L.fo, 1)], ['Aloitukset', String(L.fot)]], 'Sentterin voittamat aloitukset', L => L.fo == null ? '–' : pct(L.fo, 0)],
  ];
  const P_D = [
    ['Paikat', P_F[0][1], P_F[0][2], 'Omat maalipaikat 60 minuutissa', P_F[0][4]],
    ['Puolustus', P_F[1][1], P_F[1][2], 'Vastustajan maalipaikat 60 minuutissa. Pienempi on parempi', P_F[1][4]],
    ['Hallinta', P_F[2][1], P_F[2][2], 'Laukausyritysten osuus, kun pari on jäällä', P_F[2][4]],
    ['Blokit', L => (L.blk / LE.tb - 1) * 100, L => [['BLK/60', num(L.blk, 2)], ['Puolustajat', num(LE.tb, 2)]], 'Blokatut laukaukset 60 minuutissa', L => num(L.blk, 1)],
  ];
  // Each part shows its value; the best and worst unit of the same kind in that part get a colour.
  const profile = (list, parts, i) => `<div class="le-prof" style="grid-template-columns:repeat(${parts.length},minmax(0,1fr))">${parts.map(([k, fn, rows, what, show]) => {
    const vals = list.map(fn), v = vals[i], ok = vals.filter(x => x != null);
    const top = v != null && ok.length > 1 && v === Math.max(...ok) && v > 5, low = v != null && ok.length > 1 && v === Math.min(...ok) && v < -5;
    const R = rows(list[i]); if (v != null && ok.length > 1) R.push(['Sija', `${1 + ok.filter(x => x > v).length}. / ${ok.length}`]);
    return `<div class="le-pp" data-tip="${esc([what, ...R.map(r => r.join('\t'))].join('\n'))}"><span>${k}</span><b class="${top ? 'le-best' : low ? 'le-worst' : ''}">${show(list[i])}</b></div>`; }).join('')}</div>`;
  const FW = cur.map(leFwd), nD = cur.filter((l, i) => i < 3 || l.VP || l.OP).length, DF = cur.slice(0, nD).map(leDef);
  const card = (i, kind) => {
    const l = cur[i], b = LE.base[i], slots = kind === 'F' ? ['VL', 'KH', 'OL'] : ['VP', 'OP'];
    const changed = slots.some(r => b[r] !== l[r]), U = kind === 'F' ? FW[i] : DF[i];
    let extra = [];
    if (kind === 'F') {
      const hands = slots.map(r => byId.get(l[r])?.hand).filter(Boolean), lefts = hands.filter(h => h === 'LEFT').length;
      if (hands.length === 3 && (lefts === 0 || lefts === 3)) extra.push({ s: 50, t: lefts ? 'kaikki laukovat vasemmalta' : 'kaikki laukovat oikealta', neg: true });
      if (U.fo != null && U.fot >= 30 && U.fo < 0.45) extra.push({ s: 99, t: 'sentteri häviää aloitukset', neg: true });
    } else {
      const hands = slots.map(r => byId.get(l[r])?.hand).filter(Boolean);
      if (hands.length === 2 && hands[0] === hands[1]) extra.push({ s: 40, t: hands[0] === 'LEFT' ? 'molemmat laukovat vasemmalta' : 'molemmat laukovat oikealta', neg: true });
    }
    const warn = extra.length ? `<i class="le-warn" data-tip="${esc(extra.map(n => n.t[0].toUpperCase() + n.t.slice(1)).join('\n'))}">⚠️</i>` : '';
    return `<div class="le-line${changed ? ' changed' : ''}"><div class="le-n"><b>${i + 1}.</b><span>${kind === 'F' ? 'ketju' : 'pari'}</span>${warn}</div>
      <div class="le-u"><div class="le-row${kind === 'D' ? ' d' : ''}">${slots.map(r => chip(l[r], `${i}:${r}`)).join('')}</div>${val(U, kind)}</div>
      <div class="le-foot">${kind === 'F' ? profile(FW, P_F, i) : profile(DF, P_D, i)}</div></div>`;
  };
  const lines = `<div class="le-cols"><div><h3>Hyökkäysketjut</h3><div class="le-lines">${cur.map((_, i) => card(i, 'F')).join('')}</div></div>
    <div><h3>Puolustusparit</h3><div class="le-lines">${DF.map((_, i) => card(i, 'D')).join('')}</div></div></div>`;
  const now = leTeam(cur), was = leTeam(LE.base), diff = now.perGame - was.perGame;
  const bench = LE.players.filter(p => !used.has(p.id)).sort((a, b) => a.group.localeCompare(b.group) || b.toi - a.toi);
  el.innerHTML = `<h2>Kokoonpanoeditori</h2>
    <div class="chips le-sum">
      <span class="chip" data-tip="${esc(`Expected Goal Differential per Game\nMaalipaikkaero tasakentin ottelussa tällä kokoonpanolla`)}"><small>xG± / ottelu</small><b>${signed(now.perGame, 2)}</b></span>
      <span class="chip ${Math.abs(diff) < 0.005 ? '' : diff > 0 ? 'pos' : 'neg'}" data-tip="Ero viimeisimmän ottelun kokoonpanoon"><small>Muutos</small><b>${Math.abs(diff) < 0.005 ? '±0' : signed(diff, 2)}</b></span>
      <button class="sbtn sm le-reset"${LE_SLOTS.some(r => LE.cur.some((l, i) => LE.base[i][r] !== l[r])) ? '' : ' disabled'}>Palauta viimeisin kokoonpano</button>
    </div>
    <p class="muted small">${pick ? '<b>Valitse paikka tai pelaaja, jonka kanssa vaihdetaan.</b>' : 'Napauta pelaajaa ja sitten toista pelaajaa tai tyhjää paikkaa, niin ne vaihtavat paikkaa.'}</p>
    ${lines}
    <h3>Vaihtopenkki</h3><div class="le-bench">${bench.map(p => chip(p.id, null)).join('') || '<span class="muted small">Kaikki pelaajat kentissä.</span>'}</div>
    <p class="muted small">Arvio laskee pelaajien omat luvut yhteen: omat ja vastustajan maalipaikat 60 minuutissa pelaajan ollessa jäällä, ja viimeistely puolella painolla. Vähän pelanneilla luvut tasoitetaan kohti joukkueen keskiarvoa. Ketjut ja parit arvioidaan erikseen, koska parit vaihtelevat ketjujen takana. Profiilissa vihreä = ketjujen tai parien paras, punainen = heikoin. ⚠️ = huomio kokoonpanosta. Malli ei tiedä, sopivatko pelaajat yhteen, koska Liiga kertoo kentällä olleet pelaajat vain maaleista. Punainen reunus = pelaaja on muulla kuin tavallisella paikallaan.</p>`;
  // Tap to pick, tap again to swap (works the same with mouse and touch)
  const slotOf = id => { for (let i = 0; i < 4; i++) for (const r of LE_SLOTS) if (LE.cur[i][r] === id) return `${i}:${r}`; return null; };
  const setSlot = (slot, id) => { const [i, r] = slot.split(':'); LE.cur[+i][r] = id; };
  el.querySelectorAll('.le-p').forEach(b => b.onclick = () => {
    const id = b.dataset.id ? Number(b.dataset.id) : null, slot = b.dataset.slot || null;
    if (!LE.pick) { LE.pick = { id, slot }; leDraw(el); return; }
    const a = LE.pick; LE.pick = null;
    if (a.id === id && a.slot === slot) { leDraw(el); return; }
    const sa = a.slot || slotOf(a.id), sb = slot || slotOf(id);
    if (sa && sb) { setSlot(sa, id); setSlot(sb, a.id); }
    else if (sa && !sb) setSlot(sa, id);        // bench player into a slot
    else if (!sa && sb) setSlot(sb, a.id);
    leDraw(el);
  });
  const rs = el.querySelector('.le-reset'); if (rs) rs.onclick = () => { LE.cur = LE.base.map(l => ({ ...l })); LE.pick = null; leDraw(el); };
}
