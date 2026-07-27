-- ============================================================
-- Migration: Distinguish direct-hit run-outs from combined
-- (multi-fielder) run-outs. The existing `run_outs` column now
-- represents direct hits only (single fielder named); a new
-- `run_out_assists` column holds involvement in a combined
-- run-out (2+ fielders named), which scores lower per person.
-- ============================================================

alter table player_match_stats add column if not exists run_out_assists int default 0;
