-- 035: avisos e importación hacia el Worker de Cloudflare SIN clave compartida.
-- Antes, cada aviso viajaba con la cabecera X-Notify-Key (clave de Vault «divingslot_notify_key» = secreto NOTIFY_KEY
-- del Worker) y hacía falta copiar esa clave a mano. Ahora el contenido se queda aquí, en private.outbox, y al Worker
-- solo se le manda { claim: <uuid aleatorio> }. El Worker lo recoge con la RPC pública outbox_claim(uuid), que lo
-- devuelve una sola vez y solo durante 30 minutos (worker/lib/outbox.js). Nadie puede colar avisos ni datos: solo vale lo
-- que esta base de datos ha puesto en la cola, y el uuid no se puede adivinar. Si la clave sigue en Vault, también se
-- manda la cabecera (el Worker la acepta si tiene NOTIFY_KEY).

create extension if not exists pg_net with schema extensions;
create schema if not exists private;

create table if not exists private.outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('notify', 'import')),
  body jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.outbox enable row level security;
revoke all on private.outbox from public, anon, authenticated;

-- Encola y avisa al Worker. Devuelve el id de la petición de pg_net (o null si falla).
create or replace function private.outbox_push(p_kind text, p_body jsonb, p_path text default '/api/notify', p_timeout int default 5000)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  k text;
  u text;
  i uuid;
  h jsonb := jsonb_build_object('Content-Type', 'application/json');
begin
  delete from private.outbox where created_at < now() - interval '1 day';
  insert into private.outbox (kind, body) values (p_kind, p_body) returning id into i;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'divingslot_notify_key';
  if k is not null then h := h || jsonb_build_object('X-Notify-Key', k); end if;
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'divingslot_notify_url'),
                  'https://divingslot.com/api/notify') into u;
  u := regexp_replace(u, '/api/notify$', p_path);
  return net.http_post(url := u, body := jsonb_build_object('claim', i), headers := h, timeout_milliseconds := p_timeout);
end $$;
revoke all on function private.outbox_push(text, jsonb, text, int) from public, anon, authenticated;

-- El Worker recoge el contenido (una sola vez, máximo 30 minutos después)
create or replace function public.outbox_claim(p_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  delete from private.outbox where id = p_id and created_at > now() - interval '30 minutes'
  returning jsonb_build_object('kind', kind, 'body', body);
$$;
revoke all on function public.outbox_claim(uuid) from public;
grant execute on function public.outbox_claim(uuid) to anon, authenticated;

-- Avisos (030/031): ya no necesitan la clave en Vault
create or replace function private.notify_send(p_kind text, p_title text, p_lines text[], p_url text, p_to text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.outbox_push('notify', jsonb_build_object('kind', p_kind, 'title', p_title,
    'lines', to_jsonb(coalesce(p_lines, '{}'::text[])), 'url', p_url, 'to', to_jsonb(coalesce(p_to, '{}'::text[]))));
exception when others then
  raise warning 'notify_send: %', sqlerrm;
end $$;

create or replace function private.notify_admin(p_kind text, p_title text, p_lines text[], p_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_send(p_kind, p_title, p_lines, p_url, null);
end $$;
revoke all on function private.notify_send(text, text, text[], text, text[]) from public, anon, authenticated;
revoke all on function private.notify_admin(text, text, text[], text) from public, anon, authenticated;
