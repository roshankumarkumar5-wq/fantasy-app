// Dream11-style points calculation. Formula is based on the standard
// scoring structure common to Dream11/My11Circle-style platforms - values
// are hardcoded here rather than stored in the database, since the rule
// set is complex (milestones, sliding-scale bonuses) and not a good fit
// for simple per-unit multipliers. Adjust the constants below if you want
// a different scoring structure.
//
// NOTE on two specific rules where only the two extreme values were
// available (economy rate and strike rate bonuses): the exact
// intermediate tier boundaries weren't specified, so this implements a
// straight LINEAR interpolation between the given endpoints rather than
// guessing at discrete tiers. If you have an exact tier table you want to
// match instead, replace economyRatePoints()/strikeRatePoints() below.

const POINTS_PER_RUN = 1;
const POINTS_PER_FOUR = 1;      // in addition to the run itself
const POINTS_PER_SIX = 2;       // in addition to the run itself
const DUCK_PENALTY = -2;        // batter/all-rounder out for 0

const POINTS_PER_WICKET = 25;   // excludes run-outs
const POINTS_PER_BOWLED_LBW = 8;
const POINTS_PER_MAIDEN = 8;

const POINTS_PER_FIELDING_DISMISSAL = 8; // catch, stumping, or direct-hit run out (each)

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

function battingMilestoneBonus(runs) {
  const tier = BATTING_MILESTONES.find(m => runs >= m.runs);
  return tier ? tier.points : 0;
}

function bowlingMilestoneBonus(wickets) {
  const tier = BOWLING_MILESTONES.find(m => wickets >= m.wickets);
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
//          maidens, overs_bowled, runs_conceded, catches, stumpings, run_outs }
// playerRole: 'batsman' | 'bowler' | 'all-rounder' | 'keeper' - duck penalty
// only applies to batsmen and all-rounders, per the standard rule set.
export function calculateBasePoints(stats, playerRole) {
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

  let points = 0;

  // Batting
  points += runs * POINTS_PER_RUN;
  points += fours * POINTS_PER_FOUR;
  points += sixes * POINTS_PER_SIX;
  points += battingMilestoneBonus(runs);
  if (isOut && runs === 0 && (playerRole === 'batsman' || playerRole === 'all-rounder')) {
    points += DUCK_PENALTY;
  }
  points += strikeRatePoints(runs, ballsFaced);

  // Bowling
  points += wickets * POINTS_PER_WICKET;
  points += bowlingMilestoneBonus(wickets);
  points += bowledLbwWickets * POINTS_PER_BOWLED_LBW;
  points += maidens * POINTS_PER_MAIDEN;
  points += economyRatePoints(runsConceded, oversBowled);

  // Fielding
  points += (catches + stumpings + runOuts) * POINTS_PER_FIELDING_DISMISSAL;

  return Math.round(points * 10) / 10; // round to 1 decimal place
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
