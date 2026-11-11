# Copias de seguridad de D1

- **Qué:** cada semana (domingo 19:41 UTC = lunes 3:41 en Manila) el Worker copia todas las tablas de D1 al bucket R2
  `divingslot-backups` (`worker/backup.js`, binding `BACKUPS`). Carpeta `<AAAA-MM-DD>/` con `schema.sql`,
  `<tabla>.jsonl.gz` y `manifest.json` (filas por tabla). Se guardan 12 semanas. No se copian `sessions`,
  `rate_limits` ni `reauth_codes`. Incluye `app_secrets` (AUTH_SECRET y claves VAPID): el bucket es privado.
- **Si falla:** el Worker manda el aviso de error al administrador (como el resto de tareas programadas).
- **Además:** D1 tiene Time Travel (volver a cualquier minuto de los últimos 30 días) desde el panel de Cloudflare o
  con `npx wrangler d1 time-travel restore diveslot --timestamp=<fecha>`. Es lo más rápido para un error reciente.

## Restaurar una copia

1. Descarga la carpeta del día desde el panel de Cloudflare (R2 → `divingslot-backups`) o con
   `npx wrangler r2 object get divingslot-backups/<día>/<fichero> --file <fichero>` para cada fichero del manifiesto.
2. `node tools/backup/restore.mjs <carpeta> > restore.sql`
3. Prueba primero en una base vacía: `npx wrangler d1 create diveslot-prueba` y
   `npx wrangler d1 execute diveslot-prueba --remote --file restore.sql`. Compara las filas con `manifest.json`.
4. Para recuperar producción, la base restaurada se pone en `wrangler.jsonc` (`database_id`) o se copian las tablas
   que hagan falta. Nunca sobre la base en uso sin una copia previa.

La prueba automática (`node --no-warnings worker/test/backup.mjs`) hace una copia de una base de prueba, la restaura en
una base vacía con este script y comprueba que las filas coinciden.
