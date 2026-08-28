-- 011 - Player points leaderboard (users tab) with admin config toggle.
-- App-wide settings live here as a single row (id = 1). The admin can turn
-- the users' "Players" leaderboard tab on/off from the admin Settings tab;
-- the frontend reads this same flag to decide whether to render the tab, and
-- the backend also refuses to serve the aggregated player leaderboard while
-- it's disabled (defense in depth).
create table if not exists app_config (
  id int primary key default 1,
  enable_player_leaderboard boolean not null default true,
  check (id = 1)   -- enforce single row
);

insert into app_config (id, enable_player_leaderboard)
values (1, true)
on conflict (id) do nothing;