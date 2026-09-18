-- Admin-configurable: whether users may view OTHER users' fantasy teams
-- while a match is locked (before the final scoresheet/results are in).
-- When OFF, other teams stay hidden until the match is completed. When ON,
-- (default) they become visible as soon as the match is locked - i.e. the
-- original behavior.
alter table app_config
  add column if not exists enable_team_views_after_lock boolean not null default true;