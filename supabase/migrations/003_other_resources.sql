-- Other schedule view: Train with the Shoremen / ShoreGals / T3
-- Bookable as separate resources; UI groups them under the "Other" tab.
-- Default availability_windows (null resource_id) already cover all resources.

insert into public.resources (slug, name, description, sort_order) values
  (
    'shoremen',
    'Train with the Shoremen',
    'ALTBSA Train with the Shoremen sessions',
    3
  ),
  (
    'shoregals',
    'Train with the ShoreGals',
    'ALTBSA Train with the ShoreGals sessions',
    4
  ),
  (
    't3',
    'T3',
    'Team vs team (T3) sessions',
    5
  )
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true;
