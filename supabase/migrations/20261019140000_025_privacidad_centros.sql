-- 025: oculta los datos privados de los centros en las lecturas públicas de la tabla centers.
-- APLICAR SOLO DESPUÉS de publicar el frontend que usa center_private() (commit «Seguridad: …»).
-- Si se aplica antes, la versión antigua de la app (que pide centers(*)) deja de cargar el centro.
-- gcash_number, review_note y notes solo se leen con center_private() (personal del centro y administradores).
-- OJO: si añades columnas nuevas a centers, añádelas también a este grant o nadie podrá leerlas.

revoke select on public.centers from anon, authenticated;
grant select (
  id, name, area, phone, default_divers_per_guide, created_at, locality, website, source_url, lat, lng,
  location_precision, listing_status, destination, province, languages, course_languages,
  verification_status, claims_center_id, verified_at, agencies, agency_detail, directory_check, checked_at
) on public.centers to anon, authenticated;
