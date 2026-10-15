-- 009 · Dos perfiles (buceador / centro), check-in en el centro y bitácora de inmersiones con fotos

-- ── Tipo de cuenta ──
alter table public.divers
  add column if not exists account_type text not null default 'diver' check (account_type in ('diver', 'center'));
update public.divers d set account_type = 'center'
 where exists (select 1 from center_staff s where s.user_id = d.user_id);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := nullif(trim(coalesce(
      m->>'full_name', m->>'name',
      nullif(trim(concat_ws(' ', m->>'given_name', m->>'family_name')), ''))), '');
  v_avatar text := coalesce(m->>'avatar_url', m->>'picture');
  v_provider text := coalesce(new.raw_app_meta_data->>'provider', 'email');
  v_type text := case when m->>'account_type' = 'center' then 'center' else 'diver' end;
begin
  insert into divers (user_id, full_name, email, avatar_url, auth_provider, locale, account_type)
  values (new.id, coalesce(v_name, split_part(new.email, '@', 1)), new.email, v_avatar, v_provider, m->>'locale', v_type)
  on conflict (user_id) do update set
    full_name = case when divers.full_name = split_part(new.email, '@', 1) and v_name is not null then v_name else divers.full_name end,
    email = coalesce(divers.email, excluded.email),
    avatar_url = coalesce(divers.avatar_url, excluded.avatar_url),
    auth_provider = coalesce(divers.auth_provider, excluded.auth_provider),
    locale = coalesce(divers.locale, excluded.locale);
  return new;
end $$;
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Al registrar un centro, la cuenta pasa a ser de centro
create or replace function public.register_center(p_name text, p_phone text) returns centers
language plpgsql security definer set search_path = public as $$
declare c centers;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: inicia sesión'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NO_NAME: indica el nombre del centro'; end if;
  if exists (select 1 from center_staff where user_id = auth.uid()) then
    raise exception 'BAD_STATE: ya gestionas un centro'; end if;
  select * into c from centers
   where lower(name) = lower(trim(p_name)) and area = 'Panglao'
     and not exists (select 1 from center_staff s where s.center_id = centers.id)
   limit 1 for update;
  if found then
    update centers set listing_status = 'socio', phone = coalesce(nullif(trim(p_phone), ''), phone)
     where id = c.id returning * into c;
  elsif exists (select 1 from centers where lower(name) = lower(trim(p_name)) and area = 'Panglao') then
    raise exception 'BAD_STATE: ese centro ya tiene responsable. Pide acceso a su dueño';
  else
    insert into centers (name, phone, listing_status) values (trim(p_name), nullif(trim(p_phone), ''), 'socio') returning * into c;
  end if;
  insert into center_staff (center_id, user_id, role) values (c.id, auth.uid(), 'owner');
  update divers set account_type = 'center' where user_id = auth.uid();
  return c;
end $$;

-- ── Check-in de buceadores el día de la salida ──
alter table public.bookings add column if not exists checked_in_at timestamptz;

create or replace function public.set_checkin(p_booking uuid, p_in boolean) returns bookings
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where id = p_booking for update;
  if not found or not is_staff(trip_center(b.trip_id)) then raise exception 'FORBIDDEN'; end if;
  if b.status not in ('pending_payment', 'confirmed') then raise exception 'BAD_STATE: la reserva no está activa'; end if;
  update bookings set checked_in_at = case when p_in then now() end where id = b.id returning * into b;
  return b;
end $$;
revoke execute on function public.set_checkin(uuid, boolean) from public, anon;
grant execute on function public.set_checkin(uuid, boolean) to authenticated;

-- ── Bitácora de inmersiones ──
create table if not exists public.dive_logs (
  id                uuid primary key default gen_random_uuid(),
  diver_id          uuid not null references public.divers(id) on delete cascade,
  booking_id        uuid references public.bookings(id) on delete set null,
  center_id         uuid references public.centers(id) on delete set null,
  site_id           uuid references public.dive_sites(id) on delete set null,
  site_name         text,
  dive_date         date not null,
  entry_time        time,
  max_depth_m       numeric(5,1) check (max_depth_m between 0 and 350),
  avg_depth_m       numeric(5,1) check (avg_depth_m between 0 and 350),
  duration_min      integer check (duration_min between 0 and 600),
  water_temp_c      numeric(4,1),
  visibility_m      integer check (visibility_m between 0 and 100),
  gas               text not null default 'air' check (gas in ('air', 'nitrox', 'trimix')),
  o2_pct            integer check (o2_pct between 21 and 100),
  tank_start_bar    integer check (tank_start_bar between 0 and 350),
  tank_end_bar      integer check (tank_end_bar between 0 and 350),
  weights_kg        numeric(4,1),
  suit              text,
  buddy             text,
  conditions        text,
  marine_life       text,
  rating            smallint check (rating between 1 and 5),
  notes             text,
  share_with_center boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_dive_logs_diver on public.dive_logs (diver_id, dive_date desc);
alter table public.dive_logs enable row level security;
create policy dive_logs_self on public.dive_logs for all
  using (diver_id = my_diver_id()) with check (diver_id = my_diver_id());
create policy dive_logs_center on public.dive_logs for select
  using (share_with_center and center_id is not null and is_staff(center_id));

create table if not exists public.dive_log_photos (
  id         uuid primary key default gen_random_uuid(),
  log_id     uuid not null references public.dive_logs(id) on delete cascade,
  path       text not null,
  caption    text,
  created_at timestamptz not null default now()
);
create index if not exists idx_dive_log_photos_log on public.dive_log_photos (log_id);
alter table public.dive_log_photos enable row level security;
create policy dive_log_photos_self on public.dive_log_photos for all
  using (exists (select 1 from dive_logs l where l.id = log_id and l.diver_id = my_diver_id()))
  with check (exists (select 1 from dive_logs l where l.id = log_id and l.diver_id = my_diver_id()));

-- Fotos: bucket privado; cada usuario solo accede a su carpeta <user_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dive-photos', 'dive-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;
create policy dive_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'dive-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy dive_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dive-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy dive_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dive-photos' and (storage.foldername(name))[1] = auth.uid()::text);
