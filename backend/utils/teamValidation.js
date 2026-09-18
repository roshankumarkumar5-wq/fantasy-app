import { supabase } from '../db/supabase.js';

export const MIN_PER_TEAM = 4;
export const MAX_PER_TEAM = 7;
export const MIN_BATTER = 2;
export const MIN_BOWLER = 2;
export const MIN_KEEPER = 1;
export const MIN_ALL_ROUNDER = 1;

// Evaluate a submitted squad against every rule for a match. Used both by the
// user submission endpoint (authoritative check) and by the admin "Validate
// Teams" tool on the match leaderboard, so the rules stay in one place.
//
// inputs:
//   match          - matches row (needs id, squad_size, team_a_id, team_b_id)
//   playerIds      - array of selected player ids
//   specialPicks   - array of { player_id, special_rank }
//   specialRules   - optional preloaded match_special_rules row; fetched if omitted
//   creditRules    - optional preloaded match_credit_rules row; fetched if omitted
//   pickedPlayers  - optional preloaded players rows (id, real_team_id,
//                    credit_value, role); fetched if omitted
//
// returns: { valid, errors, totalCredits, creditLimit, playerCount }
//   errors is an array of human-readable rule violations (empty when valid).
export async function validateTeam({ match, playerIds, specialPicks = [], specialRules, creditRules, pickedPlayers }) {
  const errors = [];
  const cleanIds = playerIds || [];
  const cleanPicks = Array.isArray(specialPicks) ? specialPicks : [];

  // 1. Squad size must match exactly.
  if (match.squad_size != null && cleanIds.length !== match.squad_size) {
    errors.push(`You must select exactly ${match.squad_size} players (selected ${cleanIds.length})`);
  }

  // 2. Special-pick rules.
  if (specialRules === undefined) {
    const { data } = await supabase
      .from('match_special_rules')
      .select('enabled, multipliers')
      .eq('match_id', match.id)
      .maybeSingle();
    specialRules = data;
  }
  if (specialRules?.enabled) {
    const maxSpecial = (specialRules.multipliers || []).length;
    if (cleanPicks.length < maxSpecial) {
      errors.push(`You must select all ${maxSpecial} special player(s) (rank 1 and 2)`);
    }
    if (cleanPicks.length > maxSpecial) {
      errors.push(`Only ${maxSpecial} special player(s) allowed for this match`);
    }
    const ranksUsed = new Set(cleanPicks.map(p => p.special_rank));
    if (ranksUsed.size !== cleanPicks.length) {
      errors.push('Duplicate special ranks are not allowed');
    }
    for (const pick of cleanPicks) {
      if (!cleanIds.includes(pick.player_id)) {
        errors.push('Special player must be one of the selected squad players');
      }
    }
  } else if (cleanPicks.length > 0) {
    errors.push('Special player selection is disabled for this match');
  }

  // 3. Load the picked players (if the caller didn't already).
  if (!pickedPlayers) {
    const { data } = await supabase
      .from('players')
      .select('id, real_team_id, credit_value, role')
      .in('id', cleanIds);
    pickedPlayers = data || [];
  }
  if (pickedPlayers.length !== cleanIds.length) {
    errors.push('One or more selected players could not be found');
  }

  // 4. Player pool: every player must belong to one of the two teams in the
  //    match, with MIN_PER_TEAM..MAX_PER_TEAM picked from each side.
  let countA = 0, countB = 0;
  for (const p of pickedPlayers) {
    if (p.real_team_id === match.team_a_id) countA++;
    else if (p.real_team_id === match.team_b_id) countB++;
    else errors.push('All players must belong to one of the two teams playing this match');
  }
  if (countA < MIN_PER_TEAM || countA > MAX_PER_TEAM) {
    errors.push(`You selected ${countA} player(s) from Team A - must be between ${MIN_PER_TEAM} and ${MAX_PER_TEAM}`);
  }
  if (countB < MIN_PER_TEAM || countB > MAX_PER_TEAM) {
    errors.push(`You selected ${countB} player(s) from Team B - must be between ${MIN_PER_TEAM} and ${MAX_PER_TEAM}`);
  }

  // 5. Role composition minimums.
  const countBat = pickedPlayers.filter(p => p.role === 'batsman').length;
  const countBowl = pickedPlayers.filter(p => p.role === 'bowler').length;
  const countKeep = pickedPlayers.filter(p => p.role === 'keeper').length;
  const countAllRounder = pickedPlayers.filter(p => p.role === 'all-rounder').length;
  if (countBat < MIN_BATTER) errors.push(`You need at least ${MIN_BATTER} batsmen (selected ${countBat})`);
  if (countBowl < MIN_BOWLER) errors.push(`You need at least ${MIN_BOWLER} bowlers (selected ${countBowl})`);
  if (countKeep < MIN_KEEPER) errors.push(`You need at least ${MIN_KEEPER} wicket-keeper (selected ${countKeep})`);
  if (countAllRounder < MIN_ALL_ROUNDER) errors.push(`You need at least ${MIN_ALL_ROUNDER} all-rounder (selected ${countAllRounder})`);

  // 6. Credit budget (only when this match has credit rules enabled).
  if (creditRules === undefined) {
    const { data } = await supabase
      .from('match_credit_rules')
      .select('enabled, max_credits')
      .eq('match_id', match.id)
      .maybeSingle();
    creditRules = data;
  }
  const totalCredits = pickedPlayers.reduce((sum, p) => sum + Number(p.credit_value), 0);
  const creditLimit = creditRules?.enabled ? Number(creditRules.max_credits) : null;
  if (creditRules?.enabled && totalCredits > Number(creditRules.max_credits)) {
    errors.push(`Your team uses ${totalCredits.toFixed(1)} credits, which exceeds the ${Number(creditRules.max_credits).toFixed(1)} credit limit for this match`);
  }

  return { valid: errors.length === 0, errors, totalCredits, creditLimit, playerCount: cleanIds.length };
}