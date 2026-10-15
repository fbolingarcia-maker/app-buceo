-- 008 · Pagos: señal mínima del 50 %, tarjeta / GCash (PayMongo) y efectivo en el centro

-- Configuración general de la app (lectura pública)
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
create policy app_config_read on public.app_config for select using (true);
-- 'demo' = botón de pago simulado; 'paymongo' = cobro real con tarjeta / GCash
insert into public.app_config (key, value) values ('payments_mode', 'demo'), ('deposit_pct', '50')
on conflict (key) do nothing;

create or replace function public.config(p_key text) returns text
language sql stable set search_path = public as $$
  select value from app_config where key = p_key
$$;

-- Reservas: lo pagado, la señal y hasta cuándo se retiene la plaza
alter table public.bookings
  add column if not exists paid_php        integer not null default 0 check (paid_php >= 0),
  add column if not exists deposit_php     integer not null default 0 check (deposit_php >= 0),
  add column if not exists hold_until      timestamptz,
  add column if not exists balance_paid_at timestamptz;

-- Pagos (cada cobro: señal, total, resto; por tarjeta, GCash, efectivo o demo)
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings(id),
  kind         text not null check (kind in ('deposit', 'full', 'balance')),
  method       text not null check (method in ('card', 'gcash', 'cash', 'demo')),
  amount_php   integer not null check (amount_php > 0),
  status       text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired')),
  provider     text not null default 'paymongo' check (provider in ('paymongo', 'cash', 'demo')),
  provider_ref text unique,
  checkout_url text,
  recorded_by  uuid,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index if not exists idx_payments_booking on public.payments (booking_id);
alter table public.payments enable row level security;
create policy payments_diver on public.payments for select
  using (exists (select 1 from bookings b where b.id = booking_id and b.diver_id = my_diver_id()));
create policy payments_center on public.payments for select
  using (exists (select 1 from bookings b where b.id = booking_id and is_staff(trip_center(b.trip_id))));

-- La señal se calcula al crear la reserva por la app
create or replace function public.bookings_set_deposit() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.source = 'app' then
    new.deposit_php := ceil(new.amount_php * coalesce(config('deposit_pct'), '50')::numeric / 100);
  end if;
  return new;
end $$;
create or replace trigger bookings_set_deposit before insert on public.bookings
  for each row execute function public.bookings_set_deposit();

-- Una reserva sin pagar retiene la plaza 15 min (o hasta hold_until si hay un pago en curso)
create or replace function public.holds_seat(b bookings) returns boolean
language sql stable set search_path = public as $$
  select b.status = 'confirmed'
      or (b.status = 'pending_payment'
          and greatest(b.created_at + make_interval(mins => app_setting('hold_minutes')),
                       coalesce(b.hold_until, '-infinity'::timestamptz)) > now())
$$;

-- Registrar un cobro como pagado y actualizar la reserva (solo backend / funciones internas)
create or replace function public.settle_payment(p_payment uuid) returns bookings
language plpgsql security definer set search_path = public as $$
declare p payments; b bookings;
begin
  select * into p from payments where id = p_payment for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into b from bookings where id = p.booking_id for update;
  if p.status = 'paid' then return b; end if;

  update payments set status = 'paid', paid_at = now() where id = p.id;

  if b.status in ('cancelled_by_diver', 'cancelled_by_center') then
    -- Pago llegado tras cancelar: se devuelve íntegro
    update bookings set paid_php = paid_php + p.amount_php, refund_php = refund_php + p.amount_php
     where id = b.id returning * into b;
    return b;
  end if;

  update bookings set
    paid_php = paid_php + p.amount_php,
    status = case when status = 'pending_payment' and paid_php + p.amount_php >= deposit_php
                  then 'confirmed'::booking_status else status end,
    paid_at = coalesce(paid_at, case when paid_php + p.amount_php >= deposit_php then now() end),
    balance_paid_at = case when paid_php + p.amount_php >= amount_php then now() else balance_paid_at end
  where id = b.id
  returning * into b;
  return b;
end $$;
revoke execute on function public.settle_payment(uuid) from public, anon, authenticated;

-- Importe que corresponde cobrar según el tipo de pago
create or replace function public.payment_amount(b bookings, p_kind text) returns integer
language plpgsql stable set search_path = public as $$
begin
  if p_kind = 'deposit' then
    if b.status <> 'pending_payment' then raise exception 'BAD_STATE: la señal ya está pagada'; end if;
    return greatest(b.deposit_php - b.paid_php, 0);
  elsif p_kind = 'full' then
    if b.status <> 'pending_payment' then raise exception 'BAD_STATE: usa «pagar el resto»'; end if;
    return greatest(b.amount_php - b.paid_php, 0);
  elsif p_kind = 'balance' then
    if b.status <> 'confirmed' then raise exception 'BAD_STATE: la reserva no está confirmada'; end if;
    return greatest(b.amount_php - b.paid_php, 0);
  end if;
  raise exception 'BAD_KIND: tipo de pago no válido';
end $$;

-- La versión antigua (sin tipo de pago) queda anulada
create or replace function public.confirm_payment_demo(p_booking uuid) returns bookings
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'OUTDATED: actualiza la app para pagar';
end $$;

-- Pago simulado (solo con payments_mode = 'demo')
create or replace function public.confirm_payment_demo(p_booking uuid, p_kind text) returns bookings
language plpgsql security definer set search_path = public as $$
declare b bookings; amt integer; pid uuid;
begin
  if config('payments_mode') <> 'demo' then raise exception 'FORBIDDEN: el modo demo está desactivado'; end if;
  select * into b from bookings where id = p_booking for update;
  if not found or b.diver_id is distinct from my_diver_id() then raise exception 'NOT_FOUND'; end if;
  if b.status = 'pending_payment' and not holds_seat(b) then raise exception 'HOLD_EXPIRED: la reserva ha caducado'; end if;
  amt := payment_amount(b, p_kind);
  if amt <= 0 then raise exception 'BAD_STATE: no hay nada pendiente de pago'; end if;
  insert into payments (booking_id, kind, method, amount_php, provider)
  values (b.id, p_kind, 'demo', amt, 'demo') returning id into pid;
  return settle_payment(pid);
end $$;
revoke execute on function public.confirm_payment_demo(uuid, text) from public, anon;
grant execute on function public.confirm_payment_demo(uuid, text) to authenticated;

-- El centro cobra el resto en efectivo
create or replace function public.record_cash_payment(p_booking uuid, p_amount integer default null) returns bookings
language plpgsql security definer set search_path = public as $$
declare b bookings; amt integer; pid uuid;
begin
  select * into b from bookings where id = p_booking for update;
  if not found or not is_staff(trip_center(b.trip_id)) then raise exception 'FORBIDDEN'; end if;
  if b.status not in ('pending_payment', 'confirmed') then raise exception 'BAD_STATE: la reserva no está activa'; end if;
  amt := coalesce(p_amount, b.amount_php - b.paid_php);
  if amt <= 0 or amt > b.amount_php - b.paid_php then raise exception 'BAD_AMOUNT: importe no válido'; end if;
  insert into payments (booking_id, kind, method, amount_php, provider, recorded_by)
  values (b.id, case when b.status = 'confirmed' then 'balance' else 'full' end, 'cash', amt, 'cash', auth.uid())
  returning id into pid;
  return settle_payment(pid);
end $$;
revoke execute on function public.record_cash_payment(uuid, integer) from public, anon;
grant execute on function public.record_cash_payment(uuid, integer) to authenticated;

-- Reembolsos según lo realmente pagado
create or replace function public.cancel_my_booking(p_booking uuid) returns bookings
language plpgsql security definer set search_path = public as $$
declare b bookings; t trips; full_refund boolean;
begin
  select * into b from bookings where id = p_booking for update;
  if not found or b.diver_id is distinct from my_diver_id() then raise exception 'NOT_FOUND'; end if;
  if b.status not in ('pending_payment', 'confirmed') then raise exception 'BAD_STATE: la reserva ya no está activa'; end if;
  select * into t from trips where id = b.trip_id;
  if t.departs_at <= now() then raise exception 'STARTED: la salida ya ha empezado'; end if;

  full_refund := b.status = 'pending_payment'
              or t.departs_at - now() >= make_interval(hours => app_setting('full_refund_hours'));
  update bookings set
    status = 'cancelled_by_diver',
    -- ≥24 h: se devuelve todo lo pagado. <24 h: el centro se queda el 50 % del total.
    refund_php = case when full_refund then paid_php
                      else greatest(0, paid_php - round(amount_php * 0.5))::integer end,
    commission_php = case when full_refund then 0 else commission_php end,
    cancelled_at = now()
  where id = b.id
  returning * into b;
  return b;
end $$;

create or replace function public.cancel_trip_weather(p_trip uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare t trips; n integer;
begin
  select * into t from trips where id = p_trip for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not is_staff(t.center_id) then raise exception 'FORBIDDEN'; end if;
  if t.status <> 'published' then raise exception 'BAD_STATE'; end if;
  update trips set status = 'cancelled_weather' where id = t.id;  -- el trigger cancela y reembolsa lo pagado
  select count(*) into n from bookings where trip_id = t.id and status = 'cancelled_by_center';
  return n;
end $$;

create or replace function public.trips_on_weather_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled_weather' and old.status is distinct from 'cancelled_weather' then
    update bookings
       set status = 'cancelled_by_center',
           refund_php = paid_php,
           commission_php = 0,
           cancelled_at = now()
     where trip_id = new.id and status in ('pending_payment', 'confirmed');
  end if;
  return new;
end $$;
revoke execute on function public.trips_on_weather_cancel() from public, anon, authenticated;

-- Inicio de un pago online (lo llama solo la Edge Function crear-pago, con service_role)
create or replace function public.start_online_payment(p_booking uuid, p_kind text, p_method text, p_user uuid) returns payments
language plpgsql security definer set search_path = public as $$
declare b bookings; amt integer; p payments;
begin
  select bk.* into b from bookings bk join divers d on d.id = bk.diver_id
   where bk.id = p_booking and d.user_id = p_user for update of bk;
  if not found then raise exception 'NOT_FOUND: reserva no encontrada'; end if;
  if p_method not in ('card', 'gcash') then raise exception 'BAD_METHOD: método de pago no válido'; end if;
  if b.status = 'pending_payment' and not holds_seat(b) then
    raise exception 'HOLD_EXPIRED: la reserva ha caducado, vuelve a reservar'; end if;
  amt := payment_amount(b, p_kind);
  if amt < 100 then raise exception 'BAD_AMOUNT: el importe mínimo para pagar online es ₱100'; end if;
  if b.status = 'pending_payment' then
    update bookings set hold_until = now() + interval '30 minutes' where id = b.id;
  end if;
  insert into payments (booking_id, kind, method, amount_php) values (b.id, p_kind, p_method, amt) returning * into p;
  return p;
end $$;
revoke execute on function public.start_online_payment(uuid, text, text, uuid) from public, anon, authenticated;
