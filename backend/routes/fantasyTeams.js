import express from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { calculatePointsBreakdown } from '../utils/points.js';
import { validateTeam } from '../utils/teamValidation.js';

const router = express.Router();

// POST /api/fantasy-teams
// body: { match_id, player_ids: [...], special_picks: [{ player_id, special_rank }] }
router.post('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { match_id, player_ids, special_picks = [] } = req.body;

  if (!match_id || !Array.isArray(player_ids)) {
    return res.status(400).json({ error: 'match_id and player_ids are required' });
  }

  // 1. Load match + rules
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('id, squad_size, selection_deadline, status, team_a_id, team_b_id, team_a:real_teams!team_a_id(name, short_code), team_b:real_teams!team_b_id(name, short_code)')
    .eq('id', match_id)
    .single();

  if (matchErr) return res.status(404).json({ error: 'Match not found' });

  if (new Date() > new Date(match.selection_deadline) || match.status !== 'upcoming') {
    return res.status(403).json({ error: 'Selection deadline has passed for this match' });
  }

  // Run every squad rule through the shared validator (squad size, special
  // picks, player pool, role mix, credit budget). The admin "Validate Teams"
  // tool on the match leaderboard uses the exact same logic.
  const { valid, errors } = await validateTeam({ match, playerIds: player_ids, specialPicks: special_picks });
  if (!valid) return res.status(400).json({ error: errors[0] });

  // 3. Upsert user_teams row
  const { data: userTeam, error: utErr } = await supabase
    .from('user_teams')
    .upsert(
      { user_id: userId, match_id, submitted_at: new Date().toISOString(), is_locked: false },
      { onConflict: 'user_id,match_id' }
    )
    .select('id')
    .single();

  if (utErr) return res.status(500).json({ error: utErr.message });

  // 4. Replace user_team_players
  await supabase.from('user_team_players').delete().eq('user_team_id', userTeam.id);

  const specialMap = new Map(special_picks.map(p => [p.player_id, p.special_rank]));
  const rows = player_ids.map(pid => ({
    user_team_id: userTeam.id,
    player_id: pid,
    special_rank: specialMap.get(pid) || null
  }));

  const { error: insertErr } = await supabase.from('user_team_players').insert(rows);
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  // Audit log
  const teamA = match.team_a?.short_code || '?';
  const teamB = match.team_b?.short_code || '?';
  const dateStr = new Date(match.selection_deadline).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  try { await supabase.from('audit_logs').insert({ user_id: userId, user_name: req.user.email || 'Unknown', action: 'team_submit', details: `${teamA} vs ${teamB} on ${dateStr}` }); } catch (_) {}

  res.json({ success: true, user_team_id: userTeam.id });
});

// GET /api/fantasy-teams/:match_id - get a user's team for a match.
// By default returns the logged-in user's team. If ?userId=<uuid> is provided
// and differs from the logged-in user, the match must be completed for privacy.
router.get('/:match_id', requireAuth, async (req, res) => {
  let userId = req.user.id;
  const { match_id } = req.params;
  const targetUserId = req.query.userId;

  if (targetUserId && targetUserId !== userId) {
    const { data: match } = await supabase
      .from('matches')
      .select('status')
      .eq('id', match_id)
      .single();

    // Completed matches are always public. Locked matches only expose other
    // users' teams if the admin hasn't disabled team views after lock
    // (app_config.enable_team_views_after_lock).
    const { data: config } = await supabase
      .from('app_config')
      .select('enable_team_views_after_lock')
      .maybeSingle();
    const canViewLocked = !!match && (config?.enable_team_views_after_lock ?? true);

    if (!match || (match.status !== 'completed' && !(match.status === 'locked' && canViewLocked))) {
      return res.status(403).json({ error: 'You can only view other users\' teams once the match is completed (or locked, when the admin has enabled team views after lock).' });
    }
    userId = targetUserId;
  }

  const { data: userTeam } = await supabase
    .from('user_teams')
    .select('id, submitted_at, is_locked, total_points')
    .eq('user_id', userId)
    .eq('match_id', match_id)
    .maybeSingle();

  if (!userTeam) return res.json({ team: null });

  const { data: players } = await supabase
    .from('user_team_players')
    .select(`
      special_rank,
      player:player_id ( id, name, role, photo_url )
    `)
    .eq('user_team_id', userTeam.id);

  // Pull each player's full raw stats for this match (if entered yet) so we
  // can show both the final points AND a line-by-line breakdown of how
  // they were calculated - not just the total alone.
  const playerIds = (players || []).map(p => p.player.id);

  const { data: statsRows } = await supabase
    .from('player_match_stats')
    .select('*')
    .eq('match_id', match_id)
    .in('player_id', playerIds);
  const statsByPlayerId = new Map((statsRows || []).map(s => [s.player_id, s]));

  const { data: specialRules } = await supabase
    .from('match_special_rules')
    .select('multipliers')
    .eq('match_id', match_id)
    .maybeSingle();
  const multipliers = specialRules?.multipliers || [];

  const playersWithPoints = (players || []).map(p => {
    const rawStats = statsByPlayerId.get(p.player.id);
    const multiplier = p.special_rank ? Number(multipliers[p.special_rank - 1]) || 1 : 1;

    if (!rawStats) {
      // Stats not entered yet for this player
      return { ...p, base_points: null, points: null, multiplier, breakdown: [] };
    }

    const { lines, total: basePoints } = calculatePointsBreakdown(rawStats, p.player.role);
    return {
      ...p,
      base_points: basePoints,
      points: Math.round(basePoints * multiplier * 10) / 10,
      multiplier,
      breakdown: lines
    };
  });

  // Include the team owner's name when viewing another user's team
  let userName = null;
  if (targetUserId && targetUserId !== req.user.id) {
    const { data: u } = await supabase.from('users').select('full_name').eq('id', userId).single();
    if (u) userName = u.full_name;
  }

  res.json({ team: { ...userTeam, players: playersWithPoints, user_name: userName } });
});

export default router;
