# App Buceo · Panglao

Reserva de salidas de buceo, al estilo Playtomic. Los buceadores ven las salidas del día y reservan plaza. Los centros publican salidas, controlan las plazas (app + WhatsApp/mostrador) y cancelan por meteo con reembolso automático.

Piloto: Panglao (Bohol, Filipinas). Moneda: PHP. Hora: Asia/Manila.

**Stack:** React 18 + Vite · Supabase (Postgres + Auth + RLS) · GitHub Pages.

## Estructura

```
.github/workflows/deploy.yml   Publica en GitHub Pages en cada push a main
supabase/migrations/           Esquema, lógica de reservas y seguridad (001–007)
src/lib/                       Cliente Supabase, sesión, fechas/precios, router
src/pages/                     Explorar, Salida, Reservas, Perfil, Login, Centro, NuevaSalida, Centros
CLAUDE.md                      Contexto para trabajar con Claude
```

## Desarrollo local

```bash
npm install
npm run dev        # http://localhost:5173
```

## Probar

- **Como buceador**: crea una cuenta, ve a Perfil, añade una certificación, elige una salida en Salidas, reserva y luego, en Reservas, pulsa *Pagar (modo demo)*.
- **Como centro**: en Perfil usa *Registrar mi centro* (si el nombre coincide con uno del directorio, se reclama esa ficha). Después ve a *Mi centro*, añade un barco en *Barcos y plazas* y crea una salida con *+ Salida*. Desde la agenda puedes añadir reservas manuales, verificar certificaciones y cancelar por meteo.
- Los centros "Demo · …" tienen salidas para los próximos 7 días, que se regeneran solas cada noche (pg_cron).

## Reglas de negocio (en la base de datos)

| Regla | Valor | Dónde |
|---|---|---|
| Comisión de la plataforma | ₱250 por buceador reservado por la app | `app_setting()` |
| Retención de plaza sin pagar | 15 min | `app_setting('hold_minutes')` |
| Antelación mínima para reservar | 60 min | `book_trip()` |
| Reembolso si cancela el buceador | 100 % con ≥24 h, 50 % con menos | `cancel_my_booking()` |
| Cancelación por meteo | Reembolso del 100 % de lo pagado, sin comisión | `cancel_trip_weather()` + trigger `trips_on_weather_cancel` |
| Plazas operativas | mín(capacidad del barco, guías × buceadores por guía, límite manual) | `operative_seats()` |
| Plazas en la app | operativas − máx(bloqueadas, reservas manuales) − reservas por app | `app_available_seats()` |

## Seguridad

- El frontend solo lleva la clave **publishable**, que es pública por diseño. La protección está en RLS y en las funciones que validan `auth.uid()`.
- Nunca subas la `service_role` / secret key.
- Las acciones (reservar, cancelar, registrar un centro…) exigen sesión iniciada (migración 007).

## Pendiente

- Pago real (GCash / PayMongo) en lugar de `confirm_payment_demo`.
- Foto de la tarjeta de certificación (Supabase Storage; la columna `photo_path` ya existe).
- Invitar a más staff a un centro.
- Buddies: emparejar buceadores con `seeks_buddy = true`.
- Notificaciones (email/WhatsApp) al confirmar o cancelar.
- Login con Google (la migración 006 ya lo prepara; falta activar el proveedor en Supabase).
