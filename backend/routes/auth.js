import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../db/supabase.js';

const router = express.Router();

function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// POST /api/auth/signup - creates account as 'pending'. No OTP, no email/SMS
// verification - an admin reviews and approves/rejects from the admin panel.
router.post('/signup', async (req, res) => {
  const { email, password, full_name, phone } = req.body;
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'email, password, and full_name are required' });
  }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert({ email, password_hash, full_name, phone, role: 'user', status: 'pending' })
    .select('id, email, full_name, role, status')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    message: 'Account created. An admin needs to approve your account before you can log in.',
    email: data.email
  });
});

// POST /api/auth/login - works for both users and admins; requires an approved account
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, password_hash, full_name, role, status')
    .eq('email', email)
    .maybeSingle();

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (user.status === 'pending') {
    return res.status(403).json({
      error: 'Your account is awaiting admin approval. Please check back later.',
      accountStatus: 'pending'
    });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({
      error: 'Your account request was not approved.',
      accountStatus: 'rejected'
    });
  }

  const token = issueToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }
  });
});

export default router;
