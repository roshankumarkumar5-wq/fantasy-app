import express from 'express';
import { supabase } from '../db/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Log an action (called internally from other routes, or directly from frontend)
router.post('/log', requireAuth, async (req, res) => {
  const { action, details } = req.body;
  if (!action) return res.status(400).json({ error: 'action is required' });

  const { data: user } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', req.user.id)
    .single();

  const { error } = await supabase.from('audit_logs').insert({
    user_id: req.user.id,
    user_name: user?.full_name || 'Unknown',
    action,
    details: details || null
  });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
