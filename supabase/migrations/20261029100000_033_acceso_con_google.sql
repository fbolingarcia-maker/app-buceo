-- 033: acceso con Google.
--
-- El proveedor Google se activa en Supabase (Authentication → Sign In / Providers → Google) con el Client ID y el
-- Client Secret de Google Cloud; aquí solo se completa el perfil con lo que manda Google:
--   nombre (full_name / name), email, foto (avatar_url / picture) e idioma (locale → divers.languages).
-- handle_new_user ya rellenaba nombre, email, foto, proveedor y locale; ahora además pone el idioma que habla
-- si es uno de los de la app y la cuenta aún no tiene ninguno.
-- Si alguien que ya tenía cuenta con email entra con Google (mismo email), Supabase enlaza las dos identidades:
-- el trigger de auth.identities añade la foto y el nombre si faltaban.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := nullif(trim(coalesce(
      m->>'full_name', m->>'name',
      nullif(trim(concat_ws(' ', m->>'given_name', m->>'family_name')), ''))), '');
  v_avatar text := coalesce(m->>'avatar_url', m->>'picture');
  v_provider text := coalesce(new.raw_app_meta_data->>'provider', 'email');
  v_type text := case when m->>'account_type' = 'center' then 'center' else 'diver' end;
  v_lang text := lower(split_part(replace(coalesce(m->>'locale', ''), '_', '-'), '-', 1));
  v_langs text[] := case when v_lang in ('en', 'es', 'tl', 'de', 'fr', 'it', 'nl', 'pt', 'ru', 'zh', 'ja', 'ko')
                         then array[v_lang] else '{}'::text[] end;
begin
  insert into divers (user_id, full_name, email, avatar_url, auth_provider, locale, account_type, languages)
  values (new.id, coalesce(v_name, split_part(new.email, '@', 1)), new.email, v_avatar, v_provider, m->>'locale', v_type, v_langs)
  on conflict (user_id) do update set
    full_name = case when divers.full_name = split_part(new.email, '@', 1) and v_name is not null then v_name else divers.full_name end,
    email = coalesce(divers.email, excluded.email),
    avatar_url = coalesce(divers.avatar_url, excluded.avatar_url),
    auth_provider = coalesce(divers.auth_provider, excluded.auth_provider),
    locale = coalesce(divers.locale, excluded.locale),
    languages = case when coalesce(cardinality(divers.languages), 0) = 0 then excluded.languages else divers.languages end;
  return new;
end $function$;

-- Cuenta existente que se conecta con Google: completa foto y nombre si faltaban
create or replace function private.on_identity_linked() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.identity_data, '{}'::jsonb);
  v_name text := nullif(trim(coalesce(m->>'full_name', m->>'name')), '');
begin
  if new.provider = 'google' then
    update public.divers d set
      avatar_url = coalesce(d.avatar_url, m->>'avatar_url', m->>'picture'),
      full_name = case when v_name is not null and d.full_name = split_part(coalesce(d.email, ''), '@', 1) then v_name else d.full_name end
    where d.user_id = new.user_id;
  end if;
  return new;
exception when others then
  raise warning 'on_identity_linked: %', sqlerrm; return new;
end $$;
revoke all on function private.on_identity_linked() from public, anon, authenticated;
create or replace trigger on_identity_linked after insert on auth.identities
  for each row execute function private.on_identity_linked();
