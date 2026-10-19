-- 023: gestión de administradores desde la app, sin que el acceso sea visible para nadie más.
-- Solo un administrador puede ver la lista, dar acceso a otra cuenta (por su email) o quitarlo.
-- platform_admins ya tiene RLS (cada uno solo se ve a sí mismo); aquí además se quitan permisos sobrantes.

revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;

create or replace function public.admin_list()
returns table (user_id uuid, email text, created_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN: no autorizado'; end if;
  return query
    select pa.user_id, u.email::text, pa.created_at, pa.user_id = auth.uid()
      from platform_admins pa join auth.users u on u.id = pa.user_id
     order by pa.created_at;
end $$;

create or replace function public.admin_grant(p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN: no autorizado'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'NOT_FOUND: no hay ninguna cuenta con ese email. Regístrala primero en la app.'; end if;
  insert into platform_admins (user_id) values (uid) on conflict do nothing;
  -- La cuenta de administración no se muestra a otros buceadores
  update divers set show_on_trips = false where user_id = uid;
end $$;

create or replace function public.admin_revoke(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN: no autorizado'; end if;
  if (select count(*) from platform_admins) <= 1 then raise exception 'LAST_ADMIN: tiene que quedar al menos un administrador'; end if;
  delete from platform_admins where user_id = p_user;
end $$;

revoke execute on function public.admin_list() from public, anon;
revoke execute on function public.admin_grant(text) from public, anon;
revoke execute on function public.admin_revoke(uuid) from public, anon;
grant execute on function public.admin_list() to authenticated;
grant execute on function public.admin_grant(text) to authenticated;
grant execute on function public.admin_revoke(uuid) to authenticated;
