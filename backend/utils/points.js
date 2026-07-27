// Dream11-style points calculation. Formula is based on the standard
// scoring structure common to Dream11/My11Circle-style platforms - values
// are hardcoded here rather than stored in the database, since the rule
// set is complex (milestones, discrete tiered bonuses) and not a good fit
// for simple per-unit multipliers. Adjust the constants/tiers below if you
// want a different scoring structure.
//
// Run-outs are split into two categories: a direct hit (one fielder
// named) scores full points; a combined run-out (2+ fielders named, e.g.
// a thrower + a fielder who breaks the stumps) scores lower per person,
// since neither individually gets full credit for it.

const POINTS_PER_RUN = 1;
const POINTS_PER_FOUR = 1;      // in addition to the run itself
const POINTS_PER_SIX = 2;       // in addition to the run itself
const DUCK_PENALTY = -2;        // batter/all-rounder out for 0

const POINTS_PER_WICKET = 25;   // excludes run-outs
const POINTS_PER_BOWLED_LBW = 8;
const POINTS_PER_MAIDEN = 8;

const POINTS_PER_FIELDING_DISMISSAL = 8; // catch, stumping, 
const POINTS_PER_RUN_OUT_DIRECT = 12;    //  direct-hit run out (One person)
const POINTS_PER_RUN_OUT_COMBINED = 6;    //  run out assisted (two person)


// Batting milestones - only the HIGHEST tier reached applies (not stacked).
const BATTING_MILESTONES = [
  { runs: 100, points: 16 },
  { runs: 75, points: 12 },
  { runs: 50, points: 8 },
  { runs: 25, points: 4 }
];

// Bowling milestones - only the HIGHEST tier reached applies (not stacked).
const BOWLING_MILESTONES = [
  { wickets: 5, points: 16 },
  { wickets: 4, points: 12 },
  { wickets: 3, points: 8 }
];

// Catch milestones - only the HIGHEST tier reached applies (not stacked).
const FIELDING_MILESTONES = [
  { catches: 5, points: 8 },
  { catches: 4, points: 6 },
  { catches: 3, points: 4 }
];

function battingMilestoneBonus(runs) {
  const tier = BATTING_MILESTONES.find(m => runs >= m.runs);
  return tier ? tier.points : 0;
}

function bowlingMilestoneBonus(wickets) {
  const tier = BOWLING_MILESTONES.find(m => wickets >= m.wickets);
  return tier ? tier.points : 0;
}

function fieldingMilestoneBonus(catches) {
  const tier = FIELDING_MILESTONES.find(m => catches >= m.catches);
  return tier ? tier.points : 0;
}

// Converts cricket over notation (e.g. 3.4 = 3 overs + 4 balls) to a
// decimal number of overs (3.667) for rate calculations.
function oversToDecimal(overs) {
  const whole = Math.floor(overs);
  const balls = Math.round((overs - whole) * 10); // the ".4" part means 4 balls
  return whole + balls / 6;
}

function economyRatePoints(runsConceded, oversBowled) {
  const decimalOvers = oversToDecimal(oversBowled);
  if (decimalOvers < 2) return 0; // minimum 2 overs bowled to qualify

  const economy = runsConceded / decimalOvers;
  if (economy <= 3) return 6;
  if (economy <= 4) return 5;
  if (economy <= 5) return 4;
  if (economy <= 6) return 3;
  if (economy <= 7) return 2;
  if (economy <= 8) return 1;
  if (economy <= 9) return 0;
  if (economy <= 10) return -2;
  if (economy <= 11) return -4;

  return -6; // Economy > 11
}

function strikeRatePoints(runs, ballsFaced) {
  if (ballsFaced < 10) return 0; // minimum 10 balls faced to qualify

  const strikeRate = (runs / ballsFaced) * 100;
  if (strikeRate >= 170) return 6;
  if (strikeRate >= 160) return 5;
  if (strikeRate >= 150) return 4;
  if (strikeRate >= 140) return 3;
  if (strikeRate >= 130) return 2;
  if (strikeRate >= 120) return 1;
  if (strikeRate >= 80) return 0;
  if (strikeRate >= 70) return -2;
  if (strikeRate >= 60) return -4;

  return -6; // Strike Rate < 60
}

// stats: { runs, balls_faced, fours, sixes, is_out, wickets, bowled_lbw_wickets,
//          maidens, overs_bowled, runs_conceded, catches, stumpings, run_outs,
//          run_out_assists }
// playerRole: 'batsman' | 'bowler' | 'all-rounder' | 'keeper' - duck penalty
// only applies to batsmen and all-rounders, per the standard rule set.
//
// Returns { lines: [{ label, points }], total } - a line-by-line breakdown
// of how the total was built up, e.g. for showing a drill-down view of a
// player's score. Only non-zero components are included, so an unused
// category (e.g. a pure batsman's bowling section) doesn't clutter it.
export function calculatePointsBreakdown(stats, playerRole) {
  const runs = stats.runs || 0;
  const ballsFaced = stats.balls_faced || 0;
  const fours = stats.fours || 0;
  const sixes = stats.sixes || 0;
  const isOut = !!stats.is_out;
  const wickets = stats.wickets || 0;
  const bowledLbwWickets = stats.bowled_lbw_wickets || 0;
  const maidens = stats.maidens || 0;
  const oversBowled = stats.overs_bowled || 0;
  const runsConceded = stats.runs_conceded || 0;
  const catches = stats.catches || 0;
  const stumpings = stats.stumpings || 0;
  const runOuts = stats.run_outs || 0;
  const runOutAssists = stats.run_out_assists || 0;

  const lines = [];
  const add = (label, points) => {
    if (points) lines.push({ label, points: Math.round(points * 10) / 10 });
  };

  // Batting
  add(`Runs (${runs})`, runs * POINTS_PER_RUN);
  add(`Boundary bonus (${fours} four${fours === 1 ? '' : 's'})`, fours * POINTS_PER_FOUR);
  add(`Six bonus (${sixes} six${sixes === 1 ? '' : 'es'})`, sixes * POINTS_PER_SIX);
  add('Batting milestone bonus', battingMilestoneBonus(runs));
  if (isOut && runs === 0 && (playerRole === 'batsman' || playerRole === 'all-rounder')) {
    add('Duck penalty', DUCK_PENALTY);
  }
  add('Strike rate bonus/penalty', strikeRatePoints(runs, ballsFaced));

  // Bowling
  add(`Wickets (${wickets})`, wickets * POINTS_PER_WICKET);
  add('Bowling milestone bonus', bowlingMilestoneBonus(wickets));
  add(`Bowled/LBW bonus (${bowledLbwWickets})`, bowledLbwWickets * POINTS_PER_BOWLED_LBW);
  add(`Maiden overs (${maidens})`, maidens * POINTS_PER_MAIDEN);
  add('Economy rate bonus/penalty', economyRatePoints(runsConceded, oversBowled));

  // Fielding
  add(`Catches (${catches})`, catches * POINTS_PER_FIELDING_DISMISSAL);
  add(`Stumpings (${stumpings})`, stumpings * POINTS_PER_FIELDING_DISMISSAL);
  add('Fielding milestone bonus', fieldingMilestoneBonus(catches));
  add(`Run out - direct hit (${runOuts})`, runOuts * POINTS_PER_RUN_OUT_DIRECT);
  add(`Run out - assisted (${runOutAssists})`, runOutAssists * POINTS_PER_RUN_OUT_COMBINED);

  const total = Math.round(lines.reduce((sum, l) => sum + l.points, 0) * 10) / 10;
  return { lines, total };
}

export function calculateBasePoints(stats, playerRole) {
  return calculatePointsBreakdown(stats, playerRole).total;
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
