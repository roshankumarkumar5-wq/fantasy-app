-- ============================================================
-- Migration: Remove the OTP/verification concept entirely
-- (both SMS and email versions). Replaced with a simple admin
-- approval workflow: new signups start as 'pending', and can't
-- log in until an admin approves them.
-- ============================================================

alter table users add column if not exists status text not null default 'pending'
  check (status in ('pending', 'approved', 'rejected'));

-- Carry forward anyone who was already phone_verified as approved,
-- so existing working accounts aren't locked out by this migration.
update users set status = 'approved' where phone_verified = true;

alter table users drop column if exists phone_verified;
alter table users drop column if exists otp_code;
alter table users drop column if exists otp_expires_at;
alter table users drop column if exists otp_purpose;
