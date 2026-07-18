// Calculates base points for a player's match stats using the
// global scoring_rules row. This is intentionally simple - runs,
// wickets, catches, stumpings, run-outs. Extend as needed.
export function calculateBasePoints(stats, rules) {
  const runs = stats.runs || 0;
  const wickets = stats.wickets || 0;
  const catches = stats.catches || 0;
  const stumpings = stats.stumpings || 0;
  const runOuts = stats.run_outs || 0;

  return (
    runs * Number(rules.points_per_run) +
    wickets * Number(rules.points_per_wicket) +
    catches * Number(rules.points_per_catch) +
    stumpings * Number(rules.points_per_stumping) +
    runOuts * Number(rules.points_per_run_out)
  );
}

// Applies special player multipliers to a user's team.
// teamPlayers: [{ player_id, special_rank, base_points }]
// multipliers: [2.0, 1.5] etc - index 0 applies to special_rank 1, etc.
export function calculateTeamTotal(teamPlayers, multipliers) {
  let total = 0;
  for (const p of teamPlayers) {
    let points = Number(p.base_points) || 0;
    if (p.special_rank && multipliers[p.special_rank - 1]) {
      points *= Number(multipliers[p.special_rank - 1]);
    }
    total += points;
  }
  return total;
}
