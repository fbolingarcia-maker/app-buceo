# CLAUDE.md — contexto para trabajar en DiveSlot

App tipo Playtomic para salidas de buceo. Piloto en Panglao (Bohol, Filipinas). Moneda PHP, hora Asia/Manila (UTC+8, sin horario de verano). Interfaz en español.

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

## Mapa
- `src/pages/Explorar.jsx`: salidas por día (vista `published_trips`).
- `src/pages/Salida.jsx`: detalle de la salida y reserva (`book_trip`).
- `src/pages/Reservas.jsx`: reservas del buceador; pago de la señal, el total o el resto (`crear-pago`, `confirm_payment_demo` en modo demo) y cancelación (`cancel_my_booking`).
- `src/pages/Perfil.jsx`: perfil, certificaciones, alta de centro (`register_center`), contraseña.
- `src/pages/Bitacora.jsx` / `Inmersion.jsx`: bitácora del buceador (tabla `dive_logs`, fotos en `dive_log_photos` + bucket privado `dive-photos/<user_id>/...`).
- `src/pages/CentroPanel.jsx`: cuadro de mandos del centro. `CentroAgenda.jsx`: manifiesto por día (check-in `set_checkin`, cobros, reservas manuales, meteo). `CentroSalidas.jsx`: gestión de salidas (editar, duplicar, publicar, completar). `CentroAjustes.jsx`: barcos y datos. `RegistrarCentro.jsx`: alta del centro.
- `src/pages/NuevaSalida.jsx`: crear o editar (`#/centro/salida/<id>`) una salida.
- `src/lib/centro.js`: cálculo de plazas, dinero y consulta común de salidas para las pantallas del centro.
- `src/pages/Centros.jsx`: directorio público de centros.
- `supabase/migrations/`: esquema completo (001–009; 008 = pagos, 009 = perfiles, check-in y bitácora).
- Perfiles: `divers.account_type` ('diver' | 'center'); `isCenter` en `useAuth()` decide el menú.
- `supabase/functions/`: Edge Functions de PayMongo (`crear-pago`, `paymongo-webhook`). Se despliegan en Supabase, no en GitHub Pages.

## Pagos
- Señal mínima del 50 % (`deposit_php`) para confirmar la reserva; el resto se paga en la app o en efectivo en el centro (`record_cash_payment`).
- Todo cobro pasa por la tabla `payments` y se aplica con `settle_payment()` (solo service_role).
- `app_config.payments_mode`: `demo` (pago simulado) o `paymongo` (cobro real).

## Comprobar antes de hacer push
- `npm run build` sin errores.
- Si cambias reglas de reserva, prueba con un usuario buceador y con uno de centro.
