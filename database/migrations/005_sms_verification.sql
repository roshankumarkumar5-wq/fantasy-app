-- ============================================================
-- Migration: Switch verification from email-delivered codes to
-- SMS-delivered codes. Email stays as the login identifier -
-- only the OTP delivery channel changes.
-- ============================================================

alter table users rename column email_verified to phone_verified;

-- Note: existing rows with a null phone won't be able to receive SMS
-- codes going forward. New signups now require a phone number at the
-- application level (not enforced here as NOT NULL, to avoid breaking
-- any existing rows created before this migration).
