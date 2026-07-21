import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { PDFParse } from 'pdf-parse';
import { supabase } from '../db/supabase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { calculateBasePoints, calculateTeamTotal } from '../utils/points.js';
import { parseScorecardText, normalizeName } from '../utils/scorecardParser.js';

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
// body: { team_a_id, team_b_id, match_date, venue, match_format }
// squad_size is fixed at 11. selection_deadline is always calculated
// automatically as 1 hour before match_date - not settable by the admin.
// venue and match_format are optional free text, shown on the match card.
router.post('/matches', async (req, res) => {
  const { team_a_id, team_b_id, match_date, venue, match_format } = req.body;

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
      squad_size: 11,
      venue: venue || null,
      match_format: match_format || null
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

// Upload the final match scoresheet as a PDF. This does two things:
// 1. Stores the PDF in Supabase Storage as a permanent reference/record.
// 2. Best-effort parses it (tuned for CricHeroes-style "Summary Scorecard"
//    exports) into a CSV of runs/wickets/catches/stumpings/run-outs per
//    player, keyed by NAME (not ID) - matched against this match's roster
//    where possible. This CSV is always meant to be reviewed and corrected
//    by the admin before uploading it back as the official stats source
//    (via POST /matches/:id/stats/upload-csv) - parsing real-world PDFs
//    is inherently imperfect, so nothing here is auto-finalized.
// Requires a Supabase Storage bucket named "scoresheets" (public) - create
// it once in your Supabase dashboard under Storage > New bucket.
router.post('/matches/:id/scoresheet', upload.single('file'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'A PDF file is required (field name: file)' });
  if (req.file.mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'Only PDF files are accepted for the scoresheet' });
  }

  const filePath = `match-${id}-scoresheet.pdf`;

  const { error: uploadErr } = await supabase.storage
    .from('scoresheets')
    .upload(filePath, req.file.buffer, { contentType: 'application/pdf', upsert: true });

  if (uploadErr) {
    return res.status(500).json({
      error: `Could not upload scoresheet: ${uploadErr.message}. Make sure a public Storage bucket named "scoresheets" exists in your Supabase project.`
    });
  }

  const { data: urlData } = supabase.storage.from('scoresheets').getPublicUrl(filePath);

  const { error: updateErr } = await supabase
    .from('matches')
    .update({ scoresheet_url: urlData.publicUrl })
    .eq('id', id);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // Best-effort parse -> CSV generation
  let csv = null;
  let matchedCount = 0;
  let unmatchedNames = [];

  try {
    const { data: matchRow } = await supabase
      .from('matches')
      .select('team_a_id, team_b_id')
      .eq('id', id)
      .single();

    const { data: rosterPlayers } = await supabase
      .from('players')
      .select('id, name')
      .in('real_team_id', [matchRow.team_a_id, matchRow.team_b_id]);

    const rosterByNormalizedName = new Map(
      (rosterPlayers || []).map(p => [normalizeName(p.name), p])
    );

    const parser = new PDFParse({ data: req.file.buffer });
    const textResult = await parser.getText();
    await parser.destroy();

    const parsedStats = parseScorecardText(textResult.text);

    const rows = ['player_name,player_id,runs,wickets,catches,stumpings,run_outs'];
    for (const s of parsedStats) {
      const match = rosterByNormalizedName.get(normalizeName(s.name));
      const displayName = match ? match.name : s.name;
      const playerId = match ? match.id : '';
      if (match) matchedCount++;
      else unmatchedNames.push(s.name);

      const safeName = displayName.includes(',') ? `"${displayName.replace(/"/g, '""')}"` : displayName;
      rows.push(`${safeName},${playerId},${s.runs},${s.wickets},${s.catches},${s.stumpings},${s.run_outs}`);
    }
    csv = rows.join('\n');
  } catch (parseErr) {
    console.error('Scoresheet parse failed (non-fatal):', parseErr.message);
    // Non-fatal - the PDF is still stored, admin can enter stats manually instead
  }

  res.json({
    url: urlData.publicUrl,
    csv,
    matched_count: matchedCount,
    unmatched_names: unmatchedNames
  });
});

// ---------- STATS ENTRY + POINTS CALCULATION ----------
// Manual entry path: pick each player from a dropdown and type their stats.
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

  await supabase.from('matches').update({ stats_confirmed_at: new Date().toISOString() }).eq('id', id);

  res.json({ success: true, message: 'Stats saved. Call /finalize to compute user team totals.' });
});

// CSV upload path: the "final scoresheet" - either the CSV generated from
// parsing a PDF (see POST /matches/:id/scoresheet) after admin has reviewed
// and corrected it, or a CSV built from scratch. Player is matched by NAME
// (case/punctuation-insensitive), falling back to player_id if the CSV has
// one filled in. This upload is what gates whether the match can be
// finalized (see /finalize below) - not per-player completeness checks.
// CSV columns: player_name, player_id (optional), runs, wickets, catches, stumpings, run_outs
router.post('/matches/:id/stats/upload-csv', upload.single('file'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'A CSV file is required (field name: file)' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + err.message });
  }

  const { data: matchRow, error: matchErr } = await supabase
    .from('matches')
    .select('team_a_id, team_b_id')
    .eq('id', id)
    .single();
  if (matchErr) return res.status(404).json({ error: 'Match not found' });

  const { data: rosterPlayers, error: rosterErr } = await supabase
    .from('players')
    .select('id, name')
    .in('real_team_id', [matchRow.team_a_id, matchRow.team_b_id]);
  if (rosterErr) return res.status(500).json({ error: rosterErr.message });

  const rosterById = new Map((rosterPlayers || []).map(p => [p.id, p]));
  const rosterByNormalizedName = new Map((rosterPlayers || []).map(p => [normalizeName(p.name), p]));

  const { data: rules, error: rulesErr } = await supabase
    .from('scoring_rules')
    .select('*')
    .eq('id', 1)
    .single();
  if (rulesErr) return res.status(500).json({ error: rulesErr.message });

  const rowsToSave = [];
  const skipped = [];

  for (const r of records) {
    let player = r.player_id ? rosterById.get(r.player_id.trim()) : null;
    if (!player && r.player_name) {
      player = rosterByNormalizedName.get(normalizeName(r.player_name));
    }
    if (!player) {
      skipped.push(r.player_name || r.player_id || '(unnamed row)');
      continue;
    }

    const stats = {
      runs: parseInt(r.runs, 10) || 0,
      wickets: parseInt(r.wickets, 10) || 0,
      catches: parseInt(r.catches, 10) || 0,
      stumpings: parseInt(r.stumpings, 10) || 0,
      run_outs: parseInt(r.run_outs, 10) || 0
    };

    rowsToSave.push({
      match_id: id,
      player_id: player.id,
      ...stats,
      base_points: calculateBasePoints(stats, rules)
    });
  }

  if (rowsToSave.length === 0) {
    return res.status(400).json({
      error: 'No rows could be matched to players on this match\'s rosters. Check the player_name column spelling, or fill in player_id.',
      skipped
    });
  }

  const { error: saveErr } = await supabase
    .from('player_match_stats')
    .upsert(rowsToSave, { onConflict: 'match_id,player_id' });
  if (saveErr) return res.status(500).json({ error: saveErr.message });

  await supabase.from('matches').update({ stats_confirmed_at: new Date().toISOString() }).eq('id', id);

  res.json({ success: true, saved: rowsToSave.length, skipped });
});

// Computes every user's team total for this match and marks it completed
router.post('/matches/:id/finalize', async (req, res) => {
  const { id } = req.params;

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('id, stats_confirmed_at')
    .eq('id', id)
    .single();
  if (matchErr) return res.status(404).json({ error: 'Match not found' });

  if (!match.stats_confirmed_at) {
    return res.status(400).json({
      error: 'Save or upload the final stats CSV before finalizing this match (see step 3 on the match detail page).'
    });
  }

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

// Delete a completed match and all its related data (user teams, stats, etc.
// all cascade automatically via foreign keys). Restricted to completed
// matches only, as a safety guard against accidentally wiping an active one.
router.delete('/matches/:id', async (req, res) => {
  const { id } = req.params;

  const { data: match, error: findErr } = await supabase
    .from('matches')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (findErr || !match) return res.status(404).json({ error: 'Match not found' });

  if (match.status !== 'completed') {
    return res.status(400).json({ error: 'Only completed matches can be deleted. Lock or finalize this match first if you intend to remove it.' });
  }

  const { error } = await supabase.from('matches').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

// ---------- USER APPROVALS ----------
// New signups start as 'pending' and can't log in until an admin approves
// them - replaces the old OTP/email-verification concept entirely.
router.get('/users/pending', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, phone, created_at, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Optional: full list of all non-pending users too, useful for management
router.get('/users', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, phone, role, status, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/users/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .update({ status: 'approved' })
    .eq('id', id)
    .select('id, full_name, email, status')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/users/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .update({ status: 'rejected' })
    .eq('id', id)
    .select('id, full_name, email, status')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
