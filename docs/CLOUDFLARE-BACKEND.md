# Backend propio en Cloudflare (Worker + D1 + R2)

Sustituye a Supabase sin cambiar las pantallas. La app habla con el backend a través de `src/lib/supabase.js`, que elige el cliente según la variable de compilación `VITE_BACKEND`:

- **`VITE_BACKEND=supabase`** (en `.env.production`, como ahora): sigue usando Supabase.
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
| `cron.js` | Limpieza cada hora (y cierre de la importación cuando la app ya está en uso). | pg_cron |
| `google.js` | Acceso con Google (OAuth con PKCE): crea la cuenta o la une por email verificado. | Proveedor Google de Supabase Auth |
| `stats.js` | Visitas, panel de estadísticas y avisos al administrador (altas, centros, verificaciones, reservas y pagos). | Triggers con pg_net (migraciones 030–031) |
| `import.js`, `health.js` | Copia de datos desde Supabase (una vez) y comprobación de la configuración. | — |

### Decisiones

- **Plazas sin carreras.** D1 no tiene `SELECT … FOR UPDATE`. Cada reserva se hace con una sola sentencia que comprueba las plazas libres y crea la reserva a la vez (`INSERT … SELECT … WHERE plazas_libres >= pedidas`). Cada cobro va en un batch transaccional con condiciones, así que aunque llegue dos veces se aplica una sola. Hay una prueba con 20 reservas a la vez en 6 plazas.
- **Dos pasos.** Funciona igual que `mfa_ok()`. Si la cuenta tiene el segundo paso activado y la sesión aún no ha metido el código, no se puede leer ni cambiar nada, ni siquiera los datos públicos.
- **Contraseñas.** Las nuevas se guardan con PBKDF2-SHA256 (100 000 iteraciones, el máximo de Workers). Los hash bcrypt que vienen de Supabase se comprueban tal cual y se convierten a PBKDF2 la primera vez que el usuario entra, así que nadie tiene que cambiar la contraseña.
- **CSRF.** Toda petición que cambia datos lleva la cabecera `X-DivingSlot: 1` y un `Origin` propio. La cookie es `SameSite=Lax` y no hay CORS.
- **Sin dependencias.** El Worker solo usa WebCrypto y D1, sin Hono ni Drizzle. Se puede probar entero en Node sin red.

## Pruebas (sin red)

```bash
node --no-warnings worker/test/run.mjs     # 152 comprobaciones: aceptación, permisos, concurrencia, 2 pasos, Google, avisos, PayMongo, ficheros
node --no-warnings worker/test/import.mjs  # 54: copia de datos desde Supabase (fixture real de private.export_to_d1) y /api/health
node --no-warnings worker/test/stats.mjs   # 15: visitas y avisos
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

Los pasos exactos, con quién hace cada uno, están en **`docs/CAMBIO-A-CLOUDFLARE.md`**. En resumen:

1. Fernando pone las claves: plan Workers Paid, Google Cloud y los secretos del Worker.
2. `https://divingslot.com/api/health?check=1` dice si falta algo.
3. Supabase manda los datos al Worker con `select private.export_to_d1('cambio-1');`. Ver `worker/import.js` y la migración 034.
4. Se cambia `VITE_BACKEND=cloudflare` en `.env.production`. Para volver atrás, se pone otra vez `supabase`.

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
