-- Admin-configurable: whether the admin may edit a user's team after the
-- match is locked (e.g. to fix a mistaken or invalid squad). Users themselves
-- can still never edit a locked match's team - this toggle only affects
-- admin-side edits from the match detail page. Enabled by default; operators
-- can turn it off via the Settings tab.
alter table app_config
  add column if not exists enable_admin_team_edit_after_lock boolean not null default true;