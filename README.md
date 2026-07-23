# Fantasy League App

A simplified fantasy-sports app (Dream11-style team picking) with no payments and no live match tracking. Admin schedules matches and loads players; users pick their fantasy XI before a deadline; admin enters final stats from the scoresheet after the match, and points are calculated automatically.

## How it works

1. **Admin** adds real teams and their players (bulk CSV or one at a time).
2. **Admin** schedules a match between two teams, picking a date/time in IST — the selection deadline (1 hour before) and player availability (everyone on both team rosters) are both automatic.
3. **User** signs up — no OTP or email/SMS verification — and their account sits as **pending** until an **admin approves it** from the Approvals tab. Once approved, they can log in, browse matches, and pick an 11-player squad (4-7 from each side), then optionally assign special player(s) (e.g. Captain/Vice-Captain) if enabled for that match.
4. **Admin** locks the match after the deadline (this also happens automatically once the deadline passes).
5. After the real match ends, **admin** uploads the official scoresheet as a PDF — it's stored for reference and best-effort parsed into an editable CSV — then uploads the reviewed CSV (or enters stats manually) as the final stats source.
6. **Admin** clicks "Finalize" — blocked until final stats have been saved/uploaded — which calculates every user's total points and marks the match completed.
7. **Users** see their team's points and the leaderboard; **admin** can download the leaderboard as CSV and delete old completed matches.

---

## 1. Database setup (Supabase — free tier)

1. Go to https://supabase.com, create a free account and a new project.
2. Open **SQL Editor > New Query**, paste the contents of `database/schema.sql`, and run it.
3. **If you already ran an earlier version of schema.sql**, also run, in order:
   - `database/migrations/001_email_verification_and_fk_fix.sql`
   - `database/migrations/002_remove_credits_team_based_composition.sql`
   - `database/migrations/003_scoresheet_and_admin_tools.sql`
   - `database/migrations/004_stats_confirmed_flag.sql`
   - `database/migrations/005_sms_verification.sql` *(superseded by 006 below — still needed as a stepping stone if you're on an older schema, since 006 depends on the `phone_verified` column this one created)*
   - `database/migrations/006_admin_approval_instead_of_otp.sql`
   - `database/migrations/007_venue_and_format.sql`
4. Go to **Project Settings > API Keys** and copy:
   - **Project URL** (Data API page) — use just the base, e.g. `https://xxxx.supabase.co`, not the `/rest/v1/` suffix
   - The **secret** key (labeled `sb_secret_...` under "Secret keys" — this is what used to be called `service_role`)
5. **Create a Storage bucket for scoresheets**: go to **Storage** in the left sidebar → **New bucket** → name it exactly `scoresheets` → toggle it **Public** → **Create bucket**. This is needed for the admin's PDF scoresheet upload feature.

## 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-secret-key
JWT_SECRET=some-long-random-string
PORT=4000
```

Run locally:
```bash
npm run dev
```

Test it's alive: open `http://localhost:4000` — you should see `{"status":"Fantasy App API running"}`.

### Creating your first admin account

Sign up as a normal user first (via the app's signup page). In Supabase's **Table Editor**, open the `users` table and change that user's `status` from `pending` to `approved`, and its `role` from `user` to `admin`. That's your admin login going forward — the same login page works for both, routing based on role. (Every other new signup after this one, you can approve from the app itself, via the Approvals tab in the admin panel.)

## 3. Frontend setup

The frontend is plain HTML/CSS/JS — no build step needed.

1. Open `frontend/js/api.js` and set `API_BASE_URL` to wherever your backend is hosted (see hosting section below), for example:
   ```html
   <script>window.API_BASE_URL = 'https://your-backend.onrender.com/api';</script>
   ```
   Add that line just before `<script src="js/api.js">` in each HTML page once you deploy (locally it defaults to `http://localhost:4000/api`).

2. To run locally, just open `frontend/login.html` in a browser, or serve the folder with any static server, e.g.:
   ```bash
   cd frontend
   npx serve .
   ```

## 4. Hosting (free tier)

**Backend** — Render or Railway (free tier):
- Push the `backend/` folder to a GitHub repo.
- On Render: New > Web Service > connect repo > root directory `backend` > build command `npm install` > start command `npm start`.
- Add the same environment variables from your `.env` file in Render's dashboard.
- Free tier services sleep after inactivity — the first request after idle will be slow (~30s) as it wakes up.

**Frontend** — Vercel or Netlify (free tier):
- Push the `frontend/` folder to a GitHub repo (or a subfolder of the same repo).
- On Netlify/Vercel: New Site > connect repo > root directory `frontend` > no build command needed (static site).
- Once deployed, update `API_BASE_URL` to point at your Render backend URL, and redeploy.

## 5. CSV format

**Bulk player upload** (`admin/teams-players.html` → Bulk Upload Players):
```csv
name,real_team_id,role,photo_url
Virat Kohli,<real_team_id>,batsman,
Jasprit Bumrah,<real_team_id>,bowler,
```
`role` must be one of: `batsman`, `bowler`, `all-rounder`, `keeper`.

That's the only CSV needed now — once a match is scheduled between two teams, every player belonging to either team is automatically available for users to pick from. There's no separate per-match player list to manage.

## 6. Converting to a native app later (Android APK / iOS)

Since this is a plain, mobile-friendly web app with a manifest and service worker (PWA), you can wrap it into native apps without rewriting anything:

- **Android APK**: use [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (Google's official tool) or [PWABuilder](https://www.pwabuilder.com/) — point it at your live hosted URL and it generates a Play Store-ready APK/AAB.
- **iOS**: use [Capacitor](https://capacitorjs.com/) to wrap the same web app into an Xcode project you can submit to the App Store.

You'll want to add real icon files at `frontend/icons/icon-192.png` and `frontend/icons/icon-512.png` before doing this (currently the manifest references placeholder paths).

## 7. Project structure

```
fantasy-app/
├── database/
│   └── schema.sql          # Run this in Supabase SQL Editor
├── backend/
│   ├── server.js
│   ├── db/supabase.js
│   ├── middleware/auth.js  # JWT verification + admin check
│   ├── utils/
│   │   ├── points.js           # Points calculation logic
│   │   └── scorecardParser.js  # Best-effort CricHeroes-style PDF scorecard parser
│   └── routes/
│       ├── auth.js         # signup (pending) / login (blocked until approved)
│       ├── matches.js      # browse matches, view players, public leaderboard, auto-lock on read
│       ├── fantasyTeams.js # submit/view a user's team (validates deadline/team composition/squad size)
│       └── admin.js        # match/player CRUD, CSV upload, stats entry, finalize, user approvals
└── frontend/
    ├── login.html / signup.html / pending-approval.html
    ├── matches.html        # match list
    ├── team-select.html    # core: pick squad + special players
    ├── results.html        # user's team + leaderboard
    ├── admin/
    │   ├── dashboard.html
    │   ├── create-match.html
    │   ├── teams-players.html
    │   ├── match-detail.html   # lock, upload/generate/enter stats, finalize, leaderboard
    │   └── approvals.html      # approve/reject pending sign-ups
    ├── js/api.js            # shared API client + auth/session helpers
    ├── css/style.css
    ├── manifest.json / sw.js   # PWA basics for later native wrapping
```

## 8. Known simplifications (by design, per your requirements)

- No payments/wallet — entirely free-to-play.
- No live match tracking — stats are entered manually by admin post-match (not parsed from PDF automatically; you can add PDF parsing later using a library like `pdf-parse`, but manual entry avoids brittle layout-parsing bugs for now).
- Auth is custom (bcrypt + JWT) rather than Supabase Auth, kept simple and framework-agnostic.
- Email verification codes and password reset codes are stored in plain text on the `users` row with a 15-minute expiry — fine for this app's scale, but note it's less hardened than a dedicated auth provider.

## 9. What changed in this update

- **Bug fix**: match cards used inline `onclick` HTML attributes, which fail silently if anything is off (e.g. a stale cached page). Replaced with proper `addEventListener` calls plus console logging, across `matches.html` and `admin/dashboard.html`. Also added a clear "no players added yet" message on the team-selection page instead of a blank-looking screen — this was likely the actual cause of feeling "stuck", since a match with no players in its pool yet renders an empty list.
- **Email verification & password reset**: signup now sends a 6-digit code via email (Resend) before allowing login; forgot-password flow reuses the same OTP mechanism. New pages: `verify-email.html`, `forgot-password.html`, `reset-password.html`. New backend endpoints: `/api/auth/verify-email`, `/api/auth/resend-code`, `/api/auth/forgot-password`, `/api/auth/reset-password`.
- **Team dropdowns**: `admin/create-match.html` now shows Team A / Team B as dropdowns populated from your saved teams, instead of requiring you to paste UUIDs.
- **Delete buttons**: `admin/teams-players.html` now lists existing teams and players with delete buttons. Deleting a team also deletes its players (cascading, since they only exist under that team). Deleting a player or team that's already used in a scheduled match is **blocked** with a clear error message, rather than silently breaking that match's data — this required a schema fix, see the migration file.

## 10. What changed in this update (credits removed, team-based composition, IST)

- **No more credit-based selection.** Squad is a fixed 11 players. Composition rule: **4 to 7 players from each of the two teams playing** (since these add up to 11, satisfying one side's range automatically satisfies the other). Enforced both client-side (disables the "+" button once a team hits 7) and server-side (rejected at submission if violated).
- **No more manual player pool per match.** When admin schedules a match between Team A and Team B, every player already assigned to either team (via the `real_team_id` on the `players` table) is automatically available for users to pick — the "Add Players to This Match" step is gone entirely. Admin's job is now just: add teams, add players to those teams, schedule the match.
- **Selection deadline is automatic**: always exactly 1 hour before `match_date`. The admin form no longer asks for it separately.
- **All timings are IST (Asia/Kolkata)**, everywhere, regardless of the viewer's or admin's own device timezone:
  - When the admin enters a match date/time, it's interpreted as IST wall-clock time and converted to the correct absolute timestamp before saving (`istInputToUtcIso()` in `js/api.js`).
  - Every displayed date (`matches.html`, admin dashboard, match detail, create-match confirmation) is formatted explicitly in the `Asia/Kolkata` timezone (`formatIST()` in `js/api.js`), so it reads correctly no matter where the device is set.
- **Database changes**: `matches.max_credits` column dropped; `match_players` table dropped entirely. If you already have a live Supabase project, run `database/migrations/002_remove_credits_team_based_composition.sql`.

## 11. What changed in this update (scoresheet PDF, finalize guard, admin cleanup tools)

- **Scoresheet PDF upload**: on the match detail page, admin can upload the official scoresheet as a PDF for record-keeping (stored in Supabase Storage, linked from the match). *(Superseded by section 13 below — it's now also parsed into an editable CSV.)*
- ~~Finalize is now blocked if any player picked by at least one user is missing stats~~ *(Superseded by section 13 below — replaced with a simpler "final CSV confirmed" check.)*
- **Sample image URLs**: the team logo and player photo fields now show real, working placeholder image links (`placehold.co` for logos, `i.pravatar.cc` for player photos) so you can test the app with visuals before you have real image hosting sorted out.
- **Delete completed matches**: match detail page now has a "Danger Zone" with a delete button, shown only once a match is `completed` — removes the match and all its related teams/stats/leaderboard data (cascades automatically).
- **Download leaderboard as CSV**: available on the match detail page once a match is completed.
- **Database changes**: `matches.scoresheet_url` column added. If you already have a live Supabase project, run `database/migrations/003_scoresheet_and_admin_tools.sql`, and create the `scoresheets` Storage bucket manually as described in section 1.

## 12. What changed in this update (PDF-to-CSV parsing, name-keyed stats, simpler finalize check)

- **Scoresheet PDF is now actually parsed.** Uploading a PDF in step 2 of the match detail page (tuned for **CricHeroes-style "Summary Scorecard" exports**, tested against a real sample match) extracts runs, wickets, catches, stumpings, and run-outs per player and returns a **downloadable CSV**, keyed by player **name** (not ID) — matched against this match's roster where possible. Unmatched names are flagged in the response so you know what to check.
  - This is genuinely a best-effort parser for one specific real-world PDF format. If your scoresheet comes from a different app/export, it may not parse cleanly — the CSV will just be empty/wrong, not crash anything, and you can always fall back to manual entry.
  - **Always review the generated CSV before uploading it back.** Real scorecards are messy (e.g. a player might be "Kumar 17" in your roster but "Kumar (wk)" in the scorecard) — the parser does its best but won't always get every name right.
- **New: Upload Final Stats CSV** (step 3 on match detail) — upload a CSV (the one generated in step 2, edited, or one you build yourself) with columns `player_name, player_id, runs, wickets, catches, stumpings, run_outs`. Matching is by name first (case/punctuation-insensitive), falling back to `player_id` if provided. This is what the app now considers the "official" final stats source.
- **Finalize check simplified**: instead of validating every individual picked player has stats, finalize now just checks that a final stats CSV (or manual save) has been submitted at least once for this match (`matches.stats_confirmed_at` is set). Simpler and matches how you'd actually work with a real scoresheet — you upload the whole thing at once, not player-by-player.
- **Manual dropdown entry still available** as a fallback/alternative, unchanged from before, and also sets the same confirmation flag.
- **Database changes**: `matches.stats_confirmed_at` column added. If you already have a live Supabase project, run `database/migrations/004_stats_confirmed_flag.sql`.
- **New dependency**: `pdf-parse` (pinned to `2.4.5`) added to `backend/package.json` — run `npm install` in your `backend` folder to pick it up before your next local run or deploy.

## 13. What changed in this update (SMS verification instead of email)

- **Verification codes now go by SMS, not email.** Signup, resend, and password-reset codes are texted to the user's phone number instead of emailed — this sidesteps the domain-verification requirement Resend needed for sending to arbitrary recipients.
- **Phone number is now required at signup** (previously optional) — it's the only place codes are delivered, so there's nothing to verify without it.
- **No SMS provider is wired in yet.** `backend/utils/sms.js` is a deliberately swappable structure — `sendSms(phone, message)` is the one function to fill in once you've picked a provider. Until then, codes are printed to your backend's server logs instead of actually being sent, so you can keep testing signup/login without setting anything up.
- **Provider options** (India-focused, since phone numbers here are `+91`): SMS to Indian numbers technically requires DLT (TRAI) registration if you send under your own name — a real, government-mandated process, not a "gotcha" from any provider. A few practical starting points:
  - **StartMessaging** or **Message Central (Verify Now)** — OTP-specific APIs that handle DLT under their own registered entity, so there's no paperwork on your end; both offer a small batch of free test messages, then pay-as-you-go (roughly ₹0.12–0.25 per OTP).
  - **Fast2SMS** or **MSG91** — larger, more established Indian SMS platforms, also with free trial credits; you'd eventually want your own DLT registration if sending serious volume under your own brand name.
  - Whichever you pick, their dashboard will show you the exact request format for their API — drop that into the marked block inside `sendSms()` in `sms.js`, and add their API URL/key to your `.env`.
- **Email is no longer used for verification at all** — `backend/utils/email.js` and the `RESEND_API_KEY`/`FROM_EMAIL` env vars have been removed. Email remains the login identifier (still unique per account), it just doesn't deliver anything anymore.
- **Database changes**: `users.email_verified` renamed to `users.phone_verified`. If you already have a live Supabase project, run `database/migrations/005_sms_verification.sql`.
- **Frontend error handling improved**: the API client now attaches structured fields (like `needsVerification`) from backend error responses onto the thrown JS error, so pages like `login.html` branch on that flag directly instead of matching on message text — more robust if wording ever changes again.

## 14. What changed in this update (admin approval instead of OTP)

- **OTP is gone entirely** — no SMS, no email, no verification codes of any kind. `backend/utils/sms.js` and `backend/utils/email.js` have both been removed.
- **New signup flow**: creating an account just sets it to `pending` status. There's no code to enter — the user lands on a simple "waiting for approval" page (`pending-approval.html`) and that's it.
- **New admin flow**: the Approvals tab (`admin/approvals.html`) lists every pending sign-up in a table (name, email, phone, signed-up date) with **Approve**/**Reject** buttons. Login is blocked with a clear message until an admin approves.
- **Password reset is also gone** for now, since it depended entirely on the OTP mechanism. If a user forgets their password, an admin can reset it directly in Supabase's Table Editor (hash a new password with bcrypt, or just tell them to sign up again with a different flow) — there's no in-app self-service reset at the moment. Worth revisiting if this becomes a real pain point.
- **Database changes**: `users.phone_verified` and the `otp_*` columns are replaced with a single `users.status` field (`pending` / `approved` / `rejected`). If you already have a live Supabase project on the SMS-based schema, run `database/migrations/006_admin_approval_instead_of_otp.sql` — it automatically carries forward anyone who was already `phone_verified` as `approved`, so no existing working accounts get locked out.
- **Removed pages**: `verify-email.html`, `forgot-password.html`, `reset-password.html`, `admin/otp-lookup.html`.
- **New pages**: `pending-approval.html`, `admin/approvals.html`.

## 15. What changed in this update (visual redesign — background theming, promo match cards, team-logo watermarks)

- **Background image**: `frontend/images/background.jpg` is now used as a darkened backdrop (via a CSS gradient overlay for text readability) on the login, sign-up, pending-approval, and all admin pages — applied via a `themed` class on `<body>`. Regular user-facing pages (matches list, team selection, results) are untouched, keeping their light theme.
- **Match cards redesigned** as a promo-style card — circular team logos, a "VS" divider, team names, and info boxes for date/time and venue — replacing the old plain text card. Used on both the user matches list and the admin dashboard's match list.
- **New optional fields**: `matches.venue` and `matches.match_format` (free text, e.g. "Limited Overs - 35, White Ball") — set them when scheduling a match on `admin/create-match.html`; they show up on the promo card and match detail page if filled in, and are simply omitted if left blank.
- **Team-select page**: the player list now shows a large, pale (7% opacity) watermark of the active team's logo behind the list — switches to both team logos together when viewing "All" or once the full squad (11/11, 4-7 per side) is selected. Purely decorative — `pointer-events: none` on the watermark layer means it never interferes with tapping player rows.
- **Team logos**: pulled directly from each team's existing `logo_url` field (already part of `real_teams`) — no new upload mechanism needed, just point it at any public image URL (e.g. a raw GitHub content link) the same way you already do for player photos.
- **Database changes**: `matches.venue` and `matches.match_format` columns added. If you already have a live Supabase project, run `database/migrations/007_venue_and_format.sql`.
- **New file**: `frontend/images/background.jpg` — make sure this actually gets committed and pushed (some `.gitignore` templates exclude image folders by mistake; double check it shows up in your GitHub repo after pushing).

## 16. What changed in this update (Dream11-style scoring)

Points calculation was rewritten to match a standard Dream11/My11Circle-style scoring structure, based on screenshots the person running this app provided. It's hardcoded in `backend/utils/points.js` (not admin-editable via the database anymore, given how many rules are involved) — adjust the constants at the top of that file if you want different values.

**Batting**: +1/run, +1 bonus per four, +2 bonus per six, milestone bonus (highest tier only: +4 at 25 runs, +8 at 50, +12 at 75, +16 at a century), -2 duck penalty (batsmen/all-rounders only, when out for 0), strike-rate bonus (min 10 balls faced): +6 at SR ≥170 down to -6 at SR ≤60, linear in between.

**Bowling**: +25/wicket (excludes run-outs), milestone bonus (highest tier only: +8 for 3 wickets, +16 for 4, +25 for 5), +8 per bowled/LBW dismissal, +12 per maiden over, economy-rate bonus (min 2 overs bowled): +6 at economy ≤5.00 down to -6 at economy ≥11.00, linear in between.

**Fielding**: +8 each for a catch, stumping, or direct-hit run-out.

**Captain/Vice-Captain**: unchanged — already handled by the existing special-player multiplier system (defaults to 2x/1.5x).

**Two things worth knowing:**
- The screenshots only gave the two extreme values for the economy-rate and strike-rate bonuses (e.g. "+6 under 5.00, -6 above 11.00"), not the exact intermediate steps real Dream11 uses. I implemented a straight linear scale between those two points rather than guessing at discrete tiers — if you have an exact tier table you want to match instead, that logic is isolated in `economyRatePoints()`/`strikeRatePoints()` in `points.js`.
- Whether batting/bowling milestone bonuses stack (get all of +4, +8, +12, +16 for a century) or only the highest one applies was ambiguous from the screenshot. I implemented **highest-tier-only** (a century gets +16, not +40), since that's the more common real-world convention — flip `battingMilestoneBonus()`/`bowlingMilestoneBonus()` in `points.js` if you actually want them to stack.

**New stat fields** needed to support this — `player_match_stats` gained `balls_faced`, `fours`, `sixes`, `is_out`, `bowled_lbw_wickets`, `maidens`, `overs_bowled`, `runs_conceded`. The manual stats-entry form on the match detail page is now grouped into Batting/Bowling/Fielding sections to match. The PDF scorecard parser (`scorecardParser.js`) was extended to extract all of these automatically from a CricHeroes-style export, including the bowled/LBW split — re-verified against the same real match sample used to build the original parser, all values checked out correctly by hand.

**Database changes**: several new columns on `player_match_stats` (see above). If you already have a live Supabase project, run `database/migrations/008_dream11_style_scoring.sql`. The old `scoring_rules` table is no longer used but hasn't been dropped — harmless to leave in place.

## 17. What changed in this update (full visual pass — glass cards, full-page watermark, consistent theming everywhere)

- **Every page is now themed** — the dark stadium-photo backdrop now covers the matches list, team-select, and results pages too, not just login/admin. Ran a full audit and fixed a few spots where loading/empty-state text would've been unreadable (dark text with no card behind it, sitting directly on the new dark background) by wrapping them in a `.card` like everywhere else.
- **Team-select background watermark** is now a full-page fixed layer (covers the whole viewport, not just the area behind the player list) at 50% opacity (up from 7%) — matches your CSS changes.
- **Glass-style player cards** — adopted your frosted/translucent player-row styling (semi-transparent white + blur), tuned so the selected state (brighter tint + colored border/glow) stays clearly distinct from unselected.
- **LBS logo added** (`frontend/images/lbs-logo.png`) as the background watermark for: the "All" tab, once a full squad is selected, and the entire Captain/Vice-Captain selection step. Team-specific tabs (Team A / Team B) still show that team's own logo, unchanged.
- **New/replaced image**: `frontend/images/background.jpg` was swapped for your new version.
- **Note on genericity**: hardcoding the LBS logo path into `team-select.html` (rather than pulling it from the database like team logos do) makes this specific view tied to your league's branding specifically — reasonable since this is your own private app, but worth knowing if you ever want to reuse this codebase for a different league, since that one logo path would need updating in code rather than through the admin panel.

## 18. What changed in this update (credits, re-introduced as configurable)

Credits are back, redesigned to be genuinely configurable per match rather than the old rigid version:

- **Per-player credit value** — set directly on each player (Teams & Players page, single-add form or CSV `credit_value` column), defaults to 8.0 if left blank. One value per player, reused across every match, rather than the old per-match pool entries.
- **Per-match toggle** — when scheduling a match, "Credit-Based Selection" can be Enabled or Disabled, with a Max Credits budget if enabled. Mirrors exactly how the Special Player (Captain/VC) system already works: a separate `match_credit_rules` row, set right after match creation.
- **Team-select page** shows a running credit total when enabled for that match, disables picking a player that would blow the budget, and blocks the Continue button with "Over credit limit" until the squad fits — all alongside the existing 4–7-per-team composition rules, not replacing them.
- **Database changes**: `players.credit_value` column, and a new `match_credit_rules` table (mirrors `match_special_rules`). Run `database/migrations/009_configurable_credits.sql` if you already have a live Supabase project.

**One real bug fixed along the way**: the match-creation endpoint had a leftover line trying to insert `max_credits` directly into the `matches` table — that column doesn't exist (credits live in the separate `match_credit_rules` table), so every match creation would have hit a database error. Removed that dead code; credit rules are correctly set via their own dedicated call right after a match is created, same as special-player rules.
