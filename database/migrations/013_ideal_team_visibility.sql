-- Admin-configurable: whether USERS may view the "Ideal Team" (the highest-
-- scoring squad that could have been picked) for a completed match. The admin
-- always sees it via the match detail page regardless of this flag.
alter table app_config
  add column if not exists enable_ideal_team_visibility boolean not null default false;