/* SaiPa Data: home attendance scenarios for the current season (HI-3).
 * Every remaining home game gets an estimate from the chosen comparison seasons: weekday, part of the season,
 * last home game, back-to-back games against the same opponent, and the opponent's own pull. Played games
 * replace their estimates as soon as the league reports the attendance. Uses helpers from app.js and history.js. */

const ATT_TARGET = 3700;            // SaiPa's public attendance target for 2026–27 (average per home game)
const ATT_OPP_SHRINK = 0.5;         // opponent effect = mean residual × n / (n + 0.5): one game counts two thirds

const attType = d => { const w = d.getDay(); return w === 5 ? 'pe' : (w === 6 || w === 0) ? 'la' : 'arki'; };
const attTypeFi = { arki: 'ma–to', pe: 'pe', la: 'la–su' };
// Part of the season. The Christmas break (20.12.–6.1.) is its own part: crowds are clearly bigger then.
function attPart(d) {
  const m = d.getMonth() + 1, day = d.getDate();
  if ((m === 12 && day >= 20) || (m === 1 && day <= 6)) return 'pyhät';
  return m >= 9 && m <= 10 ? 'syys–loka' : m >= 11 ? 'marras–joulu' : m === 1 ? 'tammi' : 'helmi–maalis';
}
const ATT_PARTS = ['marras–joulu', 'pyhät', 'tammi', 'helmi–maalis'];   // compared with syys–loka
const helDate = iso => new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Helsinki' }));
const attNum = v => Math.round(v).toLocaleString('fi-FI');

// One home game in a common shape. Back-to-back = same opponent at home on the day before or after.
function attGames(list) {
  const out = list.map(g => ({ ...g, d: helDate(g.start) })).sort((a, b) => a.d - b.d);
  out.forEach((g, i) => {
    const near = [out[i - 1], out[i + 1]].filter(Boolean);
    g.b2b = near.some(o => o.opp === g.opp && Math.abs(o.d - g.d) < 1.6 * 864e5);
    g.type = attType(g.d); g.part = attPart(g.d);
  });
  if (out.length) out[out.length - 1].last = true;
  return out;
}

// Least squares with a tiny ridge so that a feature missing from the data (e.g. no back-to-back games) is harmless
function attSolve(X, y) {
  const k = X[0].length, A = Array.from({ length: k }, () => new Float64Array(k)), b = new Float64Array(k);
  X.forEach((r, n) => { for (let i = 0; i < k; i++) { b[i] += r[i] * y[n]; for (let j = 0; j < k; j++) A[i][j] += r[i] * r[j]; } });
  for (let i = 1; i < k; i++) A[i][i] += 1e-3;
  for (let i = 0; i < k; i++) {          // Gauss–Jordan
    let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i] || 1e-9;
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / d; for (let c = i; c < k; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  return [...b].map((v, i) => v / (A[i][i] || 1e-9));
}

// Fits the comparison seasons. Returns an estimate function for any home game.
function attModel(byYear, years) {
  const train = years.flatMap(y => byYear.get(y) || []).filter(g => g.spect);
  if (train.length < 15) return null;
  const feats = (g, y) => [1, ...years.slice(1).map(s => (y ?? g.season) === s ? 1 : 0), g.type === 'pe' ? 1 : 0, g.type === 'la' ? 1 : 0,
    ...ATT_PARTS.map(p => g.part === p ? 1 : 0), g.last ? 1 : 0, g.b2b ? 1 : 0];
  const beta = attSolve(train.map(g => feats(g)), train.map(g => g.spect));
  // Level for a new season: the average of the comparison seasons' levels
  const base = g => { const f = feats(g, -1); const lv = years.slice(1).reduce((s, _, i) => s + beta[1 + i], 0) / years.length; return f.reduce((s, v, i) => s + v * beta[i], 0) + lv; };
  const fitted = g => feats(g).reduce((s, v, i) => s + v * beta[i], 0);
  const opp = new Map();
  for (const g of train) { const o = opp.get(g.opp) || opp.set(g.opp, { n: 0, r: 0 }).get(g.opp); o.n++; o.r += g.spect - fitted(g); }
  const oppEff = name => { const o = opp.get(name); return o ? o.r / o.n * o.n / (o.n + ATT_OPP_SHRINK) : 0; };
  const cap = Math.max(...train.map(g => g.spect));
  const k = years.length - 1;
  const eff = { pe: beta[1 + k], la: beta[2 + k], parts: ATT_PARTS.map((p, i) => [p, beta[3 + k + i]]), last: beta[3 + k + ATT_PARTS.length], b2b: beta[4 + k + ATT_PARTS.length] };
  return { est: g => Math.min(cap, base(g) + oppEff(g.opp)), oppEff, opp, eff, cap, train };
}

// This season's level against an estimate: weekday and weekend games separately, each ratio pulled toward 1
// while it rests on few games (weight n / (n + ATT_RATIO_K)). Chosen by backtesting 17 seasons (2007–2026):
// it beat both the plain estimate and the unpulled ratios at every checkpoint (4–15 home games played).
const ATT_RATIO_K = 3;
function attRatio(played, isArki, est) {
  const same = played.filter(g => (g.type === 'arki') === isArki);
  if (!same.length) return { r: 1, n: 0, raw: 1 };
  const raw = same.reduce((s, g) => s + g.spect, 0) / same.reduce((s, g) => s + est(g), 0), w = same.length / (same.length + ATT_RATIO_K);
  return { r: w * raw + (1 - w), n: same.length, raw };
}

async function renderAttendanceForecast(el, games, curSched) {
  // Home games per season: earlier seasons from the history list, this season from the live schedule (incl. upcoming)
  const byYear = new Map();
  for (const g of games.filter(g => g.home)) (byYear.get(g.season) || byYear.set(g.season, []).get(g.season)).push({ season: g.season, start: g.start, opp: g.opp, spect: g.spect || null });
  byYear.delete(SEASON);
  for (const [y, l] of byYear) byYear.set(y, attGames(l));
  const cur = attGames(curSched.filter(g => teamNum(g.homeTeamId) === SAIPA_NUM)
    .map(g => ({ season: SEASON, start: g.start, opp: g.awayTeamName, spect: g.ended ? g.spectators || null : null })));
  const avail = [...byYear.keys()].filter(y => (byYear.get(y) || []).filter(g => g.spect).length >= 15).sort((a, b) => b - a);
  if (!cur.length || !avail.length) { el.innerHTML = '<h2>Yleisöennuste</h2><p class="muted">Ennuste tarvitsee kuluvan kauden otteluohjelman ja vähintään yhden aiemman kauden yleisömäärät.</p>'; return; }
  let years = [avail[0]];   // default: the previous season
  const draw = () => {
    const M = attModel(byYear, years);
    if (!M) { el.innerHTML = '<h2>Yleisöennuste</h2><p class="muted">Valituilla kausilla on liian vähän otteluita.</p>'; return; }
    const played = cur.filter(g => g.spect), rest = cur.filter(g => !g.spect), N = cur.length;
    cur.forEach(g => { g.bench = M.est(g); });
    // This season's level: played games against their own estimates, weekdays and weekends separately
    const rArki = attRatio(played, true, g => g.bench).r, rVkl = attRatio(played, false, g => g.bench).r;
    // Tough: this season's weekday crowds against the comparison seasons' weekday crowds at the same stage
    const n = played.length, early = years.flatMap(y => (byYear.get(y) || []).slice(0, Math.max(n, 6))).filter(g => g.type === 'arki' && g.spect);
    const nowArki = played.filter(g => g.type === 'arki');
    const rTough = nowArki.length && early.length ? Math.min(1, (nowArki.reduce((s, g) => s + g.spect, 0) / nowArki.length) / (early.reduce((s, g) => s + g.spect, 0) / early.length)) : rArki;
    const rLow = Math.min(rArki, rTough);
    // Pre-game forecast for played games: the comparison level corrected only with games played before it
    // (same day type when there are any, otherwise all earlier games), so its error is an honest test
    played.forEach((g, i) => {
      const q = attRatio(played.slice(0, i), g.type === 'arki', o => o.bench);
      g.preR = q.r; g.preN = q.n;
      g.pre = Math.min(M.cap, g.bench * g.preR);
    });
    const mae = k => played.length ? played.reduce((s, g) => s + Math.abs(g.spect - g[k]), 0) / played.length : null;
    const prevOnly = years.length === 1 && years[0] === avail[0];
    const benchL = prevOnly ? 'Viime kauden taso' : 'Vertailukausien taso';
    const scen = [
      { k: 'cur', l: 'Tämän kauden taso', d: `Arkipelit ×${num(rArki, 2)}, viikonloput ×${num(rVkl, 2)}: tämän kauden toteutuneet suhteessa ${prevOnly ? 'viime kauden' : 'vertailukausien'} tasoon, vähillä otteluilla lähempänä ykköstä`, f: g => g.type === 'arki' ? rArki : rVkl },
      { k: 'bench', l: benchL, d: `${prevOnly ? 'Viime kauden' : 'Vertailukausien'} taso sellaisenaan`, f: () => 1 },
      { k: 'tough', l: 'Heikko kausi', d: `Arkipelit ×${num(rLow, 2)}, viikonloput ×${num(Math.min(1, rVkl), 2)}: arkipelit heikomman vertailun mukaan (tämän kauden taso tai vertailukausien arkipelit samassa vaiheessa kautta), viikonloput enintään ${benchL.toLowerCase()}lla`, f: g => g.type === 'arki' ? rLow : Math.min(1, rVkl) },
    ];
    const sumPlayed = played.reduce((s, g) => s + g.spect, 0);
    for (const s of scen) {
      let run = sumPlayed; s.val = new Map(); s.cum = [];
      cur.forEach((g, i) => { const v = g.spect ?? Math.min(M.cap, g.bench * s.f(g)); s.val.set(g, v); });
      let t = 0; cur.forEach((g, i) => { t += s.val.get(g); s.cum.push(t / (i + 1)); });
      s.avg = s.cum[N - 1];
    }
    const need = rest.length ? (ATT_TARGET * N - sumPlayed) / rest.length : null;
    const nowAvg = n ? sumPlayed / n : null;
    // Chips
    const chip = (k, v, tip, cls = '') => `<span class="chip ${cls}" data-tip="${esc(tip)}"><small>${k}</small><b>${v}</b></span>`;
    const chips = `<div class="chips">
      ${chip('Keskiarvo nyt', nowAvg ? attNum(nowAvg) : '–', `${n} kotiottelua pelattu`)}
      ${chip('Tavoite', attNum(ATT_TARGET), 'SaiPan julkinen tavoite: keskimäärin 3 700 katsojaa kotiottelua kohden')}
      ${need != null ? chip('Tavoitteeseen tarvitaan', `${attNum(need)} / ott.`, `Loppukauden ${rest.length} kotiottelun keskiarvo, jolla kauden keskiarvo on ${attNum(ATT_TARGET)}`) : ''}
      ${scen.map(s => chip(s.l, attNum(s.avg), `${s.d}\nKauden keskiarvo\t${attNum(s.avg)}`, s.avg >= ATT_TARGET ? 'pos' : 'neg')).join('')}
    </div>`;
    // Season picker: chips for every season with data, the previous season on by default
    const picker = `<div class="att-years"><span class="muted small">Vertailukaudet</span>${avail.slice(0, 8).map(y => `<button class="sbtn sm${years.includes(y) ? ' active' : ''}" data-y="${y}">${seasonLabel(y)}</button>`).join('')}</div>`;
    // Chart: cumulative average, played solid, scenarios dashed from the last played game
    const narrow = matchMedia('(max-width: 600px)').matches;   // phones: narrower, taller drawing so labels stay readable
    const W = narrow ? 400 : 760, H = narrow ? 260 : 230, m = { l: 46, r: 12, t: 14, b: 26 };
    const all = scen.flatMap(s => s.cum).concat(ATT_TARGET);
    const lo = Math.floor(Math.min(...all) / 250) * 250 - 100, hi = Math.ceil(Math.max(...all) / 250) * 250;
    const x = i => m.l + (N > 1 ? i / (N - 1) : 0.5) * (W - m.l - m.r), y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const line = (arr, from, to) => arr.slice(from, to + 1).map((v, j) => `${x(from + j)},${y(v)}`).join(' ');
    const ticks = []; for (let v = Math.ceil(lo / 250) * 250; v <= hi; v += 250) ticks.push(v);
    const lastP = n - 1;
    const tipFor = i => { const g = cur[i]; return `${i + 1}. kotiottelu · ${fiDate(g.start)} ${attTypeFi[g.type]}\nVastustaja\t${g.opp}\n${g.spect ? `Yleisö\t${attNum(g.spect)}\nEnnuste ennen ottelua\t${attNum(g.pre)}\n${benchL}\t${attNum(g.bench)}\nKeskiarvo tähän asti\t${attNum(scen[0].cum[i])}` : scen.map(s => `${s.l}\t${attNum(s.val.get(g))} · ka ${attNum(s.cum[i])}`).join('\n')}`; };
    const chart = `<svg viewBox="0 0 ${W} ${H}" class="gs-chart att-fc">
      ${ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="gc-grid"/><text x="${m.l - 4}" y="${y(v) + 4}" class="gc-l" style="text-anchor:end">${attNum(v)}</text>`).join('')}
      <line x1="${m.l}" x2="${W - m.r}" y1="${y(ATT_TARGET)}" y2="${y(ATT_TARGET)}" class="att-target"/><text x="${m.l + 6}" y="${y(ATT_TARGET) - 5}" class="gc-l att-target-l" style="text-anchor:start">Tavoite ${attNum(ATT_TARGET)}</text>
      ${scen.map(s => `<polyline points="${line(s.cum, Math.max(0, lastP), N - 1)}" class="att-sc att-${s.k}"/>`).join('')}
      ${n ? `<polyline points="${line(scen[0].cum, 0, lastP)}" class="att-act"/>` : ''}
      ${played.map((g, i) => `<circle cx="${x(i)}" cy="${y(scen[0].cum[i])}" r="3.5" class="att-dot"/>`).join('')}
      ${hoverCols(cur.map((_, i) => x(i)), m.t, H - m.b, cur.map((_, i) => tipFor(i)))}
      ${[0, Math.floor((N - 1) / 2), N - 1].map(i => `<text x="${x(i)}" y="${H - 8}" class="gc-l" text-anchor="middle">${fiDate(cur[i].start)}</text>`).join('')}
    </svg>
    <div class="att-legend"><span><i class="att-act"></i>Toteutunut keskiarvo</span>${scen.map(s => `<span><i class="att-${s.k}"></i>${s.l}</span>`).join('')}<span><i class="att-target"></i>Tavoite</span></div>`;
    // Table of games: two closest comparison games per opponent (same day type first, then the latest)
    const comps = g => years.flatMap(yy => byYear.get(yy) || []).filter(o => o.opp === g.opp && o.spect)
      .sort((a, b) => (a.type === g.type ? 0 : 1) - (b.type === g.type ? 0 : 1) || b.d - a.d).slice(0, 2)
      .map(o => `${['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'][o.d.getDay()]} ${fiDate(o.start)}${years.length > 1 ? `/${String(o.d.getFullYear()).slice(2)}` : ''} ${attNum(o.spect)}`).join(' · ') || 'ei vertailuottelua';
    const why = g => { const e = M.eff, parts = [`${attTypeFi[g.type]}${g.type !== 'arki' ? `\t${signed(e[g.type], 0)}` : ''}`];
      const p = e.parts.find(q => q[0] === g.part); if (p) parts.push(`${g.part}\t${signed(p[1], 0)}`);
      if (g.last) parts.push(`Kauden viimeinen kotiottelu\t${signed(e.last, 0)}`); if (g.b2b) parts.push(`Tuplaottelu (sama vastustaja peräkkäin)\t${signed(e.b2b, 0)}`);
      const o = M.opp.get(g.opp); parts.push(o ? `${g.opp} (${o.n} vertailuottelua)\t${signed(M.oppEff(g.opp), 0)}` : `${g.opp}: ei vertailuotteluita\t±0`);
      return `${benchL} ${attNum(g.bench)}\n${parts.join('\n')}`; };
    const preTip = g => `Ennuste ennen ottelua ${attNum(g.pre)}\n${benchL}\t${attNum(g.bench)}\nKerroin\t×${num(g.preR, 2)}\n${g.preN ? `${g.preN} aiempaa ${g.type === 'arki' ? 'arkipeliä' : 'viikonloppupeliä'}` : `Ei aiempia ${g.type === 'arki' ? 'arkipelejä' : 'viikonloppupelejä'}: kerroin 1`}`;
    const curTip = g => `Ennuste ${attNum(scen[0].val.get(g))}\n${benchL}\t${attNum(g.bench)}\nKerroin\t×${num(g.type === 'arki' ? rArki : rVkl, 2)} (${g.type === 'arki' ? 'arkipelit' : 'viikonloput'} tähän asti)`;
    const rows = cur.map((g, i) => `<tr class="${g.spect ? 'att-played' : ''}">
      <td>${['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'][g.d.getDay()]} ${fiDate(g.start)}</td><td>${esc(g.opp)}${g.b2b ? ' <small class="muted">tupla</small>' : ''}</td>
      ${g.spect ? `<td><b>${attNum(g.spect)}</b></td><td data-tip="${esc(preTip(g))}">${attNum(g.pre)}</td><td class="${g.spect >= g.pre ? 'pos-num' : 'neg-num'}">${signed(g.spect - g.pre, 0)}</td><td data-tip="${esc(why(g))}">${attNum(g.bench)}</td><td></td>`
        : `<td></td><td data-tip="${esc(curTip(g))}"><b>${attNum(scen[0].val.get(g))}</b></td><td></td><td data-tip="${esc(why(g))}">${attNum(g.bench)}</td><td>${attNum(scen[2].val.get(g))}</td>`}
      <td class="muted small">${esc(comps(g))}</td></tr>`).join('');
    const th = (l, tip) => `<th data-tip="${esc(tip)}">${l}</th>`;
    const table = `<div class="tablewrap"><table class="mini att-t"><thead><tr><th>Pvm</th><th>Vastustaja</th>${th('Yleisö', 'Toteutunut yleisömäärä')}${th('Ennuste', 'Tämän kauden tasolla. Pelatuissa otteluissa ennuste ennen ottelua, laskettuna vain sitä edeltäneistä otteluista')}${th('Ero', 'Toteutunut miinus ennuste')}${th(benchL, 'Mitä otteluun olisi tullut ' + benchL.toLowerCase() + 'lla. Hover näyttää, mistä luku koostuu')}${th('Heikko kausi', 'Heikossa skenaariossa: arkipelit tämän kauden heikoimmalla tasolla, viikonloput enintään ' + benchL.toLowerCase() + 'lla')}<th>Vertailuottelut</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    // Backtest: the same method one season back, from the same number of played games
    const bt = (() => {
      const tY = years[0], train = years.map(yy => yy - 1).filter(yy => byYear.has(yy));
      if (!train.length || !byYear.has(tY)) return '';
      const M2 = attModel(byYear, train), seas = byYear.get(tY); if (!M2 || !seas.length) return '';
      const k = Math.min(Math.max(n, 1), seas.length - 1), real = seas.reduce((s, g) => s + g.spect, 0) / seas.length;
      const p = seas.slice(0, k), r = seas.slice(k);
      const rA = attRatio(p, true, M2.est).r, rV = attRatio(p, false, M2.est).r;
      const fb = (p.reduce((s, g) => s + g.spect, 0) + r.reduce((s, g) => s + M2.est(g), 0)) / seas.length;
      const fc = (p.reduce((s, g) => s + g.spect, 0) + r.reduce((s, g) => s + Math.min(M2.cap, M2.est(g) * (g.type === 'arki' ? rA : rV)), 0)) / seas.length;
      return ` Testi kaudella ${seasonLabel(tY)}, laskettuna ${k} kotiottelun jälkeen: edellisen kauden taso antoi ${attNum(fb)}, kauden tasolla korjattu ${attNum(fc)}. Toteutui ${attNum(real)}.`;
    })();
    const e = M.eff;
    const how = `<details class="sf-how"><summary>Miten ennuste lasketaan</summary><ol>
      <li><b>Vertailukaudet</b>: ${years.map(seasonLabel).join(', ')} (${M.train.length} kotiottelua). Oletuksena edellinen kausi; valitse useampi napeista.</li>
      <li><b>Viikonpäivä</b> verrattuna arki-iltaan (ma–to): perjantai ${signed(e.pe, 0)}, lauantai ja sunnuntai ${signed(e.la, 0)}.</li>
      <li><b>Kauden vaihe</b> verrattuna syys–lokakuuhun: ${e.parts.map(([p, v]) => `${p} ${signed(v, 0)}`).join(', ')}. Pyhät = 20.12.–6.1.</li>
      <li><b>Erikoistapaukset</b>: kauden viimeinen kotiottelu ${signed(e.last, 0)}, tuplaottelu samaa vastustajaa vastaan peräkkäisinä päivinä ${signed(e.b2b, 0)} per ottelu.</li>
      <li><b>Vastustaja</b>: kuinka paljon vastustaja on vetänyt yli tai alle odotuksen vertailukausilla. Vähillä otteluilla vaikutusta pienennetään. Uusi vastustaja saa nollan.</li>
      <li><b>Katto</b>: ennuste ei ylitä suurinta vertailukausien yleisöä (${attNum(M.cap)}).</li>
      ${SEASON === 2027 ? '<li><b>Lippujen hinnat</b> nousivat tälle kaudelle selvästi, joten viime kauden taso ei sellaisenaan kelpaa ennusteeksi. Siksi ennuste korjataan tämän kauden toteutuneella tasolla.</li>' : ''}
      <li><b>Ennuste</b> = taso × tämän kauden kerroin, arki- ja viikonloppupeleille erikseen. Kerroin on toteutunut yleisö suhteessa tasoon, mutta muutamalla ottelulla sitä vedetään kohti ykköstä (3 ottelua: puoliväliin). Tämä osui kauden keskiarvoon parhaiten, kun tapaa testattiin kausilla 2007–2026.</li>
      <li><b>Skenaariot</b>: ${scen.map(s => `${s.l}: ${s.d.charAt(0).toLowerCase() + s.d.slice(1)}`).join('. ')}.</li></ol></details>`;
    el.innerHTML = `<h2>Yleisöennuste</h2>${picker}${chips}${chart}${table}<p class="muted small">${played.length >= 2 ? `Ennen ottelua lasketun ennusteen keskimääräinen heitto ${attNum(mae('pre'))} katsojaa (${benchL.toLowerCase()} sellaisenaan: ${attNum(mae('bench'))}). Yksittäinen ottelu heittää aina satoja katsojia; kauden keskiarvo on paljon vakaampi. ` : ''}Toteutuneet yleisömäärät korvaavat ennusteet heti, kun Liiga on ne kirjannut.${bt}</p>${how}`;
    el.querySelectorAll('.att-years .sbtn').forEach(b => b.onclick = () => {
      const yy = +b.dataset.y; years = years.includes(yy) ? (years.length > 1 ? years.filter(v => v !== yy) : years) : [...years, yy].sort((a, c) => c - a); draw();
    });
  };
  draw();
}
