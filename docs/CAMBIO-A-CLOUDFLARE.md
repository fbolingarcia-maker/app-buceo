# Cambio de Supabase a Cloudflare: guía paso a paso

Todo el código está listo y probado: la API en el Worker (`worker/`), el acceso con Google, los avisos al administrador y la copia de datos. Ahora mismo la app sigue usando Supabase. Este documento dice qué falta y quién lo hace.

**Resumen:** Fernando dedica unos 20 minutos, una sola vez, a poner claves en los paneles (pasos 1 a 4). El día del cambio son dos órdenes, y se pueden deshacer.

## Antes del cambio (se puede hacer cualquier día; la web sigue igual)

### 1. Plan Workers Paid (Fernando, 2 min)

Cloudflare → **Workers & Pages → Plans** → Workers Paid (5 USD/mes).

Hace falta porque cada contraseña cuesta unos 50 ms de CPU y la importación de datos, algo más. El plan gratuito corta a los 10 ms.

### 2. Google Cloud (Fernando, 5 min)

En [console.cloud.google.com](https://console.cloud.google.com) → APIs y servicios → Credenciales → el cliente OAuth «Web» que usa ya Supabase:

1. En **URI de redireccionamiento autorizados**, añade `https://divingslot.com/api/auth/callback/google`. **No quites** la de Supabase (`https://tosgzcpnkpsrrkfqctgy.supabase.co/auth/v1/callback`) hasta que el cambio esté hecho.
2. **Rota el secreto del cliente** (se pegó en un chat): «Añadir secreto», copia el nuevo y, cuando esté puesto en los dos sitios, desactiva el antiguo.
   - Ponlo en **Supabase**: Authentication → Sign In / Providers → Google → Client Secret. Si no lo haces, el acceso con Google deja de funcionar al desactivar el antiguo.
   - Ponlo también en Cloudflare, en el paso 3.

### 3. Secretos del Worker (Fernando, 10 min)

Cloudflare → Workers & Pages → **diveslot → Settings → Variables and Secrets** → «Add», con el tipo **Secret**:

| Nombre | Valor |
|---|---|
| `AUTH_SECRET` | Una clave aleatoria de 32 caracteres o más. Puedes generarla con `openssl rand -base64 32` o con un gestor de contraseñas. |
| `GOOGLE_CLIENT_ID` | El «ID de cliente» de Google, el del paso 2 (termina en `.apps.googleusercontent.com`). |
| `GOOGLE_CLIENT_SECRET` | El secreto nuevo del paso 2. |
| `NOTIFY_KEY` | El mismo valor que el secreto `divingslot_notify_key` de Supabase. Lo ves en Supabase → Project Settings → Vault → `divingslot_notify_key` → «Reveal». También sirve para que lleguen ya los avisos de altas y reservas. |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_USER` | `fbolingarcia@gmail.com` |
| `SMTP_PASS` | La contraseña de aplicación de Google, de 16 letras ([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)). Es la misma que va en el SMTP de Supabase (`docs/EMAIL.md`). |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` | Opcional, solo para cobrar con tarjeta o GCash de verdad. |

En lugar de Gmail, también sirve `RESEND_API_KEY` si el dominio está verificado en Resend.

### 4. Comprobar (Fernando o Claude, 1 min)

Abre **https://divingslot.com/api/health?check=1**:

- En `checks`, todo debe estar en `true`, y `email` debe decir `smtp` o `resend`.
- En `missing` solo deben quedar cosas marcadas «(Opcional)» y, antes de importar, «Esquema de D1 antiguo» y «Datos: aún no se han copiado». Esas dos se arreglan solas en el paso 5.

### 5. Ensayo de la copia de datos (Claude o Fernando, 2 min, opcional pero recomendable)

En Supabase → **SQL Editor**:

```sql
select private.export_to_d1('x', p_dry := true);      -- solo cuenta: cuántas filas y trozos (no manda nada)
select private.export_to_d1('ensayo-1', false);       -- copia de prueba, SIN contraseñas
```

Después abre `https://divingslot.com/api/import/status?run=ensayo-1`. Debe decir `"status": "done"` y mostrar las filas por tabla.

Qué hace la copia:

- La función manda los datos directamente de Supabase al Worker, por trozos, con la clave de los avisos.
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
  - `worker/migrate/gen-export.mjs` genera la migración `supabase/migrations/…_034_exportar_a_d1.sql` (aplicada en Supabase el 28-10-2026; md5 de `prosrc` = `e2614d4a812e0cba65bc859d1330f9a0`) y las consultas sueltas `export-supabase.sql` y `export-ensayo.sql`.
  - Si cambia `worker/schema.js`: regenera, aplica la migración otra vez y ejecuta `bash worker/migrate/ensayo-local.sh` (Postgres 16 local con datos inventados) y `node --no-warnings worker/test/import.mjs`.
- **Importación:** `worker/import.js`.
  - Lista blanca de sentencias.
  - Trozos guardados en `import_chunks`.
  - Ejecución única con `import_runs`.
  - `reset` borra y crea el esquema (menos `visits`, `notify_log` e `import_*`).
  - Cierre en `import_runs` con `run = '#locked'`.
- **Comprobación:** `worker/health.js`.
- **Acceso con Google en el Worker:** `worker/google.js` (PKCE, `state` firmado en la cookie `__Host-ds_oauth`, unión por `google_sub` o por email verificado).
