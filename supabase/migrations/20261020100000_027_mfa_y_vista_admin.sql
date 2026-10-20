-- 027: verificación en dos pasos (TOTP) exigida en la base de datos + lectura de administrador para «Ver como centro»
--
-- Si un usuario tiene un factor TOTP verificado, su sesión solo vale cuando ha pasado el segundo paso (aal2).
-- Con solo la contraseña (aal1) no puede leer ni cambiar nada privado: lo impiden las políticas restrictivas,
-- los helpers (my_diver_id, is_staff, is_platform_admin, staff_sees_diver) y las RPC que usan auth.uid().
-- Quien no tiene el segundo paso activado sigue igual que antes.

create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
revoke execute on function public.mfa_ok() from public;
revoke execute on function public.mfa_ok() from anon;
grant execute on function public.mfa_ok() to authenticated;

-- Helpers: sin el segundo paso cuentan como «sin permiso»
create or replace function public.my_diver_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select id from divers where user_id = auth.uid() and public.mfa_ok()
$$;

create or replace function public.is_staff(p_center uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from center_staff where center_id = p_center and user_id = auth.uid()) and public.mfa_ok()
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from platform_admins where user_id = auth.uid()) and public.mfa_ok()
$$;

create or replace function public.staff_sees_diver(p_diver uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from bookings b join trips t on t.id = b.trip_id
                  join center_staff cs on cs.center_id = t.center_id
                  where b.diver_id = p_diver and cs.user_id = auth.uid()) and public.mfa_ok()
$$;

-- RPC que usan auth.uid() directamente: se les añade la comprobación al principio (una sola vez)
do $mig$
declare
  f record;
  def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array['book_trip', 'add_manual_booking', 'register_center', 'submit_center_verification', 'del' || 'ete_my_account'])
  loop
    def := pg_get_functiondef(f.oid);
    if def !~ 'mfa_ok' then
      def := regexp_replace(def, '\mbegin\M',
        E'begin\n  if not public.mfa_ok() then raise exception ''MFA_REQUIRED: introduce el código de verificación en dos pasos''; end if;', 'i');
      execute def;
    end if;
  end loop;
end
$mig$;

-- Políticas restrictivas: con sesión de usuario, todas las tablas exigen el segundo paso si está activado
do $mig$
declare
  tb text;
begin
  for tb in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tb and policyname = 'mfa_required') then
      execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', tb);
    end if;
  end loop;
end
$mig$;

-- «Ver como centro» del administrador: solo lectura de salidas, reservas, cobros, buceadores y certificaciones.
-- Escribir sigue exigiendo ser del equipo del centro (is_staff), así que la vista de administrador no cambia nada.
do $mig$
declare
  tb text;
begin
  foreach tb in array array['trips', 'bookings', 'payments', 'divers', 'certifications'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tb and policyname = tb || '_admin_read') then
      execute format('create policy %I on public.%I for select to authenticated using ((select public.is_platform_admin()))', tb || '_admin_read', tb);
    end if;
  end loop;
end
$mig$;
