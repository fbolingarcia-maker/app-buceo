# Backend propio en Cloudflare (Worker + D1 + R2)

Sustituye a Supabase sin cambiar las pantallas. La app habla con el backend a través de `src/lib/supabase.js`, que elige el cliente según la variable de compilación `VITE_BACKEND`:

- **Sin variable:** sigue usando Supabase, como ahora.
- **Con `VITE_BACKEND=cloudflare`:** usa `src/lib/cf-client.js`, con la misma forma que supabase-js. Las peticiones van a `/api/*` en el mismo Worker que sirve la app.

## Qué hay en `worker/`

| Fichero | Qué hace | En Supabase era |
|---|---|---|
| `schema.js` → `schema.sql` | Tablas, restricciones, índices y la vista `published_trips`. `node worker/gen-schema.mjs` regenera el SQL. | Migraciones 001–028 |
| `auth.js` | Alta con email de confirmación, entrada, salida y nueva contraseña. Dos pasos (TOTP con QR). Sesión en cookie httpOnly `__Host-ds_session`. Límite de intentos. | Supabase Auth |
| `policies.js` + `rest.js` | Lecturas y escrituras de tablas con el subconjunto de PostgREST que usa la app (tablas incrustadas, `!inner`, filtros, `.or()`, orden, `count`, `single`). Cada tabla tiene su política y se deniega por defecto. | PostgREST + RLS |
| `rpc.js`, `dashboard.js` | Las 25 funciones de negocio: reservas, cobros, cancelaciones, centros, verificación, administración y borrar cuenta. Mismas reglas y mismos errores `CODIGO: mensaje`. | Funciones `SECURITY DEFINER` y triggers |
| `storage.js` | Fotos y documentos en R2, con comprobación del tipo real del fichero, un máximo de 10 MB y enlaces firmados que caducan. | Storage |
| `payments.js` | Pagos de PayMongo (`/api/functions/crear-pago`) y su webhook (`/api/webhooks/paymongo`). | Edge Functions |
| `email.js` | Emails bilingües por Resend o por SMTP (Gmail). | SMTP de Auth |
| `cron.js` | Limpieza cada hora. | pg_cron |

### Decisiones

- **Plazas sin carreras.** D1 no tiene `SELECT … FOR UPDATE`. Cada reserva se hace con una sola sentencia que comprueba las plazas libres y crea la reserva a la vez (`INSERT … SELECT … WHERE plazas_libres >= pedidas`). Cada cobro va en un batch transaccional con condiciones, así que aunque llegue dos veces se aplica una sola. Hay una prueba con 20 reservas a la vez en 6 plazas.
- **Dos pasos.** Funciona igual que `mfa_ok()`. Si la cuenta tiene el segundo paso activado y la sesión aún no ha metido el código, no se puede leer ni cambiar nada, ni siquiera los datos públicos.
- **Contraseñas.** Las nuevas se guardan con PBKDF2-SHA256 (100 000 iteraciones, el máximo de Workers). Los hash bcrypt que vienen de Supabase se comprueban tal cual y se convierten a PBKDF2 la primera vez que el usuario entra, así que nadie tiene que cambiar la contraseña.
- **CSRF.** Toda petición que cambia datos lleva la cabecera `X-DivingSlot: 1` y un `Origin` propio. La cookie es `SameSite=Lax` y no hay CORS.
- **Sin dependencias.** El Worker solo usa WebCrypto y D1, sin Hono ni Drizzle. Se puede probar entero en Node sin red.

## Pruebas (sin red)

```bash
node --no-warnings worker/test/run.mjs   # 114 comprobaciones: aceptación, permisos, concurrencia, 2 pasos, PayMongo, ficheros
node --no-warnings worker/test/e2e.mjs   # la app de verdad (cf-client) contra el Worker, en Chromium, por rol
```

`run.mjs` incluye la prueba de aceptación del documento de migración, de principio a fin:

1. El centro se registra, sube sus documentos y el administrador lo aprueba.
2. El centro crea un barco y una salida.
3. A reserva 2 plazas y paga la señal. B reserva y deja caducar la retención, así que la plaza se libera.
4. El centro añade una reserva de WhatsApp, hace el check-in y cobra el resto en efectivo.
5. A cancela a menos de 24 h y se queda el 50 %. Una salida se cancela por meteo y se devuelve el 100 %.
6. Las cifras de cobros cuadran y el registro del administrador muestra la aprobación.

## Puesta en marcha

Cada paso dice quién lo hace. Hasta el paso 5, la web sigue funcionando con Supabase.

1. **Base de datos D1 (Claude, hecho).** Las tablas están creadas en la D1 `diveslot`.
2. **Subir el código a `main` (Claude o Fernando).** Despliega la API junto a la app sin cambiar nada visible. Para comprobarlo: `https://divingslot.com/api/health` responde `{"ok":true}`.
3. **Secretos del Worker (Fernando).** Se ponen en el panel de Cloudflare: Workers → diveslot → Settings → Variables and Secrets, con el tipo «Secret».
   - `AUTH_SECRET`: obligatorio. Es una clave aleatoria larga, de 32 caracteres o más. Una forma de generarla: `openssl rand -base64 32`.
   - Para los emails, una de estas dos opciones:
     - `RESEND_API_KEY`, con el dominio divingslot.com verificado en Resend.
     - `SMTP_HOST=smtp.gmail.com`, `SMTP_USER=fbolingarcia@gmail.com` y `SMTP_PASS`, que es la contraseña de aplicación de 16 letras.
   - Avisos de uso al administrador (ya funcionan con Supabase, ver `worker/stats.js`): `NOTIFY_KEY` (la misma clave que hay en Supabase Vault como `divingslot_notify_key`) y, opcional, `NOTIFY_TO` (a quién llegan; si no, a `SMTP_USER`). Necesitan también los secretos de email de arriba. `NOTIFY_DIGEST=off` quita el resumen diario y `NOTIFY_EMAILS=off` los emails sueltos.
   - Para cobrar de verdad: `PAYMONGO_SECRET_KEY` y `PAYMONGO_WEBHOOK_SECRET`. En PayMongo, el webhook apunta a `https://divingslot.com/api/webhooks/paymongo` con el evento `checkout_session.payment.paid`.
4. **R2 (Fernando).** Activa R2 en el panel (pide un método de pago) y crea los buckets `divingslot-dive-photos` y `divingslot-center-docs`. Después, Claude descomenta `r2_buckets` en `wrangler.jsonc`.
5. **Pasar los datos (Claude, justo antes del cambio).** Copia de Supabase a D1: usuarios con sus hash, perfiles, centros, salidas, reservas, pagos, bitácora y documentos. Los ficheros de Storage se copian a R2.
6. **El cambio (Fernando o Claude).** En Workers → diveslot → Settings → Build → Variables, añade `VITE_BACKEND = cloudflare` y vuelve a desplegar. GitHub Pages sigue con Supabase.
7. **Comprobar.** Entra, reserva una salida demo, abre la bitácora y el panel del centro. Si algo falla, quita la variable y vuelve a desplegar: la app vuelve a Supabase al momento.

**Plan de Workers.** Con el plan gratuito (10 ms de CPU por petición), entrar o crear una cuenta puede pasarse del límite, porque cada contraseña cuesta unas decenas de milisegundos con 100 000 iteraciones. Lo seguro es el plan Workers Paid (5 USD al mes). Si se prefiere seguir en el gratuito, se puede bajar el coste con la variable `PBKDF2_ITER`, a cambio de algo de seguridad.

## Autorización (resumen)

| Tabla | Leer | Escribir por `/api/rest` |
|---|---|---|
| destinations, dive_sites, app_config, published_trips | Todos | — |
| boats, trip_sites | Todos | Equipo del centro |
| trips | Publicadas, equipo, admin o quien tiene reserva | Equipo (publicar exige centro verificado) |
| centers | Directorio, verificados, equipo, admin o centros donde reservó el buceador. Nunca `gcash_number`, `notes` ni `review_note` (eso va por `center_private`). | Equipo, sin tocar el estado de verificación |
| center_staff, platform_admins | Uno mismo | — |
| center_verifications, center_documents | Equipo o admin | Equipo |
| divers | Uno mismo, centros donde reservó o admin | Uno mismo |
| certifications | Uno mismo, centros donde reservó o admin | Uno mismo, sin verificarse a sí mismo |
| bookings, payments | Dueño, centro de la salida o admin | Solo con RPC |
| dive_logs | Uno mismo, o el centro si se comparte | Uno mismo |
| dive_log_photos | Uno mismo | Uno mismo |
| admin_audit | Admin | Solo con RPC |
