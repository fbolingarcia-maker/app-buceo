alter table public.divers
  add column if not exists email text,
  add column if not exists avatar_url text,
  add column if not exists auth_provider text,
  add column if not exists locale text;
