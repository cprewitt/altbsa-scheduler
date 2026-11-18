# ALTBSA Anchor Scheduler

Thin v1 facility scheduler for the ALTBSA Anchor building.

- **Audience:** allowlisted coaches book themselves; open slots **auto-confirm** (no approval queue)
- **Resources:** **Cages** (one pooled unit) + **Court**
- **Auth:** Supabase magic-link email + `allowed_emails` allowlist
- **Stack:** Next.js App Router + Supabase (Postgres + Auth)
- **Target host:** `schedule.altbsa.org`
- **Brand:** maroon `#862633` / gold `#FFBF3F`

This app lives in `altbsa-scheduler/` as a **separate** Next.js project from the static GitHub Pages site at `altbsa.org`.

## Local setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (or use an existing one).
2. In the Supabase SQL editor, run the migrations **in order**:

   ```bash
   # Or paste each file into the SQL editor and Run
   supabase/migrations/001_initial.sql
   supabase/migrations/002_allowlist.sql
   ```

3. Copy env template and fill in real project values (do not invent secrets):

   ```bash
   cp .env.example .env.local
   ```

   From Supabase → Project Settings → API:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; optional for v1 UI paths)

4. In Supabase → Authentication → URL configuration, set:

   - Site URL: `http://localhost:3000` (local) or `https://schedule.altbsa.org` (prod)
   - Redirect URLs: `http://localhost:3000/auth/callback` and `https://schedule.altbsa.org/auth/callback`

5. Enable **Email** provider and magic link / OTP (default Email works for magic links).

6. Install and run:

   ```bash
   npm install
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Seed notes

The migration seeds:

| Resource slug | Name                     | Notes                                      |
| ------------- | ------------------------ | ------------------------------------------ |
| `cages`       | Cages                    | All cages booked as **one** pooled unit    |
| `court`       | Court                    | Single court resource (may be turfed later)|
| `shoremen`    | Train with the Shoremen  | Grouped under **Other** tab in the UI      |
| `shoregals`   | Train with the ShoreGals | Grouped under **Other** tab in the UI      |
| `t3`          | T3                       | Grouped under **Other** tab in the UI      |

Default open hours (facility-local `America/New_York`):

- Mon–Fri `06:00–21:00`
- Sat–Sun `08:00–20:00`

Slots are **1 hour**. First allowlisted login creates a `profiles` row; role comes from `allowed_emails.intended_role`.

### Allowlist

Only emails in `allowed_emails` can request a magic link. Seeded in `002_allowlist.sql` with head coaches plus admins (`tryouts@altbsa.org`, Chuck Zubek, Jeff Kendera).

Add someone later:

```sql
insert into public.allowed_emails (email, full_name, intended_role, notes)
values ('new.coach@example.com', 'New Coach', 'coach', null);
```

Promote / demote (also updates existing profile if present):

```sql
update public.allowed_emails
set intended_role = 'admin'
where email = 'coach@example.com';

update public.profiles
set role = 'admin'
where email = 'coach@example.com';
```

`SUPABASE_SERVICE_ROLE_KEY` must be set in `.env.local` so the app can check the allowlist before sending OTP.

## Schema summary

| Table                   | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `allowed_emails`        | Who may sign in + intended coach/admin role          |
| `profiles`              | Coach/admin roles keyed to `auth.users`              |
| `resources`             | Bookable units (Cages, Court, Other programs)        |
| `availability_windows`  | Weekly open hours per resource (or all)              |
| `bookings`              | Confirmed/cancelled bookings                         |
| `resource_blocks`       | Admin exclusions / closed periods                    |

**Double-booking prevention:** GiST exclusion constraint on confirmed bookings (`resource_id` + `tstzrange`). A trigger also rejects bookings that overlap `resource_blocks`.

**RLS:** authenticated users can read the schedule; coaches insert/cancel **own** confirmed bookings; admins full override on bookings + blocks.

## Deploy (Vercel + DNS)

1. Push this folder as its **own** git repo (not the static Pages site).
2. Import the repo in [Vercel](https://vercel.com); framework preset Next.js.
3. Add the same env vars as `.env.example` (production Site URL `https://schedule.altbsa.org`).
4. Deploy, then in Vercel → Domains add `schedule.altbsa.org`.
5. At your DNS host for `altbsa.org`, create a CNAME (or A/ALIAS per Vercel) for `schedule` → Vercel’s target.
6. Update Supabase Auth Site URL / redirect URLs to the production domain.

### Email my schedule

On `/schedule`, coaches can click **Email my schedule**. That gathers their confirmed 2027 indoor bookings (cages + court) and emails **to the logged-in coach**.

Send path (first match wins):

1. **Google Workspace Gmail API** (`GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` + `GMAIL_REFRESH_TOKEN`) — sends from `tryouts@altbsa.org` (or `EMAIL_FROM` / `GMAIL_SENDER`).
2. **Resend** (`RESEND_API_KEY`) — optional alternate.
3. **Fallback** — opens mailto to themselves + downloads an `.ics` file.

Note: Supabase magic-link login only uses email as the *sign-in* channel. It does **not** expose that transport to the app for arbitrary messages, so schedule send needs the Workspace OAuth (or Resend) above — ideally the same `tryouts@` mailbox.

## Out of scope (v1)

Parent booking, payments, SMS, field scheduling, waitlists, native mobile apps.
