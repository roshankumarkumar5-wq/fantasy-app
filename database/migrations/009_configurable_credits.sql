-- ============================================================
-- Migration: Re-introduce credits, but this time:
-- 1. credit_value lives on the PLAYER (reusable across matches),
--    not a per-match pool table.
-- 2. Whether a credit limit applies, and what it is, is
--    configurable per match - mirrors match_special_rules.
-- ============================================================

alter table players add column if not exists credit_value numeric(4,1) default 8.0;

create table if not exists match_credit_rules (
  match_id uuid primary key references matches(id) on delete cascade,
  enabled boolean not null default true,
  max_credits numeric(5,1) not null default 100
);
