# Páginas de destinos para buscadores

La app usa rutas con `#`, que Google no indexa bien. Por eso cada destino tiene también una página estática:

- Inglés: `/dive/` y `/dive/<destino>` (fichero `public/dive/<destino>.html`).
- Español: `/es/buceo/` y `/es/buceo/<destino>` (fichero `public/es/buceo/<destino>.html`).

Cada página incluye los puntos de buceo, los centros del directorio, los destinos cercanos y el botón a las salidas de la app (`/app/#/d/<destino>`). Las páginas están en `public/` y se publican tal cual, sin JavaScript. Llevan CSP propia, `canonical`, `hreflang` y JSON-LD (`TouristDestination` y `BreadcrumbList`). Están enlazadas desde el pie de la landing y desde `public/sitemap.xml`.

## Actualizar

Hay que actualizarlas cuando cambien los destinos, los puntos o el directorio de centros:

1. En Supabase (SQL Editor o `execute_sql`), ejecuta esta consulta. Solo lee datos públicos:

   ```sql
   select jsonb_build_object(
    'destinations', (select jsonb_agg(jsonb_build_object('name',name,'province',province,'island_group',island_group,'lat',lat,'lng',lng) order by island_group, name) from public.destinations),
    'sites', (select jsonb_agg(jsonb_build_object('name',name,'area',area,'min',min_depth_m,'max',max_depth_m,'level',recommended_min,'fee',sanctuary_fee_php,'hl',highlight,'hl_es',highlight_es) order by area, name) from public.dive_sites),
    'centers', (select jsonb_agg(jsonb_build_object('id',id,'name',name,'dest',destination,'locality',locality,'socio',listing_status='socio') order by destination, name) from public.centers
                where listing_status <> 'cerrado' and name not like 'Demo%' and (listing_status <> 'socio' or verification_status = 'verified'))
   ) as data
   ```

2. Guarda el valor de `data` en `tools/seo/datos.json`.
3. Ejecuta `node tools/seo/gen-destinos.mjs`. Regenera `public/dive/`, `public/es/buceo/` y `public/sitemap.xml`.

Si cambia `EXTRA_AREAS` en `src/lib/places.js`, cópialo también en `gen-destinos.mjs`.
