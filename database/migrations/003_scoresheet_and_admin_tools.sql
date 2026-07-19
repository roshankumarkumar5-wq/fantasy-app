-- ============================================================
-- Migration: Add scoresheet PDF reference to matches.
-- (The finalize-check, delete-match, and player-dropdown
-- features in this update don't need schema changes - only
-- this one column does.)
-- ============================================================

alter table matches add column if not exists scoresheet_url text;
