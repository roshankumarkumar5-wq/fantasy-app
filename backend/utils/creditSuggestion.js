// Suggested credit-value calculation for players, used by the admin
// "Player Stats & Credits" panel (GET /api/admin/players/stats).
//
// The idea: every player starts from a role-based baseline, then the figure
// is nudged up/down based on how they have actually performed across
// completed matches. Since the app already computes Dream11-style fantasy
// points per match (utils/points.js covers batting + bowling + fielding),
// average points-per-match is the single strongest value signal and drives
// the main adjustment. Small role-specific tweaks (strike rate for batsmen,
// economy for bowlers, genuine all-round contribution) fine-tune from there.
// Suggestions are deliberately conservative for players with few matches, so
// one freak innings can't inflate (or tank) a suggestion.

// Role baselines - all-rounders are scarce and genuinely two-way, keepers
// bat + keep (two ways to score), batsmen a touch more than pure bowlers.
const ROLE_BASE_CREDIT = {
  batsman: 8.5,
  bowler: 8.0,
  'all-rounder': 9.5,
  keeper: 8.5
};

const MIN_CREDIT = 4.0;
const MAX_CREDIT = 12.0;

// A player averaging TARGET_AVG_POINTS fantasy points per match is treated as
// a mid-grade pick -> their suggestion sits right at the role baseline.
// Every POINTS_PER_CREDIT points above that baseline adds 1.0 credit (and
// vice versa below it).
const TARGET_AVG_POINTS = 40;
const POINTS_PER_CREDIT = 20;
const MAX_POINTS_ADJUSTMENT = 3.0;

// With fewer than FULL_WEIGHT_MATCHES played, the points adjustment is scaled
// down proportionally (so a 1-match sample only carries a quarter of the
// weight it would with a full season behind it).
const FULL_WEIGHT_MATCHES = 4;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function roundToHalf(v) {
  return Math.round(v * 2) / 2;
}

// player: {
//   role,
//   matches_played,
//   total_points,       (sum of base_points across completed matches)
//   total_runs,
//   total_wickets,
//   strike_rate,        (null until they meet the 30-ball minimum)
//   economy_rate        (null until they meet the 5-over minimum)
// }
// Returns { value, breakdown } where breakdown explains the figure so the
// admin UI can show where each part of the suggestion came from.
export function suggestCredit(player) {
  const role = player?.role;
  const base = ROLE_BASE_CREDIT[role] ?? 8.0;
  const matches = Number(player?.matches_played) || 0;

  const breakdown = { base, points_adjustment: 0, role_adjustment: 0, consistency_bonus: 0, total: base };

  if (matches === 0) {
    return { value: base, breakdown };
  }

  const avgPoints = (Number(player.total_points) || 0) / matches;

  // Performance vs baseline, damped by the size of the sample.
  let ptsAdj = (avgPoints - TARGET_AVG_POINTS) / POINTS_PER_CREDIT;
  ptsAdj *= Math.min(1, matches / FULL_WEIGHT_MATCHES);
  ptsAdj = clamp(ptsAdj, -MAX_POINTS_ADJUSTMENT, MAX_POINTS_ADJUSTMENT);
  breakdown.points_adjustment = Math.round(ptsAdj * 100) / 100;

  // Small role-specific fine tunes on top of the fantasy-points signal.
  let roleAdj = 0;
  if (role === 'batsman' && player.strike_rate != null) {
    // SR 120 -> 0, SR 145+ worth the max +0.5, SR 95 or worse -0.5.
    roleAdj += clamp((player.strike_rate - 120) / 50, -0.5, 0.5);
  } else if (role === 'bowler' && player.economy_rate != null) {
    // Economy 7.0 -> 0, 4.0 or tighter +0.6, 10.0 or looser -0.6.
    roleAdj += clamp((7 - player.economy_rate) * 0.2, -0.6, 0.6);
  } else if (role === 'all-rounder') {
    if ((Number(player.total_runs) || 0) > 0 && (Number(player.total_wickets) || 0) > 0) {
      roleAdj += 0.5; // genuine two-way contribution is scarce and valuable
    }
  }
  breakdown.role_adjustment = Math.round(roleAdj * 100) / 100;

  // Consistency nod for proven performers.
  let consistencyBonus = 0;
  if (matches >= FULL_WEIGHT_MATCHES && avgPoints >= 50) consistencyBonus = 0.5;
  breakdown.consistency_bonus = consistencyBonus;

  const totalRaw = base + ptsAdj + roleAdj + consistencyBonus;
  breakdown.total = roundToHalf(clamp(totalRaw, MIN_CREDIT, MAX_CREDIT));

  return { value: breakdown.total, breakdown };
}

export { ROLE_BASE_CREDIT, MIN_CREDIT, MAX_CREDIT };