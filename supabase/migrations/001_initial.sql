-- ALTBSA Anchor facility scheduler — initial schema
-- Resources: Cages (pooled) + Court
-- Overlap prevention via exclusion constraints (btree_gist)

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('coach', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'coach',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- Resources
-- ---------------------------------------------------------------------------
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.resources (slug, name, description, sort_order) values
  ('cages', 'Cages', 'All batting cages booked as one pooled unit', 1),
  ('court', 'Court', 'Indoor court (may be turfed later)', 2);

-- ---------------------------------------------------------------------------
-- Weekly open hours (availability windows)
-- day_of_week: 0 = Sunday … 6 = Saturday (ISO-ish; matches date-fns getDay)
-- ---------------------------------------------------------------------------
create table public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references public.resources (id) on delete cascade,
  -- null resource_id = applies to all resources
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time)
);

create index availability_windows_resource_dow_idx
  on public.availability_windows (resource_id, day_of_week);

-- Default open hours for all resources (America/New_York local times)
-- Weekdays 6:00–21:00, weekends 8:00–20:00
insert into public.availability_windows (resource_id, day_of_week, start_time, end_time)
select null, d, '06:00'::time, '21:00'::time
from generate_series(1, 5) as d;

insert into public.availability_windows (resource_id, day_of_week, start_time, end_time)
values
  (null, 0, '08:00', '20:00'),
  (null, 6, '08:00', '20:00');

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------
create type public.booking_status as enum ('confirmed', 'cancelled');

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete restrict,
  coach_user_id uuid not null references public.profiles (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.booking_status not null default 'confirmed',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index bookings_resource_time_idx
  on public.bookings (resource_id, starts_at, ends_at)
  where status = 'confirmed';

create index bookings_coach_idx on public.bookings (coach_user_id);

-- No overlapping confirmed bookings on the same resource
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status = 'confirmed');

-- ---------------------------------------------------------------------------
-- Admin blocks / exclusions (maintenance, closed periods, holds)
-- ---------------------------------------------------------------------------
create table public.resource_blocks (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index resource_blocks_resource_time_idx
  on public.resource_blocks (resource_id, starts_at, ends_at);

alter table public.resource_blocks
  add constraint resource_blocks_no_overlap
  exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  );

-- Reject confirmed bookings that overlap an admin block
create or replace function public.prevent_booking_over_block()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'confirmed' and exists (
    select 1
    from public.resource_blocks b
    where b.resource_id = new.resource_id
      and tstzrange(b.starts_at, b.ends_at, '[)') &&
          tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'Slot is blocked by an admin exclusion';
  end if;
  return new;
end;
$$;

create trigger bookings_prevent_over_block
  before insert or update on public.bookings
  for each row
  execute function public.prevent_booking_over_block();

-- ---------------------------------------------------------------------------
-- Profile bootstrap on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'coach'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers for RLS
-- ---------------------------------------------------------------------------
create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.resources enable row level security;
alter table public.availability_windows enable row level security;
alter table public.bookings enable row level security;
alter table public.resource_blocks enable row level security;

-- Profiles: authenticated users can read names/emails for the schedule grid
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

create policy "profiles_admin_update"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Resources: coaches/admins can read active schedule resources
create policy "resources_select_authenticated"
  on public.resources for select to authenticated
  using (true);

create policy "resources_admin_write"
  on public.resources for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Availability windows
create policy "availability_select_authenticated"
  on public.availability_windows for select to authenticated
  using (true);

create policy "availability_admin_write"
  on public.availability_windows for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Bookings: read schedule; create/cancel own when confirmed path is free
create policy "bookings_select_authenticated"
  on public.bookings for select to authenticated
  using (true);

create policy "bookings_insert_own_confirmed"
  on public.bookings for insert to authenticated
  with check (
    coach_user_id = auth.uid()
    and status = 'confirmed'
  );

create policy "bookings_cancel_own"
  on public.bookings for update to authenticated
  using (coach_user_id = auth.uid())
  with check (
    coach_user_id = auth.uid()
    and status = 'cancelled'
  );

create policy "bookings_admin_all"
  on public.bookings for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Blocks: everyone can see closed times; only admins write
create policy "blocks_select_authenticated"
  on public.resource_blocks for select to authenticated
  using (true);

create policy "blocks_admin_write"
  on public.resource_blocks for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
