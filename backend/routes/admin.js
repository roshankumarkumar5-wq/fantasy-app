import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { supabase } from '../db/supabase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { calculateBasePoints, calculateTeamTotal } from '../utils/points.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// All admin routes require a logged-in admin
router.use(requireAuth, requireAdmin);

// ---------- REAL TEAMS ----------
router.get('/teams', async (req, res) => {
  const { data, error } = await supabase
    .from('real_teams')
    .select('id, name, short_code, logo_url')
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/teams', async (req, res) => {
  const { name, short_code, logo_url } = req.body;
  const { data, error } = await supabase
    .from('real_teams')
    .insert({ name, short_code, logo_url })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Deleting a team also deletes its players (players.real_team_id has ON DELETE CASCADE).
// If the team is used in any match, the deletion is blocked by a foreign key constraint -
// we catch that and return a clear message instead of a raw DB error.
router.delete('/teams/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('real_teams').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'This team is used in one or more scheduled matches and cannot be deleted. Delete those matches first.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

// ---------- PLAYERS (bulk upload via CSV) ----------
// CSV columns expected: name, real_team_id, role, photo_url(optional)
router.post('/players/upload-csv', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required (field name: file)' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + err.message });
  }

  const rows = records.map(r => ({
    name: r.name,
    real_team_id: r.real_team_id,
    role: r.role,
    photo_url: r.photo_url || null
  }));

  const { data, error } = await supabase.from('players').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ inserted: data.length, players: data });
});

router.post('/players', async (req, res) => {
  const { name, real_team_id, role, photo_url } = req.body;
  const { data, error } = await supabase
    .from('players')
    .insert({ name, real_team_id, role, photo_url })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/players', async (req, res) => {
  const { data, error } = await supabase
    .from('players')
    .select(`id, name, role, photo_url, real_team:real_team_id ( id, name, short_code )`)
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Deleting a player is blocked if they're already part of a match pool or a
// submitted user team - we surface that as a clear message rather than a raw error.
router.delete('/players/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('players').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'This player is already used in a match or a submitted team and cannot be deleted.' });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

// ---------- MATCHES ----------
// body: { team_a_id, team_b_id, match_date }
// squad_size is fixed at 11. selection_deadline is always calculated
// automatically as 1 hour before match_date - not settable by the admin.
router.post('/matches', async (req, res) => {
  const { team_a_id, team_b_id, match_date } = req.body;

  if (!team_a_id || !team_b_id || !match_date) {
    return res.status(400).json({ error: 'team_a_id, team_b_id, and match_date are required' });
  }
  if (team_a_id === team_b_id) {
    return res.status(400).json({ error: 'Team A and Team B must be different teams' });
  }

  const matchDate = new Date(match_date);
  const selectionDeadline = new Date(matchDate.getTime() - 60 * 60 * 1000); // 1 hour before

  const { data, error } = await supabase
    .from('matches')
    .insert({
      team_a_id, team_b_id,
      match_date: matchDate.toISOString(),
      selection_deadline: selectionDeadline.toISOString(),
      squad_size: 11
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// body: { enabled: true/false, multipliers: [2.0, 1.5] }
router.put('/matches/:id/special-rules', async (req, res) => {
  const { id } = req.params;
  const { enabled, multipliers } = req.body;
  const { data, error } = await supabase
    .from('match_special_rules')
    .upsert({ match_id: id, enabled, multipliers }, { onConflict: 'match_id' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Lock a match (no more team submissions) - typically called at/after selection_deadline
router.put('/matches/:id/lock', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('matches')
    .update({ status: 'locked' })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ---------- STATS ENTRY + POINTS CALCULATION ----------
// After the admin reads the scoresheet PDF, they submit stats here.
// body: { stats: [{ player_id, runs, wickets, catches, stumpings, run_outs }] }
router.post('/matches/:id/stats', async (req, res) => {
  const { id } = req.params;
  const { stats } = req.body;
  if (!Array.isArray(stats)) return res.status(400).json({ error: 'stats array is required' });

  const { data: rules, error: rulesErr } = await supabase
    .from('scoring_rules')
    .select('*')
    .eq('id', 1)
    .single();
  if (rulesErr) return res.status(500).json({ error: rulesErr.message });

  const rows = stats.map(s => ({
    match_id: id,
    player_id: s.player_id,
    runs: s.runs || 0,
    wickets: s.wickets || 0,
    catches: s.catches || 0,
    stumpings: s.stumpings || 0,
    run_outs: s.run_outs || 0,
    base_points: calculateBasePoints(s, rules)
  }));

  const { error: statsErr } = await supabase
    .from('player_match_stats')
    .upsert(rows, { onConflict: 'match_id,player_id' });
  if (statsErr) return res.status(500).json({ error: statsErr.message });

  res.json({ success: true, message: 'Stats saved. Call /finalize to compute user team totals.' });
});

// Computes every user's team total for this match and marks it completed
router.post('/matches/:id/finalize', async (req, res) => {
  const { id } = req.params;

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('id')
    .eq('id', id)
    .single();
  if (matchErr) return res.status(404).json({ error: 'Match not found' });

  const { data: specialRules } = await supabase
    .from('match_special_rules')
    .select('multipliers')
    .eq('match_id', id)
    .maybeSingle();
  const multipliers = specialRules?.multipliers || [];

  const { data: statsRows, error: statsErr } = await supabase
    .from('player_match_stats')
    .select('player_id, base_points')
    .eq('match_id', id);
  if (statsErr) return res.status(500).json({ error: statsErr.message });

  const pointsMap = new Map(statsRows.map(s => [s.player_id, s.base_points]));

  const { data: userTeams, error: utErr } = await supabase
    .from('user_teams')
    .select('id')
    .eq('match_id', id);
  if (utErr) return res.status(500).json({ error: utErr.message });

  for (const ut of userTeams) {
    const { data: teamPlayers } = await supabase
      .from('user_team_players')
      .select('player_id, special_rank')
      .eq('user_team_id', ut.id);

    const enriched = teamPlayers.map(tp => ({
      ...tp,
      base_points: pointsMap.get(tp.player_id) || 0
    }));

    const total = calculateTeamTotal(enriched, multipliers);

    await supabase
      .from('user_teams')
      .update({ total_points: total, is_locked: true })
      .eq('id', ut.id);
  }

  await supabase.from('matches').update({ status: 'completed' }).eq('id', id);

  res.json({ success: true, teams_updated: userTeams.length });
});

// GET leaderboard for a match
router.get('/matches/:id/leaderboard', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('user_teams')
    .select('total_points, user:user_id ( id, full_name )')
    .eq('match_id', id)
    .order('total_points', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
