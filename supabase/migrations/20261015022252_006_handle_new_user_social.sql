create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text := nullif(trim(coalesce(
      m->>'full_name', m->>'name',
      nullif(trim(concat_ws(' ', m->>'given_name', m->>'family_name')), ''))), '');
  v_avatar text := coalesce(m->>'avatar_url', m->>'picture');
  v_provider text := coalesce(new.raw_app_meta_data->>'provider', 'email');
begin
  insert into divers (user_id, full_name, email, avatar_url, auth_provider, locale)
  values (new.id, coalesce(v_name, split_part(new.email, '@', 1)), new.email, v_avatar, v_provider, m->>'locale')
  on conflict (user_id) do update set
    full_name = case when divers.full_name = split_part(new.email, '@', 1) and v_name is not null then v_name else divers.full_name end,
    email = coalesce(divers.email, excluded.email),
    avatar_url = coalesce(divers.avatar_url, excluded.avatar_url),
    auth_provider = coalesce(divers.auth_provider, excluded.auth_provider),
    locale = coalesce(divers.locale, excluded.locale);
  return new;
end $$;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
