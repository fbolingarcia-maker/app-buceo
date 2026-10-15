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
- `src/pages/Explorar.jsx`: salidas de los próximos 8 días (vista `published_trips`, una sola consulta), buscador con sugerencias de destino/provincia/región (`src/lib/places.js`, tabla `destinations`), contador por día, orden por hora/precio/distancia y «Cerca de mí» (`src/lib/geo.js`).
- `src/pages/Salida.jsx`: detalle de la salida, «¿Quién va?» (`trip_divers()`: nombre corto, nivel, inmersiones, idiomas, país, bio; respeta `divers.show_on_trips`) y reserva (`book_trip`).
- `src/pages/Reservas.jsx`: reservas del buceador; pago de la señal, el total o el resto (`crear-pago`, `confirm_payment_demo` en modo demo) y cancelación (`cancel_my_booking`).
- `src/pages/Perfil.jsx`: perfil, certificaciones, alta de centro (`register_center`), contraseña.
- `src/pages/Bitacora.jsx` / `Inmersion.jsx`: bitácora del buceador (tabla `dive_logs`, fotos en `dive_log_photos` + bucket privado `dive-photos/<user_id>/...`).
- `src/pages/CentroPanel.jsx`: cuadro de mandos del centro. `CentroAgenda.jsx`: manifiesto por día (check-in `set_checkin`, cobros, reservas manuales, meteo). `CentroSalidas.jsx`: gestión de salidas (editar, duplicar, publicar, completar). `CentroAjustes.jsx`: barcos y datos. `RegistrarCentro.jsx`: alta del centro.
- `src/pages/NuevaSalida.jsx`: crear o editar (`#/centro/salida/<id>`) una salida.
- `src/lib/centro.js`: cálculo de plazas, dinero y consulta común de salidas para las pantallas del centro.
- `src/pages/Centros.jsx`: directorio público de centros de toda Filipinas, agrupado por destino y filtrable por región.
- `src/pages/CentroInfo.jsx` (`#/c/<id>`): ficha pública del centro (valoración, contacto, próximas salidas). `src/pages/Destino.jsx` (`#/d/<destino>`): guía del destino (puntos de buceo, centros, «Ver salidas aquí»).
- Valoraciones: `center_ratings()` (media de la bitácora compartida, solo datos agregados), cargadas con `loadRatings()`.
- `src/lib/DestinoSelect.jsx`: selector de destino (alta del centro y ajustes).
- Datos: `destinations` (destino, provincia, grupo de islas, coordenadas), `centers.destination/province`, `dive_sites.province/highlight/highlight_es` (descripción en inglés y español).
- `supabase/migrations/`: esquema completo (001–014; 008 = pagos, 009 = perfiles, check-in y bitácora, 010 = zona y coordenadas en `published_trips`, 011 = «¿Quién va?» y `booked_seats`, 012 = toda Filipinas: destinos, directorio, puntos de buceo y demos, 013 = valoraciones públicas, 014 = descripciones de puntos en español).
- Perfiles: `divers.account_type` ('diver' | 'center'); `isCenter` en `useAuth()` decide el menú.
- `supabase/functions/`: Edge Functions de PayMongo (`crear-pago`, `paymongo-webhook`). Se despliegan en Supabase, no en GitHub Pages.

## Pagos
- Señal mínima del 50 % (`deposit_php`) para confirmar la reserva; el resto se paga en la app o en efectivo en el centro (`record_cash_payment`).
- Todo cobro pasa por la tabla `payments` y se aplica con `settle_payment()` (solo service_role).
- `app_config.payments_mode`: `demo` (pago simulado) o `paymongo` (cobro real).

## Comprobar antes de hacer push
- `npm run build` sin errores.
- Si cambias reglas de reserva, prueba con un usuario buceador y con uno de centro.
