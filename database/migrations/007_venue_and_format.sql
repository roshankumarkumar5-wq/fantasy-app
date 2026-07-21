-- ============================================================
-- Migration: Add optional venue and match format fields, to
-- support the richer match promo card design (team logos, VS,
-- type/date/venue info boxes).
-- ============================================================

alter table matches add column if not exists venue text;
alter table matches add column if not exists match_format text;  -- free text, e.g. "Limited Overs - 35, White Ball"
