import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../db/supabase.js';
import { sendSms, generateOtp, otpSmsText } from '../utils/sms.js';

const router = express.Router();
const OTP_TTL_MINUTES = 15;

function otpExpiryTimestamp() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
}

function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// POST /api/auth/signup - creates account, sends a verification code via SMS,
// does NOT log in yet. Email remains the login identifier; phone is now
// required since it's the only place the verification code is delivered.
router.post('/signup', async (req, res) => {
  const { email, password, full_name, phone } = req.body;
  if (!email || !password || !full_name || !phone) {
    return res.status(400).json({ error: 'email, password, full_name, and phone are required' });
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
  const otp_code = generateOtp();

  const { data, error } = await supabase
    .from('users')
    .insert({
      email, password_hash, full_name, phone, role: 'user',
      phone_verified: false,
      otp_code, otp_expires_at: otpExpiryTimestamp(), otp_purpose: 'verify_phone'
    })
    .select('id, email, full_name, role, phone')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  try {
    await sendSms(phone, otpSmsText(otp_code, 'verify_phone'));
  } catch (smsErr) {
    console.error('Failed to send verification SMS:', smsErr.message);
    // Don't fail signup just because SMS sending failed - user can use "resend code"
  }

  res.json({ message: 'Account created. Check your phone for a verification code.', email: data.email, phone: data.phone });
});

// POST /api/auth/verify-email - confirms the OTP (sent via SMS) and logs the user in.
// Kept this route path for compatibility with existing frontend links, but it
// now verifies the phone-delivered code, not an email-delivered one.
router.post('/verify-email', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'email and code are required' });

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, otp_code, otp_expires_at, otp_purpose')
    .eq('email', email)
    .maybeSingle();

  if (error || !user) return res.status(404).json({ error: 'Account not found' });

  if (user.otp_purpose !== 'verify_phone' || user.otp_code !== code) {
    return res.status(400).json({ error: 'Invalid verification code' });
  }
  if (new Date() > new Date(user.otp_expires_at)) {
    return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
  }

  const { error: updateErr } = await supabase
    .from('users')
    .update({ phone_verified: true, otp_code: null, otp_expires_at: null, otp_purpose: null })
    .eq('id', user.id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  const token = issueToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }
  });
});

// POST /api/auth/resend-code - resend either a verify_phone or reset_password code via SMS
router.post('/resend-code', async (req, res) => {
  const { email, purpose = 'verify_phone' } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!['verify_phone', 'reset_password'].includes(purpose)) {
    return res.status(400).json({ error: 'Invalid purpose' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, phone')
    .eq('email', email)
    .maybeSingle();

  // Respond generically either way, to avoid confirming which emails have accounts
  if (error || !user) {
    return res.json({ message: 'If an account exists for this email, a code has been sent.' });
  }

  const otp_code = generateOtp();
  await supabase
    .from('users')
    .update({ otp_code, otp_expires_at: otpExpiryTimestamp(), otp_purpose: purpose })
    .eq('id', user.id);

  try {
    await sendSms(user.phone, otpSmsText(otp_code, purpose));
  } catch (smsErr) {
    console.error('Failed to send code SMS:', smsErr.message);
  }

  res.json({ message: 'If an account exists for this email, a code has been sent.' });
});

// POST /api/auth/forgot-password - kicks off the reset-password OTP flow via SMS
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const { data: user } = await supabase
    .from('users')
    .select('id, phone')
    .eq('email', email)
    .maybeSingle();

  if (user) {
    const otp_code = generateOtp();
    await supabase
      .from('users')
      .update({ otp_code, otp_expires_at: otpExpiryTimestamp(), otp_purpose: 'reset_password' })
      .eq('id', user.id);

    try {
      await sendSms(user.phone, otpSmsText(otp_code, 'reset_password'));
    } catch (smsErr) {
      console.error('Failed to send reset SMS:', smsErr.message);
    }
  }

  // Same generic response whether or not the account exists
  res.json({ message: 'If an account exists for this email, a reset code has been sent to the phone on file.' });
});

// POST /api/auth/reset-password - verifies the OTP and sets a new password
router.post('/reset-password', async (req, res) => {
  const { email, code, new_password } = req.body;
  if (!email || !code || !new_password) {
    return res.status(400).json({ error: 'email, code, and new_password are required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, otp_code, otp_expires_at, otp_purpose')
    .eq('email', email)
    .maybeSingle();

  if (error || !user) return res.status(404).json({ error: 'Account not found' });

  if (user.otp_purpose !== 'reset_password' || user.otp_code !== code) {
    return res.status(400).json({ error: 'Invalid reset code' });
  }
  if (new Date() > new Date(user.otp_expires_at)) {
    return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
  }

  const password_hash = await bcrypt.hash(new_password, 10);
  const { error: updateErr } = await supabase
    .from('users')
    .update({ password_hash, otp_code: null, otp_expires_at: null, otp_purpose: null })
    .eq('id', user.id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  res.json({ message: 'Password reset successfully. You can now log in.' });
});

// POST /api/auth/login - works for both users and admins; requires a verified phone
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, password_hash, full_name, role, phone_verified')
    .eq('email', email)
    .maybeSingle();

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user.phone_verified) {
    return res.status(403).json({
      error: 'Please verify your phone number before logging in.',
      needsVerification: true,
      email: user.email
    });
  }

  const token = issueToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }
  });
});

export default router;
