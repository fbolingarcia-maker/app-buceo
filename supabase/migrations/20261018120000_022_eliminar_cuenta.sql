-- 022: el usuario puede eliminar su cuenta (buceador o centro).
-- delete_my_account(true) solo comprueba y devuelve qué se borrará / qué lo impide.
-- delete_my_account(false) borra: datos personales, bitácora, certificaciones, acceso al centro y el usuario de Auth.
-- Las reservas pasadas se conservan para la contabilidad del centro, pero anonimizadas.
-- Los ficheros de Storage (fotos de la bitácora y documentos del centro) los borra la app antes de llamar a esta función.

create or replace function public.delete_my_account(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d divers;
  owned uuid[];
  n_future int := 0;
  n_center_future int := 0;
  blockers text[] := '{}';
begin
  if uid is null then raise exception 'FORBIDDEN: inicia sesión para eliminar tu cuenta'; end if;
  select * into d from divers where user_id = uid;
  select coalesce(array_agg(center_id), '{}') into owned from center_staff where user_id = uid and role = 'owner';

  -- Reservas futuras activas del buceador
  if d.id is not null then
    select count(*) into n_future from bookings b join trips t on t.id = b.trip_id
     where b.diver_id = d.id and t.departs_at > now()
       and (b.status = 'confirmed' or (b.status = 'pending_payment' and coalesce(b.hold_until, now()) > now()));
    if n_future > 0 then
      blockers := blockers || format('Tienes %s reserva(s) futura(s). Cancélalas antes de eliminar la cuenta.', n_future);
    end if;
  end if;

  -- Salidas futuras con reservas en los centros que posee
  if cardinality(owned) > 0 then
    select count(*) into n_center_future from bookings b join trips t on t.id = b.trip_id
     where t.center_id = any(owned) and t.departs_at > now()
       and (b.status = 'confirmed' or (b.status = 'pending_payment' and coalesce(b.hold_until, now()) > now()));
    if n_center_future > 0 then
      blockers := blockers || format('Tu centro tiene %s reserva(s) en salidas futuras. Cancélalas o avisa a los buceadores antes de eliminar la cuenta.', n_center_future);
    end if;
  end if;

  if p_dry_run or cardinality(blockers) > 0 then
    return jsonb_build_object(
      'ok', cardinality(blockers) = 0,
      'blockers', to_jsonb(blockers),
      'centers', to_jsonb(owned),
      'dive_logs', (select count(*) from dive_logs where diver_id = d.id),
      'bookings_kept', (select count(*) from bookings where diver_id = d.id));
  end if;

  -- Centros que posee: se cierran (no se borran: las reservas pasadas siguen siendo del centro)
  if cardinality(owned) > 0 then
    perform set_config('app.trusted', '1', true);
    update trips set status = 'draft' where center_id = any(owned) and status = 'published' and departs_at > now();
    update centers set listing_status = 'cerrado', verification_status = 'suspended',
           review_note = 'Cuenta eliminada por el centro', phone = null, gcash_number = null
     where id = any(owned);
    delete from center_documents where center_id = any(owned);
    delete from center_verifications where center_id = any(owned);
    delete from center_staff where center_id = any(owned);
  end if;
  delete from center_staff where user_id = uid;

  -- Buceador: bitácora y certificaciones fuera; si tiene reservas, se anonimiza en vez de borrarse
  if d.id is not null then
    delete from dive_logs where diver_id = d.id;          -- dive_log_photos en cascada
    delete from certifications where diver_id = d.id;
    if exists (select 1 from bookings where diver_id = d.id) then
      update divers set user_id = null, full_name = 'Cuenta eliminada', email = null, avatar_url = null, bio = null,
             country = null, languages = '{}', logged_dives = null, seeks_buddy = false, show_on_trips = false
       where id = d.id;
    else
      delete from divers where id = d.id;
    end if;
  end if;

  delete from platform_admins where user_id = uid;
  delete from auth.users where id = uid;
  return jsonb_build_object('ok', true, 'deleted', true);
end $$;
revoke execute on function public.delete_my_account(boolean) from public, anon;
grant execute on function public.delete_my_account(boolean) to authenticated;
