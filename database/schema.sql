-- ============================================================
-- Fantasy Sports App - Database Schema
-- Run this in Supabase SQL Editor (Project > SQL Editor > New Query)
-- ============================================================

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- USERS (both regular users and admins, differentiated by role)
-- ------------------------------------------------------------
create table users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  password_hash text not null,
  full_name text not null,
  phone text,
  role text not null default 'user' check (role in ('user', 'admin')),
  phone_verified boolean not null default false,
  otp_code text,
  otp_expires_at timestamptz,
  otp_purpose text,   -- 'verify_phone' or 'reset_password'
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- REAL-WORLD TEAMS (e.g. India, Australia, Mumbai Indians)
-- ------------------------------------------------------------
create table real_teams (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  short_code text not null,
  logo_url text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- PLAYERS (master list, reusable across matches)
-- Bulk-uploaded by admin via Excel/CSV
-- ------------------------------------------------------------
create table players (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  real_team_id uuid references real_teams(id) on delete cascade,
  role text not null check (role in ('batsman', 'bowler', 'all-rounder', 'keeper')),
  photo_url text,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- MATCHES (scheduled by admin)
-- ------------------------------------------------------------
create table matches (
  id uuid primary key default uuid_generate_v4(),
  team_a_id uuid references real_teams(id),
  team_b_id uuid references real_teams(id),
  match_date timestamptz not null,
  selection_deadline timestamptz not null,  -- auto-calculated as 1hr before match_date
  squad_size int not null default 11,
  status text not null default 'upcoming' check (status in ('upcoming', 'locked', 'completed')),
  scoresheet_url text,   -- final PDF scoresheet uploaded by admin, for reference
  stats_confirmed_at timestamptz,  -- set when admin saves/uploads final stats; gates finalize
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- SPECIAL PLAYER RULES (per match, admin-configurable)
-- e.g. multipliers = [2.0, 1.5] means 1st special player picked
-- gets 2x points, 2nd gets 1.5x. multipliers = [2.0] means only
-- one special player slot exists (pure "Captain" system).
-- enabled = false means no special player system for this match.
-- ------------------------------------------------------------
create table match_special_rules (
  match_id uuid primary key references matches(id) on delete cascade,
  enabled boolean not null default true,
  multipliers numeric(3,1)[] not null default array[2.0, 1.5]
);

-- ------------------------------------------------------------
-- USER FANTASY TEAMS
-- ------------------------------------------------------------
create table user_teams (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  match_id uuid references matches(id) on delete cascade,
  submitted_at timestamptz,
  is_locked boolean not null default false,
  total_points numeric(6,1) default 0,
  created_at timestamptz default now(),
  unique(user_id, match_id)   -- one team per user per match
);

-- ------------------------------------------------------------
-- PLAYERS PICKED WITHIN A USER'S TEAM
-- special_rank: NULL = not special, 1 = 1st special slot (e.g.
-- Captain, gets multipliers[0]), 2 = 2nd special slot (e.g. VC,
-- gets multipliers[1]), etc.
-- ------------------------------------------------------------
create table user_team_players (
  id uuid primary key default uuid_generate_v4(),
  user_team_id uuid references user_teams(id) on delete cascade,
  player_id uuid references players(id) on delete restrict,
  special_rank int,
  unique(user_team_id, player_id)
);

-- ------------------------------------------------------------
-- MATCH STATS (entered/parsed by admin after match completion)
-- ------------------------------------------------------------
create table player_match_stats (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references matches(id) on delete cascade,
  player_id uuid references players(id) on delete restrict,
  runs int default 0,
  wickets int default 0,
  catches int default 0,
  stumpings int default 0,
  run_outs int default 0,
  base_points numeric(6,1) default 0,   -- calculated from scoring_rules
  unique(match_id, player_id)
);

-- ------------------------------------------------------------
-- GLOBAL SCORING RULES (points per action - editable by admin)
-- ------------------------------------------------------------
create table scoring_rules (
  id int primary key default 1,
  points_per_run numeric(4,2) not null default 1,
  points_per_wicket numeric(4,2) not null default 25,
  points_per_catch numeric(4,2) not null default 8,
  points_per_stumping numeric(4,2) not null default 12,
  points_per_run_out numeric(4,2) not null default 6,
  check (id = 1)   -- enforce single row
);

insert into scoring_rules (id) values (1);

-- ------------------------------------------------------------
-- Indexes for common lookups
-- ------------------------------------------------------------
create index idx_players_team on players(real_team_id);
create index idx_user_teams_match on user_teams(match_id);
create index idx_user_team_players_team on user_team_players(user_team_id);
create index idx_player_match_stats_match on player_match_stats(match_id);
