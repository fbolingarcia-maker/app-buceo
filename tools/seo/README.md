# Páginas de destinos para buscadores

La app usa rutas con `#`, que Google no indexa bien. Por eso cada destino tiene también una página estática:

- Inglés: `/dive/` y `/dive/<destino>` (fichero `public/dive/<destino>.html`).
- Español: `/es/buceo/` y `/es/buceo/<destino>` (fichero `public/es/buceo/<destino>.html`).

Cada página incluye los puntos de buceo, los centros del directorio, los destinos cercanos y el botón a las salidas de la app (`/app/#/d/<destino>`). Las páginas están en `public/` y se publican tal cual, sin JavaScript. Llevan CSP propia, `canonical`, `hreflang` y JSON-LD (`TouristDestination` y `BreadcrumbList`). Están enlazadas desde el pie de la landing y desde `public/sitemap.xml`.

## Actualizar

Hay que actualizarlas cuando cambien los destinos, los puntos o el directorio de centros. Los datos salen de D1 (Cloudflare), la base de datos de la app desde el 3 nov 2026:

1. Saca los datos públicos con `tools/seo/datos.sql` (solo lee) y guárdalos en `tools/seo/datos.json`:

   ```bash
   npx wrangler d1 execute diveslot --remote --json --file tools/seo/datos.sql | node tools/seo/from-d1.mjs
   ```

   Sin wrangler: ejecuta el contenido de `datos.sql` en el panel de Cloudflare (D1 → diveslot → Console) o con la herramienta `d1_database_query`, copia el valor de la columna `data` y pásalo a `node tools/seo/from-d1.mjs` por la entrada estándar.
2. Ejecuta `node tools/seo/gen-destinos.mjs`. Regenera `public/dive/`, `public/es/buceo/` y `public/sitemap.xml`.

Si cambia `EXTRA_AREAS` en `src/lib/places.js`, cópialo también en `gen-destinos.mjs`.

(Antes del 3 nov 2026 los datos salían de Supabase con una consulta equivalente en Postgres.)
