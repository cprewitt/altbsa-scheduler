-- Email allowlist: only listed addresses may magic-link in.
-- intended_role is applied on first profile create and can be re-synced.

create table public.allowed_emails (
  email text primary key,
  full_name text,
  intended_role public.user_role not null default 'coach',
  notes text,
  created_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;

-- Authenticated admins can manage the allowlist
create policy "allowed_emails_admin_all"
  on public.allowed_emails
  for all
  to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- Authenticated users can check whether their own email is listed
create policy "allowed_emails_select_own"
  on public.allowed_emails
  for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Seed: head coaches (role coach) + admins
-- Emails stored lowercase for consistent matching
insert into public.allowed_emails (email, full_name, intended_role, notes) values
  -- Baseball head coaches
  ('smoennich5@yahoo.com', 'Sean Moennich', 'coach', '7U/10U Maroon'),
  ('greg.rustad@yahoo.com', 'Greg Rustad', 'coach', '8U Maroon'),
  ('hurley0603@gmail.com', 'Tim Hurley', 'coach', '8U Gold'),
  ('wbmckinley@gmail.com', 'Bill McKinley', 'coach', '9U Maroon'),
  ('jjavers09@jcu.edu', 'Jason Javers', 'coach', '9U Gold'),
  ('kennethremymd@gmail.com', 'Ken Remy', 'coach', '9U White'),
  ('dannyw43@gmail.com', 'Danny White', 'coach', '10U Gold'),
  ('awruda@gmail.com', 'Andrew Ruda', 'coach', '10U White'),
  ('chuck.zubek@gmail.com', 'Chuck Zubek', 'coach', '11U Maroon'),
  ('bjschuler12@gmail.com', 'Brendan Shuler', 'coach', '11U Gold'),
  ('mbrackmanjr@gmail.com', 'Mike Brackman', 'coach', '12U Maroon'),
  ('robert.lomax21@gmail.com', 'Rob Lomax', 'coach', '12U Gold'),
  ('k.dunn3@yahoo.com', 'Kyle Dunn', 'coach', '13U Maroon'),
  ('andrew.prescott87@gmail.com', 'Andrew Prescott', 'coach', '13U Gold'),
  ('mselbylaw@gmail.com', 'Matt Selby', 'coach', '14U Maroon'),
  -- Softball head coaches
  ('woodalljt3@yahoo.com', 'Joe Woodall', 'coach', '10U Gold softball'),
  ('stags22@hotmail.com', 'Tom Steigerwalt', 'coach', '10U Maroon softball'),
  ('j.gigliotti@icloud.com', 'Jake Gigliotti', 'coach', '12U Gold softball'),
  ('csvihlik99@gmail.com', 'Chris Svihlik', 'coach', '12U Maroon softball'),
  ('michael@textbookpainting.com', 'Michael Murray', 'coach', '14U Maroon softball'),
  -- Admins (non-coach or org accounts)
  ('jkendera78@gmail.com', 'Jeff Kendera', 'admin', 'Facilities'),
  ('tryouts@altbsa.org', 'Chris Prewitt', 'admin', 'President / ops'),
  ('treasurer@altbsa.org', 'Treasurer', 'admin', 'Org treasurer account')
on conflict (email) do update
set
  full_name = excluded.full_name,
  intended_role = excluded.intended_role,
  notes = excluded.notes;

-- Bootstrap profile role from allowlist when a user first signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed public.allowed_emails%rowtype;
  normalized_email text := lower(coalesce(new.email, ''));
begin
  select * into allowed
  from public.allowed_emails
  where email = normalized_email;

  if not found then
    -- Block unexpected signups (defense in depth; app also gates OTP)
    raise exception 'Email % is not on the ALTBSA scheduler allowlist', normalized_email;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    normalized_email,
    coalesce(nullif(allowed.full_name, ''), new.raw_user_meta_data ->> 'full_name', ''),
    allowed.intended_role
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    role = excluded.role,
    updated_at = now();

  return new;
end;
$$;

-- Sync roles for anyone who already signed in
update public.profiles p
set
  role = a.intended_role,
  full_name = coalesce(nullif(a.full_name, ''), p.full_name),
  email = a.email,
  updated_at = now()
from public.allowed_emails a
where lower(p.email) = a.email;
