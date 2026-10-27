-- 031: perfil de buceo completo, cuestionario médico digital y aviso de reserva al centro.
--
-- Perfil (lo ve el centro en el manifiesto de las salidas en las que reservaste, por staff_sees_diver):
--   tallas de traje, chaleco (BCD) y aletas, fecha de la última inmersión y si tiene nitrox.
-- Cuestionario médico: solo el resultado, no las respuestas (dato de salud mínimo):
--   medical_done_at = día en que el buceador completó el Diver Medical Participant Questionnaire (vale 12 meses)
--   medical_result  = 'all_no' (todas NO) | 'physician_ok' (alguna SÍ, con autorización firmada por un médico)
-- Aviso de reserva: cada reserva hecha en la app avisa por email al equipo del centro (además del administrador),
--   por la misma vía que los avisos de la migración 030 (pg_net → POST /api/notify → email desde el Worker).

alter table public.divers
  add column if not exists wetsuit_size text check (wetsuit_size in ('XS', 'S', 'M', 'L', 'XL', 'XXL')),
  add column if not exists bcd_size text check (bcd_size in ('XS', 'S', 'M', 'L', 'XL', 'XXL')),
  add column if not exists fin_size text check (length(fin_size) <= 12),
  add column if not exists last_dive_date date check (last_dive_date <= current_date + 1),
  add column if not exists nitrox boolean not null default false,
  add column if not exists medical_done_at date check (medical_done_at <= current_date + 1),
  add column if not exists medical_result text check (medical_result in ('all_no', 'physician_ok'));

-- Aviso con destinatarios: el Worker manda el email a p_to (máx. 3, el equipo del centro) y otro al administrador
create or replace function private.notify_send(p_kind text, p_title text, p_lines text[], p_url text, p_to text[])
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
    body := jsonb_build_object('kind', p_kind, 'title', p_title, 'lines', to_jsonb(coalesce(p_lines, '{}'::text[])),
                               'url', p_url, 'to', to_jsonb(coalesce(p_to, '{}'::text[]))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Notify-Key', k),
    timeout_milliseconds := 5000);
exception when others then
  raise warning 'notify_send: %', sqlerrm;
end $$;
revoke all on function private.notify_send(text, text, text[], text, text[]) from public, anon, authenticated;

-- Reserva nueva: al administrador siempre; al centro, solo las que llegan por la app (las manuales las apunta él)
create or replace function private.notify_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c_id uuid;
  c_name text;
  dep timestamptz;
  who text;
  staff text[];
begin
  select c.id, c.name, t.departs_at into c_id, c_name, dep
    from public.trips t join public.centers c on c.id = t.center_id where t.id = new.trip_id;
  if c_name like 'Demo%' then return null; end if;
  select d.full_name into who from public.divers d where d.id = new.diver_id;
  if new.source::text = 'app' then
    select array_agg(u.email order by s.role desc) into staff
      from public.center_staff s join auth.users u on u.id = s.user_id
      where s.center_id = c_id and u.email is not null;
  end if;
  perform private.notify_send('reserva',
    'Nueva reserva: ' || new.seats || case when new.seats = 1 then ' plaza en ' else ' plazas en ' end || coalesce(c_name, '?'),
    array_remove(array[
      'Salida: ' || to_char(dep at time zone 'Asia/Manila', 'DD/MM/YYYY HH24:MI'),
      'Buceador: ' || coalesce(who, new.guest_name, '—'),
      'Importe: ₱' || to_char(new.amount_php, 'FM999,999,999'),
      'Origen: ' || new.source::text
    ], null),
    'https://divingslot.com/app/#/centro/agenda?dia=' || to_char(dep at time zone 'Asia/Manila', 'YYYY-MM-DD'),
    staff[1:3]);
  return null;
exception when others then
  raise warning 'notify_booking: %', sqlerrm; return null;
end $$;
revoke all on function private.notify_booking() from public, anon, authenticated;
