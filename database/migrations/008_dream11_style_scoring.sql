-- ============================================================
-- Migration: Expand player_match_stats to support Dream11-style
-- scoring (boundary bonuses, milestones, economy/strike-rate
-- bonuses, bowled/LBW bonus, maiden overs, duck penalty).
-- ============================================================

alter table player_match_stats add column if not exists balls_faced int default 0;
alter table player_match_stats add column if not exists fours int default 0;
alter table player_match_stats add column if not exists sixes int default 0;
alter table player_match_stats add column if not exists is_out boolean default false;  -- true = dismissed, false = not out
alter table player_match_stats add column if not exists bowled_lbw_wickets int default 0;  -- subset of wickets that were bowled/LBW
alter table player_match_stats add column if not exists maidens int default 0;
alter table player_match_stats add column if not exists overs_bowled numeric(4,1) default 0;  -- cricket notation, e.g. 3.4 = 3 overs 4 balls
alter table player_match_stats add column if not exists runs_conceded int default 0;
