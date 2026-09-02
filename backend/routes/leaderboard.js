import express from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/leaderboard/overall
// Returns every user's accumulated points across all completed matches,
// with a per-match breakdown, sorted by total descending.
router.get('/overall', requireAuth, async (req, res) => {
  const { data: completedMatches } = await supabase
    .from('matches')
    .select('id, team_a_id, team_b_id, match_date, team_a:team_a_id ( id, name, short_code ), team_b:team_b_id ( id, name, short_code )')
    .eq('status', 'completed');

  if (!completedMatches || completedMatches.length === 0) {
    return res.json([]);
  }

  const matchIds = completedMatches.map(m => m.id);
  const matchInfo = new Map(completedMatches.map(m => [m.id, m]));

  const { data: userTeams, error } = await supabase
    .from('user_teams')
    .select('user_id, total_points, match_id, user:user_id ( full_name )')
    .in('match_id', matchIds)
    .not('total_points', 'is', null);

  if (error) return res.status(500).json({ error: error.message });

  const userMap = new Map();
  for (const row of userTeams || []) {
    const m = matchInfo.get(row.match_id);
    if (!m) continue;

    if (!userMap.has(row.user_id)) {
      userMap.set(row.user_id, {
        user_id: row.user_id,
        full_name: row.user?.full_name || 'Unknown',
        total_points: 0,
        matches: []
      });
    }

    const entry = userMap.get(row.user_id);
    const pts = Number(row.total_points) || 0;
    entry.total_points += pts;
    entry.matches.push({
      match_id: row.match_id,
      match_label: `${m.team_a?.short_code || '?'} vs ${m.team_b?.short_code || '?'}`,
      match_date: m.match_date,
      points: Math.round(pts * 10) / 10
    });
  }

  const result = Array.from(userMap.values())
    .map(u => ({
      ...u,
      total_points: Math.round(u.total_points * 10) / 10,
      matches: u.matches.sort((a, b) => new Date(b.match_date) - new Date(a.match_date))
    }))
    .sort((a, b) => b.total_points - a.total_points);

  res.json(result);
});

// GET /api/leaderboard/players
// Ranks players (across both teams) by a chosen stat accumulated across all
// completed matches. Supports:
//   ?sortBy=points|runs|wickets|catches|fours|sixes|best_score|strike_rate|
//            economy|stumpings|run_outs|picks|captain  (default: points)
//   ?matchId=<uuid>  restricts every board to a single match (completed).
// Returns every player's aggregated stats so the frontend can also re-sort
// instantly without another request. Gated by the admin's
// app_config.enable_player_leaderboard toggle for non-admins only - admins
// can always view it (e.g. to check the board while the user tab is hidden).
const STRIKE_RATE_MIN_BALLS = 30;   // ignore batting SR with fewer balls faced
const ECONOMY_MIN_OVERS = 5;        // ignore bowling economy with fewer overs

const PLAYER_STAT_SORTS = {
  points: { column: 'total_points', asc: false, filter: e => e.total_points > 0 },
  runs: { column: 'total_runs', asc: false, filter: e => e.total_runs > 0 },
  wickets: { column: 'total_wickets', asc: false, filter: e => e.total_wickets > 0 },
  catches: { column: 'total_catches', asc: false, filter: e => e.total_catches > 0 },
  fours: { column: 'total_fours', asc: false, filter: e => e.total_fours > 0 },
  sixes: { column: 'total_sixes', asc: false, filter: e => e.total_sixes > 0 },
  best_score: { column: 'best_runs', asc: false, filter: e => e.best_runs > 0 },
  strike_rate: { column: 'strike_rate', asc: false, filter: e => e.strike_rate != null },
  economy: { column: 'economy_rate', asc: true, filter: e => e.economy_rate != null },
  stumpings: { column: 'total_stumpings', asc: false, filter: e => e.total_stumpings > 0 },
  run_outs: { column: 'total_run_outs', asc: false, filter: e => e.total_run_outs > 0 },
  picks: { column: 'picks', asc: false, filter: e => e.picks > 0 },
  captain: { column: 'captain_picks', asc: false, filter: e => e.captain_picks > 0 }
};

// Cricket-notation overs ("3.4" = 3 overs + 4 balls) -> real decimal overs.
function oversToBalls(overs) {
  const whole = Math.floor(overs);
  const balls = Math.round((overs - whole) * 10);
  return whole * 6 + balls;
}

router.get('/players', requireAuth, async (req, res) => {
  const isAdmin = req.user?.role === 'admin';

  if (!isAdmin) {
    const { data: config } = await supabase
      .from('app_config')
      .select('enable_player_leaderboard')
      .maybeSingle();

    if (!(config?.enable_player_leaderboard ?? true)) {
      return res.status(403).json({ error: 'The player leaderboard is disabled by the admin.', enabled: false });
    }
  }

  const sortMeta = PLAYER_STAT_SORTS[req.query.sortBy] || PLAYER_STAT_SORTS.points;
  const matchId = req.query.matchId || null;

  // Base list of every player, so boards like "Most Picked" can show someone
  // who has been picked often even before they register any stats.
  const { data: allPlayers } = await supabase
    .from('players')
    .select('id, name, role, team:real_team_id ( name, short_code, logo_url )');

  const byPlayer = new Map((allPlayers || []).map(p => [p.id, {
    player_id: p.id,
    name: p.name,
    role: p.role,
    team: p.team || null,
    matches_played: 0,
    total_points: 0,
    total_runs: 0,
    total_wickets: 0,
    total_catches: 0,
    total_fours: 0,
    total_sixes: 0,
    total_stumpings: 0,
    total_run_outs: 0,
    total_run_out_assists: 0,
    total_bowled_lbw_wickets: 0,
    total_balls_faced: 0,
    total_overs_bowled: 0,
    total_runs_conceded: 0,
    best_runs: 0,
    strike_rate: null,
    economy_rate: null,
    picks: 0,
    captain_picks: 0
  }]));

  // Match stats (completed matches only, or a single match if ?matchId=).
  let statsQuery = supabase
    .from('player_match_stats')
    .select('player_id, base_points, runs, wickets, catches, fours, sixes, stumpings, run_outs, run_out_assists, bowled_lbw_wickets, balls_faced, overs_bowled, runs_conceded, match:match_id ( status )');
  if (matchId) statsQuery = statsQuery.eq('match_id', matchId);

  const { data: statsRows, error } = await statsQuery;
  if (error) return res.status(500).json({ error: error.message });

  for (const row of statsRows || []) {
    if (row.match?.status !== 'completed') continue;
    const entry = byPlayer.get(row.player_id);
    if (!entry) continue;

    entry.matches_played += 1;
    entry.total_points += Number(row.base_points) || 0;
    entry.total_runs += Number(row.runs) || 0;
    entry.total_wickets += Number(row.wickets) || 0;
    entry.total_catches += Number(row.catches) || 0;
    entry.total_fours += Number(row.fours) || 0;
    entry.total_sixes += Number(row.sixes) || 0;
    entry.total_stumpings += Number(row.stumpings) || 0;
    entry.total_run_outs += Number(row.run_outs) || 0;
    entry.total_run_out_assists += Number(row.run_out_assists) || 0;
    entry.total_bowled_lbw_wickets += Number(row.bowled_lbw_wickets) || 0;
    entry.total_balls_faced += Number(row.balls_faced) || 0;
    entry.total_overs_bowled += Number(row.overs_bowled) || 0;
    entry.total_runs_conceded += Number(row.runs_conceded) || 0;
    entry.best_runs = Math.max(entry.best_runs, Number(row.runs) || 0);
  }

  // How often each player was picked / captained in submitted fantasy teams.
  // Counted across ALL matches by default, or only within ?matchId when set
  // (this is about selection popularity, not performance, so locked/upcoming
  // matches count too).
  let picksQuery = supabase
    .from('user_team_players')
    .select('player_id, special_rank, user_team:user_team_id ( match_id )');
  if (matchId) picksQuery = picksQuery.eq('user_team.match_id', matchId);

  const { data: pickRows, error: picksErr } = await picksQuery;
  if (picksErr) return res.status(500).json({ error: picksErr.message });

  for (const row of pickRows || []) {
    const entry = byPlayer.get(row.player_id);
    if (!entry) continue;
    entry.picks += 1;
    if (Number(row.special_rank) === 1) entry.captain_picks += 1;
  }

  // Derived, minimum-sample boards.
  for (const entry of byPlayer.values()) {
    if (entry.total_balls_faced >= STRIKE_RATE_MIN_BALLS) {
      entry.strike_rate = Math.round((entry.total_runs / entry.total_balls_faced) * 1000) / 10;
    }
    if (entry.total_overs_bowled >= ECONOMY_MIN_OVERS) {
      const balls = oversToBalls(entry.total_overs_bowled);
      if (balls > 0) {
        entry.economy_rate = Math.round((entry.total_runs_conceded / (balls / 6)) * 100) / 100;
      }
    }
    entry.total_points = Math.round(entry.total_points * 10) / 10;
  }

  const result = Array.from(byPlayer.values())
    .filter(sortMeta.filter)
    .sort((a, b) => {
      const av = Number(a[sortMeta.column]) || 0;
      const bv = Number(b[sortMeta.column]) || 0;
      return sortMeta.asc ? av - bv : bv - av;
    })
    .map((e, i) => ({ rank: i + 1, ...e }));

  res.json(result);
});

export default router;
