-- ============================================================
-- Migration: Add a simple "final stats confirmed" flag to matches,
-- replacing the old per-player missing-stats validation with a
-- single checkpoint: has the admin saved/uploaded a stats file
-- for this match at all. Set automatically whenever stats are
-- saved (whether via manual entry or CSV upload).
-- ============================================================

alter table matches add column if not exists stats_confirmed_at timestamptz;
