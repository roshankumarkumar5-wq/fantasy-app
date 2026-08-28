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
// Ranks players (across both teams) by points accumulated across all
// completed matches, top points first. Gated by the admin's
// app_config.enable_player_leaderboard toggle - served alongside the
// settings read that controls whether users even see the tab.
router.get('/players', requireAuth, async (req, res) => {
  const { data: config } = await supabase
    .from('app_config')
    .select('enable_player_leaderboard')
    .maybeSingle();

  if (!(config?.enable_player_leaderboard ?? true)) {
    return res.status(403).json({ error: 'The player leaderboard is disabled by the admin.', enabled: false });
  }

  const { data: statsRows, error } = await supabase
    .from('player_match_stats')
    .select('player_id, base_points, match:match_id ( status ), player:player_id ( name, role, team:real_team_id ( name, short_code, logo_url ) )');

  if (error) return res.status(500).json({ error: error.message });

  // Aggregate only stats from completed matches, per player.
  const byPlayer = new Map();
  for (const row of statsRows || []) {
    if (row.match?.status !== 'completed') continue;
    const p = row.player;
    if (!p) continue;

    const entry = byPlayer.get(row.player_id) || {
      player_id: row.player_id,
      name: p.name,
      role: p.role,
      team: p.team || null,
      total_points: 0,
      matches_played: 0
    };
    entry.total_points += Number(row.base_points) || 0;
    entry.matches_played += 1;
    byPlayer.set(row.player_id, entry);
  }

  const result = Array.from(byPlayer.values())
    .filter(e => e.total_points > 0)
    .map(e => ({ ...e, total_points: Math.round(e.total_points * 10) / 10 }))
    .sort((a, b) => b.total_points - a.total_points)
    .map((e, i) => ({ rank: i + 1, ...e }));

  res.json(result);
});

export default router;
