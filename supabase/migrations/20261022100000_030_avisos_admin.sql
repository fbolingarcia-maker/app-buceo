-- 030: avisos de uso por email al administrador.
-- Cuando alguien crea una cuenta, da de alta un centro, envía la verificación, reserva o paga online, la base de datos
-- avisa al Worker de Cloudflare (POST https://divingslot.com/api/notify, con pg_net, sin esperar respuesta) y el
-- Worker manda el email y lo apunta para el resumen diario y el panel (worker/stats.js).
-- La clave compartida NO va en este fichero: se guarda en Vault con el nombre «divingslot_notify_key» y la misma
-- clave va en el Worker como secreto NOTIFY_KEY. Sin clave en Vault no se envía nada.
-- Un fallo al avisar nunca impide la operación (solo deja un warning en el log).

create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.notify_admin(p_kind text, p_title text, p_lines text[], p_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  k text;
  u text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'divingslot_notify_key';
  if k is null then return; end if;
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'divingslot_notify_url'),
                  'https://divingslot.com/api/notify') into u;
  perform net.http_post(
    url := u,
    body := jsonb_build_object('kind', p_kind, 'title', p_title, 'lines', to_jsonb(coalesce(p_lines, '{}'::text[])), 'url', p_url),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Notify-Key', k),
    timeout_milliseconds := 5000);
exception when others then
  raise warning 'notify_admin: %', sqlerrm;
end $$;
revoke all on function private.notify_admin(text, text, text[], text) from public, anon, authenticated;

-- Cuenta nueva
create or replace function private.notify_new_diver() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_admin('alta',
    case when new.account_type = 'center' then 'Nueva cuenta de centro: ' else 'Nueva cuenta de buceador: ' end || coalesce(new.full_name, '(sin nombre)'),
    array_remove(array[
      'Email: ' || coalesce(new.email, '—'),
      case when new.country is not null then 'País: ' || new.country end,
      case when new.auth_provider is not null then 'Alta con: ' || new.auth_provider end
    ], null),
    'https://divingslot.com/app/#/admin/users');
  return null;
exception when others then
  raise warning 'notify_new_diver: %', sqlerrm; return null;
end $$;

-- Centro dado de alta por un usuario (no las fichas del directorio que se cargan en bloque) y centro que pide verificación
create or replace function private.notify_center() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name like 'Demo%' then return null; end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    perform private.notify_admin('centro', 'Nuevo centro: ' || new.name,
      array_remove(array[
        case when new.destination is not null then 'Destino: ' || new.destination end,
        case when new.claims_center_id is not null then 'Reclama una ficha del directorio' end
      ], null),
      'https://divingslot.com/app/#/admin/centers');
  elsif tg_op = 'UPDATE' and new.verification_status = 'pending' and old.verification_status is distinct from 'pending' then
    perform private.notify_admin('verificacion', 'Centro pendiente de verificar: ' || new.name,
      array_remove(array[case when new.destination is not null then 'Destino: ' || new.destination end], null),
      'https://divingslot.com/app/#/admin/centers');
  end if;
  return null;
exception when others then
  raise warning 'notify_center: %', sqlerrm; return null;
end $$;

-- Reserva nueva (en la app o apuntada por el centro)
create or replace function private.notify_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c_name text;
  dep timestamptz;
  who text;
begin
  select c.name, t.departs_at into c_name, dep
    from public.trips t join public.centers c on c.id = t.center_id where t.id = new.trip_id;
  if c_name like 'Demo%' then return null; end if;
  select d.full_name into who from public.divers d where d.id = new.diver_id;
  perform private.notify_admin('reserva',
    'Nueva reserva: ' || new.seats || case when new.seats = 1 then ' plaza en ' else ' plazas en ' end || coalesce(c_name, '?'),
    array_remove(array[
      'Salida: ' || to_char(dep at time zone 'Asia/Manila', 'DD/MM/YYYY HH24:MI'),
      'Buceador: ' || coalesce(who, new.guest_name, '—'),
      'Importe: ₱' || to_char(new.amount_php, 'FM999,999,999'),
      'Origen: ' || new.source::text
    ], null),
    null);
  return null;
exception when others then
  raise warning 'notify_booking: %', sqlerrm; return null;
end $$;

-- Pago online recibido (PayMongo)
create or replace function private.notify_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.provider = 'paymongo' then
    perform private.notify_admin('pago', 'Pago online recibido: ₱' || to_char(new.amount_php, 'FM999,999,999'),
      array['Método: ' || coalesce(new.method, '—'), 'Tipo: ' || coalesce(new.kind, '—')], null);
  end if;
  return null;
exception when others then
  raise warning 'notify_payment: %', sqlerrm; return null;
end $$;

revoke all on function private.notify_new_diver() from public, anon, authenticated;
revoke all on function private.notify_center() from public, anon, authenticated;
revoke all on function private.notify_booking() from public, anon, authenticated;
revoke all on function private.notify_payment() from public, anon, authenticated;

create or replace trigger notify_new_diver after insert on public.divers for each row execute function private.notify_new_diver();
create or replace trigger notify_center after insert or update of verification_status on public.centers for each row execute function private.notify_center();
create or replace trigger notify_booking after insert on public.bookings for each row execute function private.notify_booking();
create or replace trigger notify_payment after update of status on public.payments for each row execute function private.notify_payment();
