import express from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/matches - list all matches (upcoming first)
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, match_date, selection_deadline, squad_size, status,
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

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select(`
      id, match_date, selection_deadline, squad_size, status, scoresheet_url,
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

  // Players are automatically every player belonging to either of the two
  // real teams playing this match - no separate pool to manage.
  const teamIds = [match.team_a.id, match.team_b.id];
  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id, name, role, photo_url, real_team_id')
    .in('real_team_id', teamIds);

  if (playersErr) return res.status(500).json({ error: playersErr.message });

  res.json({
    match,
    special_rules: specialRules || { enabled: false, multipliers: [] },
    players
  });
});

// GET /api/matches/:id/leaderboard - public leaderboard for logged-in users
router.get('/:id/leaderboard', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('user_teams')
    .select('user_id, total_points, user:user_id ( full_name )')
    .eq('match_id', id)
    .order('total_points', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Don't leak other users' internal ids beyond what's needed to highlight "you"
  const ranked = data.map((row, i) => ({
    rank: i + 1,
    full_name: row.user?.full_name || 'Unknown',
    total_points: row.total_points,
    is_you: row.user_id === req.user.id
  }));

  res.json(ranked);
});

export default router;
