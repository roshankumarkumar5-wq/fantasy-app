-- ============================================================
-- Migration: Email verification/password-reset support,
-- plus a fix to prevent accidental data loss when deleting
-- a player who is already used in a match/team/stats record.
--
-- Run this in Supabase SQL Editor if you already ran the
-- original schema.sql before this update.
-- ============================================================

-- ---- Email verification / password reset fields on users ----
alter table users add column if not exists email_verified boolean not null default false;
alter table users add column if not exists otp_code text;
alter table users add column if not exists otp_expires_at timestamptz;
alter table users add column if not exists otp_purpose text; -- 'verify_email' or 'reset_password'

-- ---- Fix: deleting a player should be BLOCKED if already used,
-- not silently cascade-delete match pools / user teams / stats ----
alter table match_players drop constraint if exists match_players_player_id_fkey;
alter table match_players add constraint match_players_player_id_fkey
  foreign key (player_id) references players(id) on delete restrict;

alter table user_team_players drop constraint if exists user_team_players_player_id_fkey;
alter table user_team_players add constraint user_team_players_player_id_fkey
  foreign key (player_id) references players(id) on delete restrict;

alter table player_match_stats drop constraint if exists player_match_stats_player_id_fkey;
alter table player_match_stats add constraint player_match_stats_player_id_fkey
  foreign key (player_id) references players(id) on delete restrict;
