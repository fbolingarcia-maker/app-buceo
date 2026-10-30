# Cambio de Supabase a Cloudflare: guía paso a paso

Todo el código está listo y probado: la API en el Worker (`worker/`), el acceso con Google, los avisos al administrador y la copia de datos. Ahora mismo la app sigue usando Supabase. Este documento dice qué falta y quién lo hace.

**Resumen:** a Fernando le queda muy poco, todo en los paneles (pasos 1 a 3). El día del cambio son dos órdenes, y se pueden deshacer.

Hecho por Claude el 30 oct 2026, para ahorrar pasos:

- **Google Cloud:** ya tiene las URI de redirección `https://divingslot.com/api/auth/callback/google` y `https://diveslot.divingslot.workers.dev/api/auth/callback/google`. La de Supabase sigue puesta.
- **`GOOGLE_CLIENT_ID`:** ya va en `wrangler.jsonc` (es público). Es la cuenta de Google `authuser=1` del navegador, proyecto «My First Project», cliente «Cliente web 1».
- **`AUTH_SECRET`:** ya no hay que crearlo. El Worker lo genera solo la primera vez y lo guarda en D1, en la tabla `app_secrets` (`worker/lib/secrets.js`). Una vez en marcha, no lo cambies: la gente tendría que volver a activar los dos pasos.
- **`NOTIFY_KEY`:** ya no hace falta. Los avisos y la copia de datos llegan desde Supabase por una cola (migración 035) sin clave compartida. Desde el 30 oct, los avisos de altas, centros y reservas ya se guardan en el Worker y aparecen en el panel de administración; los emails, cuando haya email (paso 2).

## Antes del cambio (se puede hacer cualquier día; la web sigue igual)

### 1. Plan Workers Paid (Fernando, 2 min)

Cloudflare → **Workers & Pages → Plans** → Workers Paid (5 USD al mes más uso). La tarjeta ya está guardada.

Hace falta por dos motivos:

- Cada contraseña cuesta unos 50 ms de CPU y la importación de datos, algo más. El plan gratuito corta a los 10 ms.
- Habilita **Email Sending**, que es el email sin contraseñas del paso 2.

### 2. Email (Fernando o Claude, 5 min)

**Opción recomendada, sin claves:** Cloudflare Email Service. Necesita Workers Paid.

1. Cloudflare → **Compute → Email Service → Email Sending → Onboard Domain** → `divingslot.com`. Añade solo los registros DNS (SPF, DKIM y DMARC). Claude no puede hacer este paso porque no tiene permiso para tocar DNS.
2. Claude quita el comentario de `"send_email": [{ "name": "EMAIL" }]` en `wrangler.jsonc` y lo sube.

Con eso salen los emails de confirmación, «nueva contraseña», códigos y avisos. Los avisos al administrador llegan al primer administrador de la plataforma o a `NOTIFY_TO`, si se pone.

**Alternativa:** Gmail. Pon los secretos `SMTP_HOST` = `smtp.gmail.com`, `SMTP_USER` = `fbolingarcia@gmail.com` y `SMTP_PASS` = la contraseña de aplicación de 16 letras (la misma del SMTP de Supabase, `docs/EMAIL.md`). También sirve `RESEND_API_KEY`.

### 3. Google: secreto nuevo (Fernando, 5 min)

El secreto del cliente se pegó en un chat, así que hay que rotarlo. Ve a [console.cloud.google.com](https://console.cloud.google.com/auth/clients?authuser=1) → «Cliente web 1» → **Añadir secreto** y copia el nuevo.

- Ponlo en **Supabase**: Authentication → Sign In / Providers → Google → Client Secret.
- Ponlo en **Cloudflare**: Workers & Pages → diveslot → Settings → Variables and Secrets → Add → tipo **Secret**, nombre `GOOGLE_CLIENT_SECRET`.
- Desactiva el secreto antiguo en Google.

Opcional: `PAYMONGO_SECRET_KEY` y `PAYMONGO_WEBHOOK_SECRET` como secretos, solo para cobrar con tarjeta o GCash de verdad.

### 4. Comprobar (Fernando o Claude, 1 min)

Abre **https://divingslot.com/api/health?check=1**:

- En `checks`: `auth_secret` dice `automatico` y `google` dice `true`. `email` dice `cloudflare`, `smtp` o `resend`. `notify` dice `cola-supabase`.
- En `missing` solo deben quedar cosas marcadas «(Opcional)» y, antes de importar, «Esquema de D1 antiguo» y «Datos: aún no se han copiado». Esas dos se arreglan solas en el paso 5.

### 5. Ensayo de la copia de datos (Claude o Fernando, 2 min, opcional pero recomendable)

En Supabase → **SQL Editor**:

```sql
select private.export_to_d1('x', p_dry := true);      -- solo cuenta: cuántas filas y trozos (no manda nada)
select private.export_to_d1('ensayo-1', false);       -- copia de prueba, SIN contraseñas
```

Después abre `https://divingslot.com/api/import/status?run=ensayo-1`. Debe decir `"status": "done"` y mostrar las filas por tabla.

Qué hace la copia:

- La función deja los datos en la cola de Supabase, por trozos. El Worker los recoge sin clave (migraciones 035 y 036).
- El Worker comprueba cada sentencia.
- Al final, rehace las tablas de D1 con el esquema actual y lo mete todo en una sola transacción: o entra todo o no cambia nada.

Se puede repetir las veces que haga falta, con otro nombre cada vez (`ensayo-2`…). La web no se entera.

## El día del cambio (5 min)

1. **Copiar los datos, con las contraseñas** (SQL Editor de Supabase):

   ```sql
   select private.export_to_d1('cambio-1');
   ```

   Comprueba `https://divingslot.com/api/import/status?run=cambio-1` → `done`. Desde ese momento, lo que se haga en Supabase ya no pasa a Cloudflare, así que conviene hacer el paso 2 justo después.

2. **Pasar la app a Cloudflare.** En `.env.production` (en GitHub), cambia `VITE_BACKEND=supabase` por `VITE_BACKEND=cloudflare` y guarda (commit en `main`). Cloudflare recompila y publica solo, en unos 2 minutos. Claude puede hacerlo si se lo pides.

3. **Probar:**
   - Entra con email y tu contraseña de siempre.
   - Entra con Google.
   - Abre el panel de administración, reserva una salida demo y mira la bitácora.
   - Comprueba que llega el email de aviso.

### Qué notan los usuarios

- Tienen que volver a entrar, porque las sesiones no se copian. La contraseña es la misma.
- Quien tuviera la verificación en dos pasos tiene que activarla otra vez desde su perfil (Supabase no deja exportar esos secretos).
- Quien entraba con Google sigue entrando con Google y llega a su misma cuenta.

### Si algo va mal

Vuelve a poner `VITE_BACKEND=supabase` en `.env.production`. En 2 minutos la app vuelve a Supabase tal y como estaba. Lo que se hubiera creado en Cloudflare entretanto no pasa a Supabase.

La importación se cierra sola cuando la app ya está en uso en Cloudflare: en cuanto tres personas que no son administradoras han entrado. Así nadie puede pisar los datos de la app en marcha.

## Después (cuando todo vaya bien un par de semanas)

- **Google:** quita la URI de redirección de Supabase.
- **R2 (opcional, para fotos de la bitácora y documentos de verificación):**
  1. Activa R2 en Cloudflare.
  2. Crea los buckets `divingslot-dive-photos` y `divingslot-center-docs`.
  3. Claude descomenta `r2_buckets` en `wrangler.jsonc`.

  Sin R2, la app funciona, pero no deja subir ficheros. Hoy no hay ningún fichero en Supabase Storage, así que no hay nada que copiar.
- **Supabase:** se puede pausar el proyecto (no borrarlo) como copia de seguridad.

## Para Claude (detalles técnicos)

- **Exportación:**
  - `worker/migrate/gen-export.mjs` genera la migración `supabase/migrations/…_036_exportar_a_d1_sin_clave.sql` y las consultas sueltas `export-supabase.sql` y `export-ensayo.sql`.
  - La 036 se aplicó en Supabase el 30-10-2026; el md5 de `prosrc` es `a5b1ebc4456b7773c82375b04a32b3d1`.
  - La 034 es la primera versión, con clave, y ya está sustituida.
  - Si cambia `worker/schema.js`: regenera, aplica la migración otra vez y ejecuta `bash worker/migrate/ensayo-local.sh` (Postgres 16 local con datos inventados) y `node --no-warnings worker/test/import.mjs`.
- **Importación:** `worker/import.js`.
  - Lista blanca de sentencias.
  - Trozos guardados en `import_chunks`.
  - Ejecución única con `import_runs`.
  - `reset` borra y crea el esquema (menos `visits`, `notify_log` e `import_*`).
  - Cierre en `import_runs` con `run = '#locked'`.
- **Cola sin clave:** migración 035 (`private.outbox`, `private.outbox_push`, RPC pública `outbox_claim`) y `worker/lib/outbox.js`. Si el Worker tiene `NOTIFY_KEY`, también acepta la cabecera `X-Notify-Key` como antes.
- **AUTH_SECRET automático:** `worker/lib/secrets.js` (tabla `app_secrets` de D1, que el reset de la importación no borra).
- **Pruebas sin claves:** `node --no-warnings worker/test/sin-claves.mjs`.
- **Comprobación:** `worker/health.js`.
- **Acceso con Google en el Worker:** `worker/google.js` (PKCE, `state` firmado en la cookie `__Host-ds_oauth`, unión por `google_sub` o por email verificado).
