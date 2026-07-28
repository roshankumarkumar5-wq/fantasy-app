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

export default router;
