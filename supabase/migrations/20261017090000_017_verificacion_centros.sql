-- 017: verificación de centros antes de publicar salidas o ser visibles
-- Estados: unverified (sin enviar) · pending (en revisión) · verified · rejected · suspended

alter table public.centers add column if not exists verification_status text not null default 'unverified';
alter table public.centers add column if not exists claims_center_id uuid references public.centers(id);
alter table public.centers add column if not exists verified_at timestamptz;
alter table public.centers add column if not exists review_note text;
do $$ begin
  alter table public.centers add constraint centers_verification_status_chk
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected', 'suspended'));
exception when duplicate_object then null; end $$;

-- Los centros demo cuentan como verificados
update public.centers set verification_status = 'verified', verified_at = coalesce(verified_at, now())
 where name like 'Demo ·%' and verification_status <> 'verified';

-- Administradores de la plataforma
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
do $$ begin
  create policy admins_self on public.platform_admins for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
insert into public.platform_admins (user_id)
  select id from auth.users where email = 'fbolingarcia@gmail.com' on conflict do nothing;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;
grant execute on function public.is_platform_admin() to anon, authenticated;

-- ¿El buceador tiene alguna reserva con este centro? (para seguir viendo sus datos aunque se suspenda)
create or replace function public.diver_booked_center(p_center uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bookings b join trips t on t.id = b.trip_id
                  where t.center_id = p_center and b.diver_id = my_diver_id())
$$;
grant execute on function public.diver_booked_center(uuid) to anon, authenticated;

-- Visibilidad pública: fichas del directorio y centros verificados. El resto solo lo ve su equipo o un administrador.
alter policy centers_read on public.centers using (
  listing_status = 'directorio' or verification_status = 'verified'
  or is_staff(id) or is_platform_admin() or diver_booked_center(id)
);

-- El centro no puede cambiarse a sí mismo el estado de verificación ni el tipo de ficha
create or replace function public.protect_center_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.trusted', true), '') = '1' or is_platform_admin() or auth.uid() is null then
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status
     or new.verified_at is distinct from old.verified_at
     or new.claims_center_id is distinct from old.claims_center_id
     or new.listing_status is distinct from old.listing_status
     or new.review_note is distinct from old.review_note then
    raise exception 'FORBIDDEN: solo la plataforma puede cambiar la verificación del centro';
  end if;
  return new;
end $$;
create or replace trigger centers_protect before update on public.centers
  for each row execute function public.protect_center_columns();

-- Datos de verificación que envía el centro
create table if not exists public.center_verifications (
  center_id uuid primary key references public.centers(id) on delete cascade,
  legal_name text,
  business_reg_type text,          -- dti | sec | cda | otro
  business_reg_number text,
  mayors_permit_number text,
  owner_name text,
  owner_role text,
  contact_email text,
  contact_phone text,
  address text,
  agency text,                     -- padi | ssi | naui | sdi | cmas | otra
  agency_number text,
  social_url text,
  years_operating int,
  notes text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.center_verifications enable row level security;
do $$ begin
  create policy cv_staff on public.center_verifications for all
    using (is_staff(center_id) or is_platform_admin()) with check (is_staff(center_id) or is_platform_admin());
exception when duplicate_object then null; end $$;

create table if not exists public.center_documents (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  kind text not null check (kind in ('business_permit', 'dti_sec', 'owner_id', 'agency_cert', 'shop_photo', 'other')),
  path text not null,
  file_name text,
  created_at timestamptz not null default now()
);
alter table public.center_documents enable row level security;
do $$ begin
  create policy cd_staff on public.center_documents for all
    using (is_staff(center_id) or is_platform_admin()) with check (is_staff(center_id));
exception when duplicate_object then null; end $$;

-- Documentos en un bucket privado: center-docs/<center_id>/<fichero>
insert into storage.buckets (id, name, public, file_size_limit)
  values ('center-docs', 'center-docs', false, 10485760) on conflict (id) do nothing;

create or replace function public.can_access_center_doc(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return is_staff(split_part(p_name, '/', 1)::uuid);
exception when others then return false;
end $$;
grant execute on function public.can_access_center_doc(text) to authenticated;

do $$ begin
  create policy center_docs_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'center-docs' and public.can_access_center_doc(name));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy center_docs_select on storage.objects for select to authenticated
    using (bucket_id = 'center-docs' and (public.can_access_center_doc(name) or public.is_platform_admin()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy center_docs_delete on storage.objects for delete to authenticated
    using (bucket_id = 'center-docs' and public.can_access_center_doc(name));
exception when duplicate_object then null; end $$;

-- El centro envía su solicitud de verificación
create or replace function public.submit_center_verification() returns public.centers
language plpgsql security definer set search_path = public as $$
declare c centers; v center_verifications;
begin
  select ce.* into c from centers ce join center_staff s on s.center_id = ce.id
   where s.user_id = auth.uid() limit 1;
  if not found then raise exception 'FORBIDDEN: no gestionas ningún centro'; end if;
  if c.verification_status = 'verified' then raise exception 'BAD_STATE: tu centro ya está verificado'; end if;
  if c.verification_status = 'suspended' then raise exception 'BAD_STATE: tu centro está suspendido. Escríbenos para revisarlo'; end if;
  select * into v from center_verifications where center_id = c.id;
  if not found or coalesce(trim(v.legal_name), '') = '' or coalesce(trim(v.owner_name), '') = ''
     or coalesce(trim(v.contact_phone), '') = '' or coalesce(trim(v.contact_email), '') = ''
     or coalesce(trim(v.address), '') = ''
     or (coalesce(trim(v.business_reg_number), '') = '' and coalesce(trim(v.mayors_permit_number), '') = '') then
    raise exception 'MISSING_DATA: completa los datos obligatorios del formulario';
  end if;
  if not exists (select 1 from center_documents where center_id = c.id and kind = 'owner_id') then
    raise exception 'MISSING_DOCS: sube el documento de identidad del responsable';
  end if;
  if not exists (select 1 from center_documents where center_id = c.id and kind in ('business_permit', 'dti_sec')) then
    raise exception 'MISSING_DOCS: sube el permiso de negocio (Mayor''s permit) o el registro DTI/SEC';
  end if;
  perform set_config('app.trusted', '1', true);
  update center_verifications set submitted_at = now(), updated_at = now() where center_id = c.id;
  update centers set verification_status = 'pending', review_note = null where id = c.id returning * into c;
  return c;
end $$;
revoke execute on function public.submit_center_verification() from public, anon;
grant execute on function public.submit_center_verification() to authenticated;

-- La plataforma revisa la solicitud
create or replace function public.review_center(p_center uuid, p_decision text, p_note text default null) returns public.centers
language plpgsql security definer set search_path = public as $$
declare c centers;
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN: solo administradores'; end if;
  if p_decision not in ('verified', 'rejected', 'suspended', 'pending') then raise exception 'BAD_DECISION: decisión no válida'; end if;
  if p_decision in ('rejected', 'suspended') and coalesce(trim(p_note), '') = '' then
    raise exception 'NO_NOTE: explica el motivo al centro'; end if;
  perform set_config('app.trusted', '1', true);
  update centers set verification_status = p_decision, review_note = nullif(trim(p_note), ''),
         verified_at = case when p_decision = 'verified' then now() else verified_at end,
         listing_status = case when p_decision = 'verified' then 'socio' else listing_status end
   where id = p_center returning * into c;
  if not found then raise exception 'NOT_FOUND: centro no encontrado'; end if;
  update center_verifications set reviewed_at = now(), reviewed_by = auth.uid() where center_id = p_center;
  -- Al verificar un centro que reclamó una ficha del directorio, la ficha antigua se retira
  if p_decision = 'verified' and c.claims_center_id is not null then
    update centers set source_url = coalesce(centers.source_url, o.source_url)
      from centers o where centers.id = c.id and o.id = c.claims_center_id;
    update centers set listing_status = 'cerrado' where id = c.claims_center_id and listing_status = 'directorio';
  end if;
  -- Si se suspende, sus salidas publicadas pasan a borrador
  if p_decision = 'suspended' then
    update trips set status = 'draft' where center_id = p_center and status = 'published' and departs_at > now()
      and not exists (select 1 from bookings b where b.trip_id = trips.id and b.status in ('confirmed', 'pending_payment'));
  end if;
  select * into c from centers where id = p_center;
  return c;
end $$;
revoke execute on function public.review_center(uuid, text, text) from public, anon;
grant execute on function public.review_center(uuid, text, text) to authenticated;

-- Solo los centros verificados pueden publicar salidas
create or replace function public.enforce_trip_publish() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and not exists (select 1 from centers where id = new.center_id and verification_status = 'verified') then
    raise exception 'NOT_VERIFIED: tu centro aún no está verificado. Podrás publicar salidas cuando lo validemos (puedes dejarlas en borrador).';
  end if;
  return new;
end $$;
create or replace trigger trips_publish_check before insert or update of status on public.trips
  for each row execute function public.enforce_trip_publish();

-- Solo se reserva desde la app con centros verificados
create or replace function public.enforce_booking_verified() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'app' and not exists (
       select 1 from trips t join centers c on c.id = t.center_id
        where t.id = new.trip_id and c.verification_status = 'verified') then
    raise exception 'NOT_VERIFIED: este centro no acepta reservas en este momento';
  end if;
  return new;
end $$;
create or replace trigger bookings_verified_check before insert on public.bookings
  for each row execute function public.enforce_booking_verified();

-- Las salidas públicas solo son de centros verificados
create or replace view public.published_trips with (security_invoker = true) as
 SELECT t.id,
    t.center_id,
    t.departs_at,
    t.num_dives,
    t.min_level,
    t.price_php,
    t.gear_rental_php,
    c.name AS center_name,
    CASE WHEN bo.show_to_divers THEN bo.name END AS boat_name,
    ARRAY( SELECT ds.name
           FROM trip_sites ts
             JOIN dive_sites ds ON ds.id = ts.site_id
          WHERE ts.trip_id = t.id
          ORDER BY ts."position") AS sites,
    app_available_seats(t.id) AS available_seats,
    c.area AS center_area,
    c.locality AS center_locality,
    c.lat AS center_lat,
    c.lng AS center_lng,
    trip_booked_seats(t.id) AS booked_seats,
    c.destination AS center_destination,
    c.province AS center_province,
    c.languages AS center_languages
   FROM trips t
     JOIN centers c ON c.id = t.center_id
     JOIN boats bo ON bo.id = t.boat_id
  WHERE t.status = 'published'::trip_status AND c.verification_status = 'verified';
alter view public.published_trips set (security_invoker = true);

-- Alta de centro: si reclama una ficha del directorio se crea un centro nuevo enlazado;
-- la ficha pública no cambia hasta que la plataforma verifica al nuevo responsable.
create or replace function public.register_center(p_name text, p_phone text)
returns public.centers language plpgsql security definer set search_path = public as $$
declare c centers; l centers;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: inicia sesión'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NO_NAME: indica el nombre del centro'; end if;
  if exists (select 1 from center_staff where user_id = auth.uid()) then
    raise exception 'BAD_STATE: ya gestionas un centro'; end if;
  if exists (select 1 from centers where lower(name) = lower(trim(p_name)) and listing_status <> 'directorio' and listing_status <> 'cerrado') then
    raise exception 'BAD_STATE: ya hay una cuenta para ese centro. Si eres el responsable, escríbenos y lo revisamos';
  end if;
  select * into l from centers
   where lower(name) = lower(trim(p_name)) and listing_status = 'directorio' and name not like 'Demo ·%'
   limit 1;
  insert into centers (name, phone, listing_status, verification_status, claims_center_id,
                       area, locality, destination, province, lat, lng, location_precision, website, languages)
  values (coalesce(l.name, trim(p_name)), coalesce(nullif(trim(p_phone), ''), l.phone), 'socio', 'unverified', l.id,
          l.area, l.locality, l.destination, l.province, l.lat, l.lng, l.location_precision, l.website, coalesce(l.languages, '{}'))
  returning * into c;
  insert into center_staff (center_id, user_id, role) values (c.id, auth.uid(), 'owner');
  update divers set account_type = 'center' where user_id = auth.uid();
  return c;
end $$;
revoke execute on function public.register_center(text, text) from public, anon;
grant execute on function public.register_center(text, text) to authenticated;

-- Las funciones de trigger no se llaman por la API
revoke execute on function public.protect_center_columns() from public, anon, authenticated;
revoke execute on function public.enforce_trip_publish() from public, anon, authenticated;
revoke execute on function public.enforce_booking_verified() from public, anon, authenticated;
revoke execute on function public.can_access_center_doc(text) from public, anon;
