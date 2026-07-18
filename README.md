# Fantasy League App

A simplified fantasy-sports app (Dream11-style team picking) with no payments and no live match tracking. Admin schedules matches and loads players; users pick their fantasy XI before a deadline; admin enters final stats from the scoresheet after the match, and points are calculated automatically.

## How it works

1. **Admin** creates a match (two teams, match date, selection deadline, squad size, optional credit limit, special-player rules).
2. **Admin** adds the pool of available players for that match, each with a credit value.
3. **User** signs up, browses matches, and picks their squad (respecting squad size / credit limit), then optionally assigns special player(s) (e.g. Captain/Vice-Captain) if enabled for that match.
4. **Admin** locks the match after the deadline.
5. After the real match ends, **admin** enters each player's stats (runs, wickets, catches, etc.) from the scoresheet.
6. **Admin** clicks "Finalize" — this calculates every user's total points (applying special player multipliers) and marks the match completed.
7. **Users** see their team's points and the leaderboard.

---

## 1. Database setup (Supabase — free tier)

1. Go to https://supabase.com, create a free account and a new project.
2. Open **SQL Editor > New Query**, paste the contents of `database/schema.sql`, and run it.
3. **If you already ran an earlier version of schema.sql**, also run, in order:
   - `database/migrations/001_email_verification_and_fk_fix.sql`
   - `database/migrations/002_remove_credits_team_based_composition.sql`
4. Go to **Project Settings > API Keys** and copy:
   - **Project URL** (Data API page) — use just the base, e.g. `https://xxxx.supabase.co`, not the `/rest/v1/` suffix
   - The **secret** key (labeled `sb_secret_...` under "Secret keys" — this is what used to be called `service_role`)

## 2. Email setup (Resend — free tier)

Signup/login now sends real verification and password-reset codes by email, using [Resend](https://resend.com):

1. Sign up free at https://resend.com (no credit card needed).
2. Go to **API Keys** and create one.
3. **Free tier limitation**: until you verify your own domain in Resend, you can only send emails *to* the address you signed up to Resend with. This is fine for testing with your own email, but real users won't receive codes until you verify a domain (Resend's dashboard walks you through this — it's free, just requires adding a DNS record).

## 3. Backend setup

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
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL=onboarding@resend.dev
PORT=4000
```

Run locally:
```bash
npm run dev
```

Test it's alive: open `http://localhost:4000` — you should see `{"status":"Fantasy App API running"}`.

### Creating your first admin account

Sign up as a normal user first (via the app's signup page), verify your email with the code sent to you, then in Supabase's **Table Editor**, open the `users` table and change that user's `role` from `user` to `admin`. That's your admin login going forward — the same login page works for both, routing based on role.

## 4. Frontend setup

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

## 5. Hosting (free tier)

**Backend** — Render or Railway (free tier):
- Push the `backend/` folder to a GitHub repo.
- On Render: New > Web Service > connect repo > root directory `backend` > build command `npm install` > start command `npm start`.
- Add the same environment variables from your `.env` file in Render's dashboard.
- Free tier services sleep after inactivity — the first request after idle will be slow (~30s) as it wakes up.

**Frontend** — Vercel or Netlify (free tier):
- Push the `frontend/` folder to a GitHub repo (or a subfolder of the same repo).
- On Netlify/Vercel: New Site > connect repo > root directory `frontend` > no build command needed (static site).
- Once deployed, update `API_BASE_URL` to point at your Render backend URL, and redeploy.

## 6. CSV format

**Bulk player upload** (`admin/teams-players.html` → Bulk Upload Players):
```csv
name,real_team_id,role,photo_url
Virat Kohli,<real_team_id>,batsman,
Jasprit Bumrah,<real_team_id>,bowler,
```
`role` must be one of: `batsman`, `bowler`, `all-rounder`, `keeper`.

That's the only CSV needed now — once a match is scheduled between two teams, every player belonging to either team is automatically available for users to pick from. There's no separate per-match player list to manage.

## 7. Converting to a native app later (Android APK / iOS)

Since this is a plain, mobile-friendly web app with a manifest and service worker (PWA), you can wrap it into native apps without rewriting anything:

- **Android APK**: use [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (Google's official tool) or [PWABuilder](https://www.pwabuilder.com/) — point it at your live hosted URL and it generates a Play Store-ready APK/AAB.
- **iOS**: use [Capacitor](https://capacitorjs.com/) to wrap the same web app into an Xcode project you can submit to the App Store.

You'll want to add real icon files at `frontend/icons/icon-192.png` and `frontend/icons/icon-512.png` before doing this (currently the manifest references placeholder paths).

## 8. Project structure

```
fantasy-app/
├── database/
│   └── schema.sql          # Run this in Supabase SQL Editor
├── backend/
│   ├── server.js
│   ├── db/supabase.js
│   ├── middleware/auth.js  # JWT verification + admin check
│   ├── utils/points.js     # Points calculation logic
│   └── routes/
│       ├── auth.js         # signup/login
│       ├── matches.js      # browse matches, view players, public leaderboard
│       ├── fantasyTeams.js # submit/view a user's team (validates deadline/credits/squad size)
│       └── admin.js        # match/player CRUD, CSV upload, stats entry, finalize
└── frontend/
    ├── login.html / signup.html
    ├── matches.html        # match list
    ├── team-select.html    # core: pick squad + special players
    ├── results.html        # user's team + leaderboard
    ├── admin/
    │   ├── dashboard.html
    │   ├── create-match.html
    │   ├── teams-players.html
    │   └── match-detail.html   # lock, enter stats, finalize, leaderboard
    ├── js/api.js            # shared API client + auth/session helpers
    ├── css/style.css
    ├── manifest.json / sw.js   # PWA basics for later native wrapping
```

## 9. Known simplifications (by design, per your requirements)

- No payments/wallet — entirely free-to-play.
- No live match tracking — stats are entered manually by admin post-match (not parsed from PDF automatically; you can add PDF parsing later using a library like `pdf-parse`, but manual entry avoids brittle layout-parsing bugs for now).
- Auth is custom (bcrypt + JWT) rather than Supabase Auth, kept simple and framework-agnostic.
- Email verification codes and password reset codes are stored in plain text on the `users` row with a 15-minute expiry — fine for this app's scale, but note it's less hardened than a dedicated auth provider.

## 10. What changed in this update

- **Bug fix**: match cards used inline `onclick` HTML attributes, which fail silently if anything is off (e.g. a stale cached page). Replaced with proper `addEventListener` calls plus console logging, across `matches.html` and `admin/dashboard.html`. Also added a clear "no players added yet" message on the team-selection page instead of a blank-looking screen — this was likely the actual cause of feeling "stuck", since a match with no players in its pool yet renders an empty list.
- **Email verification & password reset**: signup now sends a 6-digit code via email (Resend) before allowing login; forgot-password flow reuses the same OTP mechanism. New pages: `verify-email.html`, `forgot-password.html`, `reset-password.html`. New backend endpoints: `/api/auth/verify-email`, `/api/auth/resend-code`, `/api/auth/forgot-password`, `/api/auth/reset-password`.
- **Team dropdowns**: `admin/create-match.html` now shows Team A / Team B as dropdowns populated from your saved teams, instead of requiring you to paste UUIDs.
- **Delete buttons**: `admin/teams-players.html` now lists existing teams and players with delete buttons. Deleting a team also deletes its players (cascading, since they only exist under that team). Deleting a player or team that's already used in a scheduled match is **blocked** with a clear error message, rather than silently breaking that match's data — this required a schema fix, see the migration file.

## 11. What changed in this update (credits removed, team-based composition, IST)

- **No more credit-based selection.** Squad is a fixed 11 players. Composition rule: **4 to 7 players from each of the two teams playing** (since these add up to 11, satisfying one side's range automatically satisfies the other). Enforced both client-side (disables the "+" button once a team hits 7) and server-side (rejected at submission if violated).
- **No more manual player pool per match.** When admin schedules a match between Team A and Team B, every player already assigned to either team (via the `real_team_id` on the `players` table) is automatically available for users to pick — the "Add Players to This Match" step is gone entirely. Admin's job is now just: add teams, add players to those teams, schedule the match.
- **Selection deadline is automatic**: always exactly 1 hour before `match_date`. The admin form no longer asks for it separately.
- **All timings are IST (Asia/Kolkata)**, everywhere, regardless of the viewer's or admin's own device timezone:
  - When the admin enters a match date/time, it's interpreted as IST wall-clock time and converted to the correct absolute timestamp before saving (`istInputToUtcIso()` in `js/api.js`).
  - Every displayed date (`matches.html`, admin dashboard, match detail, create-match confirmation) is formatted explicitly in the `Asia/Kolkata` timezone (`formatIST()` in `js/api.js`), so it reads correctly no matter where the device is set.
- **Database changes**: `matches.max_credits` column dropped; `match_players` table dropped entirely. If you already have a live Supabase project, run `database/migrations/002_remove_credits_team_based_composition.sql`.
