# CLAUDE.md — contexto para trabajar en DiveSlot

App tipo Playtomic para salidas de buceo en toda Filipinas (piloto en Panglao, Bohol). Moneda PHP, hora Asia/Manila (UTC+8, sin horario de verano). Interfaz en inglés y español.

## Stack
- Frontend: React 18 + Vite, sin router externo (router por hash en `src/lib/router.jsx`). Estilos en `src/styles.css`.
- Backend: Supabase, proyecto `app-buceo`, ref `tosgzcpnkpsrrkfqctgy` (región ap-southeast-1).
- Hosting: GitHub Pages. `.github/workflows/deploy.yml` compila y publica en cada push a `main`.

## Reglas
- Toda la lógica de negocio y la seguridad están en la base de datos (RLS + funciones `SECURITY DEFINER`). El frontend solo usa la clave publishable.
- Nunca pongas la `service_role` / secret key en el repo ni en GitHub Actions.
- Cada cambio de esquema va en una migración nueva en `supabase/migrations/` (`YYYYMMDDHHMMSS_NNN_nombre.sql`) **y** se aplica en Supabase. Las dos cosas deben quedar iguales.
- Las acciones nuevas que cambian datos se hacen como RPC: `revoke execute ... from public, anon` y `grant ... to authenticated`.
- Después de cambiar el esquema, revisa los advisors de seguridad de Supabase.
- Los errores de las RPC usan el formato `CODIGO: mensaje para el usuario`. `errMsg()` en `src/lib/supabase.js` muestra solo el mensaje.
- Las fechas siempre se manejan en hora de Manila con los helpers de `src/lib/format.js`.
- Idiomas: inglés y español. Todo texto visible va con `t('texto en español')` (`src/lib/i18n.jsx`) y su traducción en `src/lib/en/*.js`; para partes variables usa `t('Quedan {n} plazas', { n })`. Nunca uses plantillas `` `...` `` dentro de `t()`.

## Mapa
- `src/pages/Explorar.jsx`: salidas de los próximos 8 días (vista `published_trips`, una sola consulta), buscador con sugerencias de destino/provincia/región (`src/lib/places.js`, tabla `destinations`), contador por día, orden por hora/precio/distancia y «Cerca de mí» (`src/lib/geo.js`). Las salidas del día se agrupan por centro (estilo Playtomic): tarjeta del centro con horarios y plazas libres; al desplegarla, cada salida con sus apuntados (`trip_divers()`).
- `src/pages/Salida.jsx`: detalle de la salida, «¿Quién va?» (`trip_divers()`: nombre corto, nivel, inmersiones, idiomas, país, bio; respeta `divers.show_on_trips`) y reserva (`book_trip`).
- `src/pages/Reservas.jsx`: reservas del buceador; pago de la señal, el total o el resto (`crear-pago`, `confirm_payment_demo` en modo demo) y cancelación (`cancel_my_booking`).
- `src/pages/Perfil.jsx`: perfil, certificaciones, alta de centro (`register_center`), contraseña.
- `src/pages/Bitacora.jsx` / `Inmersion.jsx`: bitácora del buceador (tabla `dive_logs`, fotos en `dive_log_photos` + bucket privado `dive-photos/<user_id>/...`).
- `src/pages/CentroPanel.jsx`: cuadro de mandos del centro. `CentroAgenda.jsx`: manifiesto por día (check-in `set_checkin`, cobros, reservas manuales, meteo). `CentroSalidas.jsx`: gestión de salidas (editar, duplicar, publicar, completar). `CentroAjustes.jsx`: barcos y datos. `RegistrarCentro.jsx`: alta del centro.
- `src/pages/CentroInformes.jsx` (`#/centro/informes?ver=resumen|cobros|clientes|movimientos`): seguimiento del centro. Resumen por periodo (salidas, ocupación, facturado/cobrado/pendiente, origen de las reservas, ocupación por día y horario, puntos más usados), cobros pendientes (próximos y atrasados), clientes (historial, gasto, repetidores, email) y movimientos (tabla `payments`). Todo exportable a CSV (`src/lib/csv.js`). El Panel muestra además las últimas reservas (72 h).
- `src/pages/NuevaSalida.jsx`: crear o editar (`#/centro/salida/<id>`) una salida.
- `src/lib/centro.js`: cálculo de plazas, dinero y consulta común de salidas para las pantallas del centro.
- `src/pages/Centros.jsx`: directorio público de centros de toda Filipinas, agrupado por destino y filtrable por región.
- `src/pages/CentroInfo.jsx` (`#/c/<id>`): ficha pública del centro (valoración, contacto, próximas salidas). `src/pages/Destino.jsx` (`#/d/<destino>`): guía del destino (puntos de buceo, centros, «Ver salidas aquí»).
- Valoraciones: `center_ratings()` (media de la bitácora compartida, solo datos agregados), cargadas con `loadRatings()`.
- `src/lib/DestinoSelect.jsx`: selector de destino (alta del centro y ajustes).
- Datos: `destinations` (destino, provincia, grupo de islas, coordenadas), `centers.destination/province`, `dive_sites.province/highlight/highlight_es` (descripción en inglés y español).
- `supabase/migrations/`: esquema completo (001–022; 008 = pagos, 009 = perfiles, check-in y bitácora, 010 = zona y coordenadas en `published_trips`, 011 = «¿Quién va?» y `booked_seats`, 012 = toda Filipinas: destinos, directorio, puntos de buceo y demos, 013 = valoraciones públicas, 014 = descripciones de puntos en español, 015 = `boats.show_to_divers`: el centro decide si los buceadores ven el barco; si no, `published_trips.boat_name` es null, 016 = `centers.languages` y `course_languages`: idiomas del centro con banderas, `src/lib/langs.jsx`; 017 = verificación de centros; 018 = revisión del directorio y `centers.agencies` (PADI, SSI…), 019 = `published_trips.center_agencies` y `center_course_languages` (filtros de agencia e idioma en Salidas), 020 = segunda revisión web del directorio (`directory_check`), 021 = índices y políticas RLS más rápidas, 022 = `delete_my_account()`: eliminar la propia cuenta).
- Verificación (017): `centers.verification_status` (unverified → pending → verified | rejected | suspended). Solo los centros `verified` aparecen en `published_trips`, pueden publicar salidas (trigger `enforce_trip_publish`, error `NOT_VERIFIED`) y recibir reservas. El centro rellena `center_verifications` y sube documentos (`center_documents` + bucket privado `center-docs/<center_id>/...`) en `src/pages/CentroVerificacion.jsx` (`#/centro/verificacion`) y envía con `submit_center_verification()`. Los administradores (`platform_admins`, `is_platform_admin()`, `isAdmin` en `useAuth()`) revisan en `src/pages/Admin.jsx` (`#/admin`) con `review_center()`. Reclamar una ficha del directorio crea un centro nuevo con `claims_center_id`; la ficha antigua se cierra al verificar. El trigger `protect_center_columns` impide que el centro cambie su propio estado.
- Agencias: `centers.agencies text[]` + `agency_detail` (`src/lib/agencies.jsx`), en el directorio (filtro), la ficha y Ajustes.
- UX común: `ErrorBoundary` (`src/lib/ErrorBoundary.jsx`) en cada pantalla; avisos con `role=alert/status`; tras entrar se vuelve a la salida (`sessionStorage.afterLogin`); Panel del centro con «Primeros pasos»; Agenda con avisos flotantes (`.toast`) y «Deshacer» en el check-in; el admin ve en la cabecera cuántos centros esperan validación.
- Eliminar cuenta (022): `src/pages/EliminarCuenta.jsx` (al final del Perfil, buceador y centro). `delete_my_account(true)` devuelve lo que se borrará y lo que lo impide (reservas futuras propias o del centro); la app borra los ficheros de Storage (`dive-photos`, `center-docs`) y luego `delete_my_account(false)` borra bitácora, certificaciones y el usuario de Auth. Las reservas pasadas se conservan con el buceador anonimizado; los centros que posee se cierran (`cerrado` + `suspended`), no se borran.
- Perfiles: `divers.account_type` ('diver' | 'center'); `isCenter` en `useAuth()` decide el menú.
- `supabase/functions/`: Edge Functions de PayMongo (`crear-pago`, `paymongo-webhook`). Se despliegan en Supabase, no en GitHub Pages.

## Pagos
- Señal mínima del 50 % (`deposit_php`) para confirmar la reserva; el resto se paga en la app o en efectivo en el centro (`record_cash_payment`).
- Todo cobro pasa por la tabla `payments` y se aplica con `settle_payment()` (solo service_role).
- `app_config.payments_mode`: `demo` (pago simulado) o `paymongo` (cobro real).

## Comprobar antes de hacer push
- `npm run build` sin errores.
- Sin red (sandbox de Claude): `tools/smoke/` compila la app con un Supabase simulado y recorre todas las pantallas con Chromium por rol (`anon`, `diver`, `center`, `centerv`, `centerr`, `admin`). Ver `tools/smoke/README.md`.
- Si cambias reglas de reserva, prueba con un usuario buceador y con uno de centro.
