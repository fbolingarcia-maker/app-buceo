alter table public.centers
  add column if not exists locality text,
  add column if not exists website text,
  add column if not exists source_url text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists location_precision text not null default 'zona' check (location_precision in ('zona','exacta')),
  add column if not exists listing_status text not null default 'directorio' check (listing_status in ('directorio','invitado','socio','cerrado')),
  add column if not exists notes text;
create unique index if not exists centers_name_area_key on public.centers (lower(name), area);
comment on column public.centers.listing_status is 'directorio = sacado de fuentes públicas, sin contacto; invitado = se le ha contactado; socio = dado de alta y operando en la app; cerrado = ya no opera';
comment on column public.centers.location_precision is 'zona = coordenadas aproximadas de la playa/pueblo; exacta = confirmada con el centro';
-- Los datos del directorio (29 centros de Panglao) se cargaron aparte en la base de datos.
