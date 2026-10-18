-- 021: rendimiento (advisors de Supabase): índices en claves foráneas y auth.uid() evaluado una sola vez por consulta
create index if not exists idx_center_documents_center on public.center_documents(center_id);
create index if not exists idx_centers_claims on public.centers(claims_center_id) where claims_center_id is not null;
create index if not exists idx_centers_destination on public.centers(destination);
create index if not exists idx_certifications_verified_by on public.certifications(verified_by) where verified_by is not null;
create index if not exists idx_dive_logs_booking on public.dive_logs(booking_id) where booking_id is not null;
create index if not exists idx_dive_logs_center on public.dive_logs(center_id) where center_id is not null;
create index if not exists idx_dive_logs_site on public.dive_logs(site_id) where site_id is not null;
create index if not exists idx_trip_sites_site on public.trip_sites(site_id);
create index if not exists idx_trips_boat on public.trips(boat_id);

alter policy staff_self on public.center_staff using (user_id = (select auth.uid()));
alter policy divers_self on public.divers using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy admins_self on public.platform_admins using (user_id = (select auth.uid()));
