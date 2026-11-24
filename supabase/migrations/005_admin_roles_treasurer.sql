-- Chuck Zubek: admin → coach (keeps 11U Maroon coaching access)
-- treasurer@altbsa.org: new admin allowlist entry

update public.allowed_emails
set
  intended_role = 'coach',
  notes = '11U Maroon'
where email = 'chuck.zubek@gmail.com';

update public.profiles
set
  role = 'coach',
  updated_at = now()
where email = 'chuck.zubek@gmail.com';

insert into public.allowed_emails (email, full_name, intended_role, notes)
values ('treasurer@altbsa.org', 'Treasurer', 'admin', 'Org treasurer account')
on conflict (email) do update
set
  full_name = excluded.full_name,
  intended_role = excluded.intended_role,
  notes = excluded.notes;

update public.profiles
set
  role = 'admin',
  updated_at = now()
where email = 'treasurer@altbsa.org';
