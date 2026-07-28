import express from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// This app has no persistent background scheduler (no cron job running
// separately from requests), so "lock the match once its deadline passes"
// is done lazily: every time matches are read (list or detail), any
// still-"upcoming" match whose deadline has passed gets flipped to
// "locked" right then, before being returned. This keeps the stored
// status accurate for anyone viewing it, without needing extra infra.
async function autoLockExpiredMatches() {
  try {
    await supabase
      .from('matches')
      .update({ status: 'locked' })
      .eq('status', 'upcoming')
      .lt('selection_deadline', new Date().toISOString());
  } catch (err) {
    // Non-fatal - worst case, a match stays "upcoming" in the UI a little
    // longer, but the deadline check in fantasy-teams submission still
    // blocks late entries regardless of this flag.
    console.error('autoLockExpiredMatches failed (non-fatal):', err.message);
  }
}

// GET /api/matches - list all matches (upcoming first)
router.get('/', requireAuth, async (req, res) => {
  await autoLockExpiredMatches();

  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, match_date, selection_deadline, squad_size, status, venue, match_format,
      team_a:team_a_id ( id, name, short_code, logo_url ),
      team_b:team_b_id ( id, name, short_code, logo_url )
    `)
    .order('match_date', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/matches/:id - match detail with available players (auto-derived from
// the two real teams playing) and special-player rules
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  await autoLockExpiredMatches();

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select(`
      id, match_date, selection_deadline, squad_size, status, venue, match_format, scoresheet_url,
      team_a:team_a_id ( id, name, short_code, logo_url ),
      team_b:team_b_id ( id, name, short_code, logo_url )
    `)
    .eq('id', id)
    .single();

  if (matchErr) return res.status(404).json({ error: 'Match not found' });

  const { data: specialRules } = await supabase
    .from('match_special_rules')
    .select('enabled, multipliers')
    .eq('match_id', id)
    .maybeSingle();

  const { data: creditRules } = await supabase
    .from('match_credit_rules')
    .select('enabled, max_credits')
    .eq('match_id', id)
    .maybeSingle();

  // Players are automatically every player belonging to either of the two
  // real teams playing this match - no separate pool to manage.
  const teamIds = [match.team_a.id, match.team_b.id];
  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id, name, role, photo_url, real_team_id, credit_value')
    .in('real_team_id', teamIds);

  if (playersErr) return res.status(500).json({ error: playersErr.message });

  // Attach each player's accumulated points from past completed matches
  const playerIds = players.map(p => p.id);
  const { data: accPoints } = await supabase
    .from('player_match_stats')
    .select('player_id, base_points, match:match_id ( status )')
    .in('player_id', playerIds);

  const accMap = new Map();
  for (const row of accPoints || []) {
    if (row.match?.status === 'completed') {
      const prev = accMap.get(row.player_id) || 0;
      accMap.set(row.player_id, prev + Number(row.base_points));
    }
  }
  const playersWithAcc = players.map(p => ({
    ...p,
    accumulated_points: Math.round((accMap.get(p.id) || 0) * 10) / 10
  }));

  res.json({
    match,
    special_rules: specialRules || { enabled: false, multipliers: [] },
    credit_rules: creditRules || { enabled: false, max_credits: null },
    players: playersWithAcc
  });
});

// GET /api/matches/:id/submitters - users who have submitted teams, ordered by
// submission time (earliest first). Includes user_id so the frontend can fetch
// individual team details when the match is locked or completed.
router.get('/:id/submitters', requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('user_teams')
    .select('user_id, user:user_id ( full_name ), submitted_at')
    .eq('match_id', id)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  res.json((data || []).map(row => ({
    user_id: row.user_id,
    full_name: row.user?.full_name || 'Unknown',
    submitted_at: row.submitted_at
  })));
});

// GET /api/matches/:id/leaderboard - public leaderboard for logged-in users.
// For completed matches, user_id is included so users can click through to
// see each other's teams. During selection/locked, user_id is omitted for privacy.
router.get('/:id/leaderboard', requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: match } = await supabase
    .from('matches')
    .select('status')
    .eq('id', id)
    .single();

  const { data, error } = await supabase
    .from('user_teams')
    .select('user_id, total_points, user:user_id ( full_name )')
    .eq('match_id', id)
    .order('total_points', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const showUserIds = match?.status === 'completed';

  const ranked = data.map((row, i) => ({
    rank: i + 1,
    full_name: row.user?.full_name || 'Unknown',
    total_points: row.total_points,
    ...(showUserIds ? { user_id: row.user_id } : {}),
    is_you: row.user_id === req.user.id
  }));

  res.json(ranked);
});

export default router;
