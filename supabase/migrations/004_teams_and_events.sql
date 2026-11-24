-- First-class teams + unified schedule events (multi-team cards, location filters).
-- Bookings remain for cages/court slot locking; events are the calendar display model.
-- Future: optional Anchor facility API connector can sync into schedule_events.

create type public.sport_kind as enum ('baseball', 'softball');

create type public.event_attendance_policy as enum (
  'bookable',       -- cages/court: coach books/cancels own slot
  'team_optional',  -- T3: coach may leave (drop their team); others stay
  'fixed'           -- Shoremen/ShoreGals: coaches cannot leave
);

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,              -- e.g. "8U Maroon Baseball"
  age_group text not null,                -- e.g. "8U", "10U"
  sport public.sport_kind not null,
  color text,                             -- Maroon / Gold / White
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index teams_age_sport_idx on public.teams (age_group, sport);

create table public.team_coaches (
  team_id uuid not null references public.teams (id) on delete cascade,
  coach_user_id uuid not null references public.profiles (id) on delete cascade,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (team_id, coach_user_id)
);

create index team_coaches_coach_idx on public.team_coaches (coach_user_id);

-- ---------------------------------------------------------------------------
-- Schedule events (unified calendar items)
-- ---------------------------------------------------------------------------
create table public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete restrict,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.booking_status not null default 'confirmed',
  attendance_policy public.event_attendance_policy not null default 'bookable',
  notes text,
  -- Link to cages/court booking when this event was created from self-serve book
  booking_id uuid references public.bookings (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index schedule_events_resource_time_idx
  on public.schedule_events (resource_id, starts_at, ends_at)
  where status = 'confirmed';

create index schedule_events_booking_idx on public.schedule_events (booking_id);

create table public.schedule_event_teams (
  event_id uuid not null references public.schedule_events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  primary key (event_id, team_id)
);

create index schedule_event_teams_team_idx on public.schedule_event_teams (team_id);

-- Optional: bookings.team_id for future cage/court book-as-team
alter table public.bookings
  add column if not exists team_id uuid references public.teams (id) on delete set null;

create index if not exists bookings_team_idx on public.bookings (team_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.team_coaches enable row level security;
alter table public.schedule_events enable row level security;
alter table public.schedule_event_teams enable row level security;

create policy "teams_select_authenticated"
  on public.teams for select to authenticated using (true);

create policy "teams_admin_write"
  on public.teams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "team_coaches_select_authenticated"
  on public.team_coaches for select to authenticated using (true);

create policy "team_coaches_admin_write"
  on public.team_coaches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "schedule_events_select_authenticated"
  on public.schedule_events for select to authenticated using (true);

create policy "schedule_events_admin_write"
  on public.schedule_events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Coaches may insert bookable events for themselves (paired with booking flow via service/actions)
create policy "schedule_events_insert_authenticated"
  on public.schedule_events for insert to authenticated
  with check (
    public.is_admin()
    or (
      attendance_policy = 'bookable'
      and created_by = auth.uid()
      and status = 'confirmed'
    )
  );

create policy "schedule_events_cancel_bookable_own"
  on public.schedule_events for update to authenticated
  using (
    public.is_admin()
    or (
      attendance_policy = 'bookable'
      and created_by = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or status = 'cancelled'
  );

create policy "schedule_event_teams_select_authenticated"
  on public.schedule_event_teams for select to authenticated using (true);

create policy "schedule_event_teams_admin_write"
  on public.schedule_event_teams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Coach may drop their own team from a team_optional (T3) event
create policy "schedule_event_teams_leave_optional"
  on public.schedule_event_teams for delete to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.schedule_events e
      join public.team_coaches tc
        on tc.team_id = schedule_event_teams.team_id
       and tc.coach_user_id = auth.uid()
      where e.id = schedule_event_teams.event_id
        and e.status = 'confirmed'
        and e.attendance_policy = 'team_optional'
    )
  );
