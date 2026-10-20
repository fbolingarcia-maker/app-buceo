-- 024: endurecimiento de seguridad (compatible con la app publicada; se puede aplicar antes de subir el frontend).
--  1. Los visitantes sin sesión (anon) solo pueden LEER: se les quitan los permisos de escritura sobrantes en todas las tablas.
--     Nadie (anon/authenticated) puede hacer TRUNCATE, REFERENCES ni TRIGGER (TRUNCATE no pasa por RLS).
--  2. Bucket privado center-docs: solo PDF e imágenes (antes aceptaba cualquier tipo de fichero).
--  3. Registro de auditoría de acciones de administración (validaciones de centros y altas/bajas de administradores).
--  4. admin_users(): los administradores ven los datos de perfil de todos los usuarios (nunca contraseñas ni datos de pago).

-- 1 ─────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p') loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', r.relname);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', r.relname);
  end loop;
end $$;
-- Las tablas que se creen en el futuro tampoco darán escritura a anon
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- 2 ─────────────────────────────────────────────────────────────
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'],
       file_size_limit = 10485760
 where id = 'center-docs';

-- 3 ─────────────────────────────────────────────────────────────
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                 -- auth.uid() de quien hizo el cambio (null = proceso del sistema)
  action text not null,       -- center_status | admin_grant | admin_revoke
  target uuid,
  detail jsonb
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
grant select on public.admin_audit to authenticated;
create policy admin_audit_read on public.admin_audit for select using (is_platform_admin());
create index if not exists idx_admin_audit_at on public.admin_audit (at desc);

create or replace function public.audit_center_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.verification_status is distinct from old.verification_status then
    insert into admin_audit (actor, action, target, detail)
    values (auth.uid(), 'center_status', new.id,
            jsonb_build_object('name', new.name, 'from', old.verification_status, 'to', new.verification_status, 'note', new.review_note));
  end if;
  return new;
end $$;
create or replace trigger trg_audit_center_status after update of verification_status on public.centers
  for each row execute function public.audit_center_status();

create or replace function public.audit_admins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into admin_audit (actor, action, target, detail)
  values (auth.uid(), case when tg_op = 'INSERT' then 'admin_grant' else 'admin_revoke' end,
          coalesce(new.user_id, old.user_id),
          jsonb_build_object('email', (select email from auth.users where id = coalesce(new.user_id, old.user_id))));
  return null;
end $$;
create or replace trigger trg_audit_admins after insert or delete on public.platform_admins
  for each row execute function public.audit_admins();

revoke execute on function public.audit_center_status() from public, anon, authenticated;
revoke execute on function public.audit_admins() from public, anon, authenticated;

-- 4 ─────────────────────────────────────────────────────────────
-- Datos de perfil de todos los usuarios para el panel de administración.
-- Nunca devuelve contraseñas (Auth solo guarda su hash bcrypt) ni datos de pago (los gestiona PayMongo).
create or replace function public.admin_users()
returns table (
  diver_id uuid, user_id uuid, full_name text, email text, account_type text, country text,
  languages text[], logged_dives int, bio text, seeks_buddy boolean, show_on_trips boolean,
  signed_up_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean, auth_provider text,
  certifications jsonb, bookings_total int, bookings_upcoming int, centers jsonb, is_admin boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN: no autorizado'; end if;
  return query
  select d.id, d.user_id, d.full_name, coalesce(u.email::text, d.email), d.account_type, d.country,
         d.languages, d.logged_dives, d.bio, d.seeks_buddy, d.show_on_trips,
         u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null, d.auth_provider,
         coalesce((select jsonb_agg(jsonb_build_object('agency', c.agency, 'level', c.level, 'verified', c.verified_at is not null) order by c.level)
                     from certifications c where c.diver_id = d.id), '[]'::jsonb),
         (select count(*)::int from bookings b where b.diver_id = d.id),
         (select count(*)::int from bookings b join trips t on t.id = b.trip_id
           where b.diver_id = d.id and t.departs_at > now() and b.status in ('confirmed', 'pending_payment')),
         coalesce((select jsonb_agg(jsonb_build_object('id', ce.id, 'name', ce.name, 'role', s.role, 'status', ce.verification_status))
                     from center_staff s join centers ce on ce.id = s.center_id where s.user_id = d.user_id), '[]'::jsonb),
         exists (select 1 from platform_admins pa where pa.user_id = d.user_id)
    from divers d
    left join auth.users u on u.id = d.user_id
   where d.user_id is not null
   order by u.created_at desc nulls last;
end $$;
revoke execute on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- 5 ─────────────────────────────────────────────────────────────
-- Datos privados del centro (nº GCash, nota de la revisión, notas internas): solo su personal y los administradores.
-- La app los pide con esta función; la migración 025 los oculta de las lecturas normales de la tabla.
create or replace function public.center_private(p_center uuid)
returns table (gcash_number text, review_note text, notes text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_staff(p_center) or is_platform_admin()) then raise exception 'FORBIDDEN: no autorizado'; end if;
  return query select c.gcash_number, c.review_note, c.notes from centers c where c.id = p_center;
end $$;
revoke execute on function public.center_private(uuid) from public, anon;
grant execute on function public.center_private(uuid) to authenticated;
