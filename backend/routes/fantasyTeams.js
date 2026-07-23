import express from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const MIN_PER_TEAM = 4;
const MAX_PER_TEAM = 7;

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
    .select('id, squad_size, selection_deadline, status, team_a_id, team_b_id')
    .eq('id', match_id)
    .single();

  if (matchErr) return res.status(404).json({ error: 'Match not found' });

  if (new Date() > new Date(match.selection_deadline) || match.status !== 'upcoming') {
    return res.status(403).json({ error: 'Selection deadline has passed for this match' });
  }

  // 2. Squad size check
  if (player_ids.length !== match.squad_size) {
    return res.status(400).json({
      error: `You must select exactly ${match.squad_size} players (selected ${player_ids.length})`
    });
  }

  // 3. Load special rules and validate special picks
  const { data: specialRules } = await supabase
    .from('match_special_rules')
    .select('enabled, multipliers')
    .eq('match_id', match_id)
    .maybeSingle();

  if (specialRules?.enabled) {
    const maxSpecial = specialRules.multipliers.length;
    if (special_picks.length === 0) {
      return res.status(400).json({ error: 'You must select at least one special player' });
    }
    if (special_picks.length > maxSpecial) {
      return res.status(400).json({ error: `Only ${maxSpecial} special player(s) allowed for this match` });
    }
    const ranksUsed = new Set(special_picks.map(p => p.special_rank));
    if (ranksUsed.size !== special_picks.length) {
      return res.status(400).json({ error: 'Duplicate special ranks are not allowed' });
    }
    for (const pick of special_picks) {
      if (!player_ids.includes(pick.player_id)) {
        return res.status(400).json({ error: 'Special player must be one of the selected squad players' });
      }
    }
  } else if (special_picks.length > 0) {
    return res.status(400).json({ error: 'Special player selection is disabled for this match' });
  }

  // 4. Team composition check - every player must belong to one of the two
  // real teams in this match, with between MIN_PER_TEAM and MAX_PER_TEAM
  // players picked from each side.
  const { data: pickedPlayers, error: playersErr } = await supabase
    .from('players')
    .select('id, real_team_id, credit_value')
    .in('id', player_ids);

  if (playersErr) return res.status(500).json({ error: playersErr.message });

  if (pickedPlayers.length !== player_ids.length) {
    return res.status(400).json({ error: 'One or more selected players could not be found' });
  }

  let countA = 0, countB = 0;
  for (const p of pickedPlayers) {
    if (p.real_team_id === match.team_a_id) countA++;
    else if (p.real_team_id === match.team_b_id) countB++;
    else {
      return res.status(400).json({ error: 'All players must belong to one of the two teams playing this match' });
    }
  }

  if (countA < MIN_PER_TEAM || countA > MAX_PER_TEAM) {
    return res.status(400).json({
      error: `You selected ${countA} player(s) from Team A - must be between ${MIN_PER_TEAM} and ${MAX_PER_TEAM}`
    });
  }
  if (countB < MIN_PER_TEAM || countB > MAX_PER_TEAM) {
    return res.status(400).json({
      error: `You selected ${countB} player(s) from Team B - must be between ${MIN_PER_TEAM} and ${MAX_PER_TEAM}`
    });
  }

  // 4b. Credit budget check - only enforced if this match has it enabled.
  const { data: creditRules } = await supabase
    .from('match_credit_rules')
    .select('enabled, max_credits')
    .eq('match_id', match_id)
    .maybeSingle();

  if (creditRules?.enabled) {
    const totalCredits = pickedPlayers.reduce((sum, p) => sum + Number(p.credit_value), 0);
    if (totalCredits > Number(creditRules.max_credits)) {
      return res.status(400).json({
        error: `Your team uses ${totalCredits.toFixed(1)} credits, which exceeds the ${Number(creditRules.max_credits).toFixed(1)} credit limit for this match`
      });
    }
  }

  // 5. Upsert user_teams row
  const { data: userTeam, error: utErr } = await supabase
    .from('user_teams')
    .upsert(
      { user_id: userId, match_id, submitted_at: new Date().toISOString(), is_locked: false },
      { onConflict: 'user_id,match_id' }
    )
    .select('id')
    .single();

  if (utErr) return res.status(500).json({ error: utErr.message });

  // 6. Replace user_team_players
  await supabase.from('user_team_players').delete().eq('user_team_id', userTeam.id);

  const specialMap = new Map(special_picks.map(p => [p.player_id, p.special_rank]));
  const rows = player_ids.map(pid => ({
    user_team_id: userTeam.id,
    player_id: pid,
    special_rank: specialMap.get(pid) || null
  }));

  const { error: insertErr } = await supabase.from('user_team_players').insert(rows);
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  res.json({ success: true, user_team_id: userTeam.id });
});

// GET /api/fantasy-teams/:match_id - get the logged-in user's team for a match
router.get('/:match_id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { match_id } = req.params;

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

  res.json({ team: { ...userTeam, players } });
});

export default router;
