import express from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/settings - public-facing app configuration flags.
// The frontend uses these to decide which UI elements to show (e.g. the
// users' "Players" leaderboard tab, whether other teams may be viewed once a
// match is locked, or whether the ideal-team feature is exposed to users).
// Falls back to defaults if the table doesn't exist yet (migration not run)
// so nothing breaks.
router.get('/', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('app_config')
    .select('enable_player_leaderboard, enable_team_views_after_lock, enable_ideal_team_visibility')
    .maybeSingle();

  res.json({
    enable_player_leaderboard: data?.enable_player_leaderboard ?? true,
    enable_team_views_after_lock: data?.enable_team_views_after_lock ?? true,
    enable_ideal_team_visibility: data?.enable_ideal_team_visibility ?? false
  });
});

export default router;