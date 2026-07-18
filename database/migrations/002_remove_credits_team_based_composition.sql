-- ============================================================
-- Migration: Remove credit-based selection entirely.
-- Players available for a match are now automatically derived
-- from which real team they belong to (team_a_id / team_b_id
-- on the match) - no more per-match player pool or credit values.
-- Team composition rule (min 4, max 7 per side, 11 total) is
-- enforced in application code, not the database.
-- ============================================================

-- match_players table is no longer needed - player availability
-- is now computed live from players.real_team_id vs the match's
-- team_a_id / team_b_id, so there's nothing left to store here.
drop table if exists match_players;

-- Credit limit is no longer a concept in this app.
alter table matches drop column if exists max_credits;
