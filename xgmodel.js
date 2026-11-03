/* SaiPa Data: own expected goals model (xG) for Liiga shot attempts.
 * Logistic regression fitted on the league's shot maps, regular seasons 2015–16 to 2024–25 (2017–18 left out:
 * almost no shot maps), 354 983 attempts and 20 153 goals. Every attempt counts (also missed and blocked), as in
 * the league's own xG. Used in the situation splits, the game report and the history view; see ROADMAP XG-1.
 *
 * Test on seasons the model has not seen (the league's own xG in brackets):
 *   2025–26: AUC 0.781 (0.802), log loss 0.1936 (0.1852), 2 500 xG for 2 513 goals
 *   2026–27 to 3.11.: AUC 0.783 (0.815), log loss 0.1802 (0.1671)
 *   The league's model is a little sharper on single shots (it likely knows the shot type or the pass before it,
 *   which the shot map does not show). Team level, split-half (first half of a season predicting points per game
 *   in the second half): 136 team seasons 2015–16 to 2024–25: own xG% r = 0.566, goal share 0.560, points per game
 *   0.529, 5v5 shot attempts 0.493. 2025–26 (16 teams): own xG% 0.665, the league's xG% 0.650.
 *   The main gain: xG for every season from 2015–16, while the league's per-shot xG starts in 2025–26.
 *
 * Score effects with this model, 5v5, home team's xG share by score state (home minus away goals, capped at ±2):
 *   −2: 55.2 %, −1: 53.7 %, 0: 52.6 %, +1: 50.9 %, +2: 49.5 % → XG_SA weights [home, away] below.
 */

// Feature vector for one attempt. s: shot normalised so that the shooting team attacks the right net (x, y as
// normShot() gives them), with context: reb, rush (shotContext), hand ('L'/'R'), dtp (seconds since the previous
// attempt by either team in the same period, 99 if none), pp, sh (power play / shorthanded shot), ownEmpty,
// oppEmpty (shooting team's / opponent's net empty), short (4 v 4 or 3 v 3), period.
const XG_DB = [3, 5, 7, 9, 11, 14, 18], XG_AB = [15, 30, 45, 60, 75];
function xgFeatures(s) {
  const M = 16.7, GX = 933, CY = 255;
  const dx = GX - s.x, dy = s.y - CY;
  const dist = Math.max(0.3, Math.hypot(dx, dy) / M);
  const ang = Math.abs(Math.atan2(Math.abs(dy), dx)) * 180 / Math.PI;
  const behind = s.x > GX ? 1 : 0;
  const ow = !s.hand || behind || Math.abs(dy) < 1.5 * M ? 0 : ((s.hand === 'L') === (s.y > CY) ? 1 : 0);
  const reb = s.reb ? 1 : 0, rush = s.rush ? 1 : 0, dtp = Math.min(s.dtp ?? 99, 30), pp = s.pp ? 1 : 0;
  return [dist, Math.log(dist), ang / 90, dist * ang / 900, behind,
    ...XG_DB.map(b => dist < b ? 1 : 0), ...XG_AB.map(b => ang < b ? 1 : 0),
    reb, reb * ang / 90, reb * dist / 10, reb && dtp <= 1 ? 1 : 0, rush, rush * dist / 10,
    pp, s.sh ? 1 : 0, s.oppEmpty ? 1 : 0, s.ownEmpty ? 1 : 0, s.short ? 1 : 0, ow,
    s.period === 4 ? 1 : 0, !reb && dtp <= 1 ? 1 : 0, !reb && dtp <= 3 ? 1 : 0, pp * dist / 10];
}
const XG_B0 = -3.78919;
const XG_B = [0.07299, -0.77111, 0.26505, -0.866, 0.10304, 0.01775, 0.10228, 0.12167, 0.34664, 0.5529, 0.74815, 0.31312,
  0.04327, 0.05112, 0.14702, 0.24125, 0.00379, 0.66611, 0.19463, -0.21526, 0.07101, -0.09707, 0.2416, 0.05996, 0.20351,
  3.11055, -0.81176, 0.27491, 0.02593, 0.15541, 0.16212, 0.57797, 0.40178];
function ownXg(s) {
  const f = xgFeatures(s);
  let e = XG_B0;
  for (let i = 0; i < f.length; i++) e += XG_B[i] * f[i];
  return 1 / (1 + Math.exp(-e));
}
// Score and venue adjustment for this model's 5v5 xG, seasons 2015–16 to 2024–25: [home weight, away weight]
const XG_SA = { '-2': [0.947, 1.065], '-1': [0.973, 1.032], 0: [0.994, 1.007], 1: [1.027, 0.972], 2: [1.056, 0.946] };

// Own xG for every attempt of one game, written to s.oxg. sm: cleaned shot map rows, g: the game's data (rosters
// for stick hands via shotContext, goalie events for empty nets). Rows in the shootout get no value.
function annotateOwnXg(sm, g) {
  if (!Array.isArray(sm) || !sm.length) return sm;
  if (sm.some(s => s.reb === undefined) && typeof shotContext === 'function') shotContext(sm, g);
  const G = g?.game;
  const enOf = T => ((T?.goalKeeperEvents) || []).filter(e => e.emptyNet).map(e => [e.beginTime, e.endTime ?? 99999]);
  const h = teamNum(G?.homeTeam?.teamId), enH = enOf(G?.homeTeam), enA = enOf(G?.awayTeam);
  const inside = (iv, t) => iv.some(([b, e]) => b <= t && t < e);
  const seq = sm.filter(s => (s.period || 0) <= 4).sort((a, b) => a.gameTime - b.gameTime);
  seq.forEach((s, i) => {
    const prev = seq[i - 1], t = s.gameTime || 0;
    const home = teamNum(s.shootingTeamId) === h;
    const own = inside(home ? enH : enA, t), opp = inside(home ? enA : enH, t);
    const flip = s.shootingTeamId !== s.leftTeam;
    const pp = s.type === 'PowerplayShot', sh = s.type === 'ShorthandedShot';
    s.oxg = ownXg({
      x: flip ? 1000 - s.shotX : s.shotX, y: flip ? 510 - s.shotY : s.shotY,
      reb: s.reb, rush: s.rush, hand: s.hand, dtp: prev && prev.period === s.period ? t - prev.gameTime : 99,
      pp, sh, ownEmpty: own, oppEmpty: opp, period: s.period,
      short: !pp && !sh && !own && !opp && !(s.ownTeamPlayersOnIce === 6 && s.otherTeamPlayersOnIce === 6),
    });
  });
  return sm;
}
