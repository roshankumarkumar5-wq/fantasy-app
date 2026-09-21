import {
  MIN_PER_TEAM, MAX_PER_TEAM,
  MIN_BATTER, MIN_BOWLER, MIN_KEEPER, MIN_ALL_ROUNDER
} from './teamValidation.js';
import { supabase } from '../db/supabase.js';

// Yields every k-sized combination of the given array (order-independent).
function* combinations(arr, k) {
  const n = arr.length;
  if (k > n || k < 0) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map(i => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

// Find the ideal (highest-scoring) fantasy squad for a completed match,
// honoring the same rules users had to follow when picking:
//   - exactly squadSize players
//   - between MIN_PER_TEAM and MAX_PER_TEAM from each of the two teams
//   - at least MIN_BATTER batsmen, MIN_BOWLER bowlers, MIN_KEEPER keeper,
//     MIN_ALL_ROUNDER all-rounder
//   - total credits within max_credits (only when credit rules are enabled)
//
// players: [{ id, name, role, credit_value, real_team_id, base_points }] -
// only players that actually have final stats for this match.
//
// Returns { lineup, baseTotal, creditsTotal, projectedTotal, multipliers, counts }
// or null when no squad satisfies every constraint.
export function findIdealTeam({ squadSize, players, teamAId, teamBId, specialRules, creditRules }) {
  const teamA = players.filter(p => p.real_team_id === teamAId);
  const teamB = players.filter(p => p.real_team_id === teamBId);

  const maxCredits = creditRules?.enabled ? Number(creditRules.max_credits) : null;
  const teamCount = squadSize != null ? Number(squadSize) : 7;

  const iMin = Math.max(MIN_PER_TEAM, teamCount - MAX_PER_TEAM);
  const iMax = Math.min(MAX_PER_TEAM, teamCount - MIN_PER_TEAM);

  let best = null;

  for (let i = iMin; i <= iMax; i++) {
    const sizeB = teamCount - i;

    // Pre-aggregate every B-side combination for this split.
    const bCombos = [];
    for (const combo of combinations(teamB, sizeB)) {
      let pts = 0, cr = 0, bat = 0, bowl = 0, keep = 0, ar = 0;
      for (const p of combo) {
        pts += p.base_points;
        cr += Number(p.credit_value);
        if (p.role === 'batsman') bat++;
        else if (p.role === 'bowler') bowl++;
        else if (p.role === 'keeper') keep++;
        else ar++;
      }
      if (maxCredits != null && cr > maxCredits) continue;
      bCombos.push({ combo, pts, cr, bat, bowl, keep, ar });
    }
    if (bCombos.length === 0 && sizeB > 0) continue;

    for (const comboA of combinations(teamA, i)) {
      let ptsA = 0, crA = 0, batA = 0, bowlA = 0, keepA = 0, arA = 0;
      for (const p of comboA) {
        ptsA += p.base_points;
        crA += Number(p.credit_value);
        if (p.role === 'batsman') batA++;
        else if (p.role === 'bowler') bowlA++;
        else if (p.role === 'keeper') keepA++;
        else arA++;
      }
      if (maxCredits != null && crA > maxCredits) continue;

      for (const b of bCombos) {
        if (maxCredits != null && crA + b.cr > maxCredits) continue;
        if (batA + b.bat < MIN_BATTER) continue;
        if (bowlA + b.bowl < MIN_BOWLER) continue;
        if (keepA + b.keep < MIN_KEEPER) continue;
        if (arA + b.ar < MIN_ALL_ROUNDER) continue;

        const total = ptsA + b.pts;
        if (!best || total > best.points) {
          best = { points: total, credits: crA + b.cr, lineup: [...comboA, ...b.combo] };
        }
      }
    }
  }

  if (!best) return null;

  // Assign special ranks to the top scorers in the ideal squad (highest
  // points gets rank 1, next gets rank 2, ...) when special picks are on.
  const multipliers = specialRules?.enabled ? (specialRules.multipliers || []).map(Number) : [];
  const sorted = [...best.lineup].sort((a, b) => b.base_points - a.base_points);
  const lineup = sorted.map((p, idx) => ({
    ...p,
    special_rank: idx < multipliers.length ? idx + 1 : null
  }));

  let projectedTotal = 0;
  for (const p of lineup) {
    let pts = p.base_points;
    if (p.special_rank && multipliers[p.special_rank - 1]) {
      pts *= multipliers[p.special_rank - 1];
    }
    projectedTotal += pts;
  }

  const counts = { teamA: 0, teamB: 0, batsman: 0, bowler: 0, keeper: 0, 'all-rounder': 0 };
  for (const p of lineup) {
    if (p.real_team_id === teamAId) counts.teamA++;
    else counts.teamB++;
    counts[p.role]++;
  }

  return {
    lineup,
    baseTotal: best.points,
    creditsTotal: best.credits,
    projectedTotal: Math.round(projectedTotal * 10) / 10,
    multipliers,
    counts
  };
}

// Loads every piece of data needed and computes the ideal squad for a
// completed match. Shared by the admin endpoint (always allowed) and the
// user-facing endpoint (gated by app_config.enable_ideal_team_visibility),
// so both routes always agree on the result.
//
// Returns { ok: true, payload } on success, or { ok: false, status, error }.
export async function getIdealTeamForMatch(matchId) {
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('id, squad_size, status, team_a_id, team_b_id, team_a:real_teams!team_a_id(name, short_code), team_b:real_teams!team_b_id(name, short_code)')
    .eq('id', matchId)
    .single();
  if (matchErr || !match) return { ok: false, status: 404, error: 'Match not found' };
  if (match.status !== 'completed') {
    return { ok: false, status: 400, error: 'Ideal team is available once the match is completed' };
  }

  const [specialRules, creditRules] = await Promise.all([
    supabase.from('match_special_rules').select('enabled, multipliers').eq('match_id', matchId).maybeSingle(),
    supabase.from('match_credit_rules').select('enabled, max_credits').eq('match_id', matchId).maybeSingle()
  ]);

  const { data: stats, error: statsErr } = await supabase
    .from('player_match_stats')
    .select('player_id, base_points, player:player_id ( id, name, role, credit_value, real_team_id )')
    .eq('match_id', matchId);
  if (statsErr) return { ok: false, status: 500, error: statsErr.message };

  const players = (stats || [])
    .map(s => ({
      id: s.player_id,
      name: s.player?.name || 'Unknown',
      role: s.player?.role,
      credit_value: Number(s.player?.credit_value ?? 0),
      real_team_id: s.player?.real_team_id,
      base_points: Number(s.base_points || 0)
    }))
    .filter(p => p.real_team_id === match.team_a_id || p.real_team_id === match.team_b_id);

  const ideal = findIdealTeam({
    squadSize: match.squad_size,
    players,
    teamAId: match.team_a_id,
    teamBId: match.team_b_id,
    specialRules: specialRules.data || null,
    creditRules: creditRules.data || null
  });

  if (!ideal) {
    return {
      ok: true,
      payload: {
        match_label: `${match.team_a?.short_code || '?'} vs ${match.team_b?.short_code || '?'}`,
        ideal_team: null,
        message: 'Not enough players with final stats to form a valid squad for this match.'
      }
    };
  }

  return {
    ok: true,
    payload: {
      match_label: `${match.team_a?.short_code || '?'} vs ${match.team_b?.short_code || '?'}`,
      team_a_name: match.team_a?.name,
      team_b_name: match.team_b?.name,
      team_a_id: match.team_a_id,
      team_b_id: match.team_b_id,
      squad_size: match.squad_size,
      credit_limit: creditRules.data?.enabled ? Number(creditRules.data.max_credits) : null,
      multipliers: specialRules.data?.enabled ? (specialRules.data.multipliers || []) : [],
      ideal_team: ideal.lineup,
      base_total: ideal.baseTotal,
      credits_total: ideal.creditsTotal,
      projected_total: ideal.projectedTotal,
      counts: ideal.counts
    }
  };
}