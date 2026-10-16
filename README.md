# DiveSlot · Filipinas

Reserva de salidas de buceo, al estilo Playtomic. Los buceadores ven las salidas del día y reservan plaza. Los centros publican salidas, controlan las plazas (app + WhatsApp/mostrador) y cancelan por meteo con reembolso automático.

Cobertura: toda Filipinas (28 destinos: Bohol, Cebu, Negros, Siquijor, Boracay, Anilao, Puerto Galera, Coron, El Nido, Tubbataha, Camiguin…). Piloto en Panglao. Moneda: PHP. Hora: Asia/Manila.

**Stack:** React 18 + Vite · Supabase (Postgres + Auth + RLS) · GitHub Pages.

## Estructura

```
.github/workflows/deploy.yml   Publica en GitHub Pages en cada push a main
supabase/migrations/           Esquema, reservas, seguridad, pagos, perfiles y bitácora (001–016)
supabase/functions/            Edge Functions de pago (crear-pago, paymongo-webhook)
src/lib/                       Cliente Supabase, sesión, fechas/precios, router
src/pages/                     Buceador: Explorar, Salida, Reservas, Bitacora, Inmersion · Centro: CentroPanel, CentroAgenda, CentroSalidas, CentroAjustes, NuevaSalida
CLAUDE.md                      Contexto para trabajar con Claude
```

## Desarrollo local

```bash
npm install
npm run dev        # http://localhost:5173
```

## Idiomas y búsqueda

- Inglés y español: selector EN/ES en la cabecera, en el login y en el perfil (se recuerda en el navegador). Textos en `src/lib/en/*.js`.
- Salidas: buscador con sugerencias (destino, provincia o región), atajos a destinos populares, contador de salidas por día, orden por hora/precio/distancia y «📍 Cerca de mí».
- Directorio: ~150 centros reales de toda Filipinas (fuente en `centers.source_url`) y ~130 puntos de buceo con profundidad, nivel y descripción.
- Guía de cada destino (`#/d/<destino>`): puntos de buceo con profundidad, nivel y descripción (en inglés y español) y los centros de la zona.
- Ficha pública de cada centro (`#/c/<id>`) con valoración media (de las inmersiones que los buceadores comparten desde su bitácora), contacto y próximas salidas. El centro puede compartir su enlace desde el Panel.
- La bitácora se puede exportar a CSV y las reservas se pueden añadir al calendario (.ics).
- La app se puede instalar en el móvil (manifest + iconos en `public/`). Los centros guardan su ubicación GPS en *Centro → Datos*.
- «¿Quién va?»: en cada salida se ve quién ha reservado ya (nombre e inicial, nivel, inmersiones, idiomas, país, «busca buddy», punto favorito y una frase). Cada buceador puede ocultarse desde su perfil.

## Dos perfiles

Al crear la cuenta se elige **buceador** o **centro de buceo** (`divers.account_type`).

- **Buceador**: Salidas · Centros · Reservas · **Bitácora** (inmersiones con datos técnicos, valoración, comentarios y fotos privadas en Storage `dive-photos`) · Perfil.
- **Centro**: **Panel** (KPIs del día, avisos, próximos 7 días) · **Agenda** (manifiesto por salida, check-in, cobros en efectivo, reservas manuales, meteo) · **Salidas** (crear, editar, duplicar en varios días, publicar, completar, eliminar) · **Centro** (barcos y datos) · Perfil.

## Probar

- **Como buceador**: crea una cuenta, ve a Perfil, añade una certificación, elige una salida en Salidas y reserva. En Reservas elige pagar la señal (50 %) o el total, con GCash o tarjeta. Mientras `payments_mode = 'demo'`, el pago es simulado.
- **Como centro**: crea la cuenta eligiendo «Soy centro de buceo» y da de alta el centro (si el nombre coincide con uno del directorio, se reclama esa ficha). En *Centro* añade un barco y crea salidas desde *Salidas*. En la *Agenda* tienes el manifiesto, check-in, cobros y cancelación por meteo.
- **Bitácora**: tras una salida, el buceador ve «Registra tus inmersiones» con los puntos ya rellenados.
- Los centros "Demo · …" tienen salidas para los próximos 7 días, que se regeneran solas cada noche (pg_cron).

## Reglas de negocio (en la base de datos)

| Regla | Valor | Dónde |
|---|---|---|
| Comisión de la plataforma | ₱250 por buceador reservado por la app | `app_setting()` |
| Señal mínima para confirmar | 50 % del total | `app_config.deposit_pct` + trigger `bookings_set_deposit` |
| Resto | En la app (GCash/tarjeta) o en efectivo en el centro | `crear-pago` · `record_cash_payment()` |
| Retención de plaza sin pagar | 15 min (30 min mientras hay un pago en curso) | `holds_seat()` |
| Antelación mínima para reservar | 60 min | `book_trip()` |
| Reembolso si cancela el buceador | Todo lo pagado con ≥24 h; con menos, el centro retiene el 50 % del total | `cancel_my_booking()` |
| Cancelación por meteo | Se devuelve todo lo pagado, sin comisión | `cancel_trip_weather()` + trigger `trips_on_weather_cancel` |
| Plazas operativas | mín(capacidad del barco, guías × buceadores por guía, límite manual) | `operative_seats()` |
| Plazas en la app | operativas − máx(bloqueadas, reservas manuales) − reservas por app | `app_available_seats()` |

## Pagos (PayMongo)

- Edge Functions: `crear-pago` crea el checkout de PayMongo (GCash o tarjeta) y comprueba el pago al volver; `paymongo-webhook` confirma el pago aunque el buceador cierre la página.
- Secretos en Supabase (Edge Functions → Secrets): `PAYMONGO_SECRET_KEY` y `PAYMONGO_WEBHOOK_SECRET`.
- Webhook en PayMongo: `https://tosgzcpnkpsrrkfqctgy.supabase.co/functions/v1/paymongo-webhook`, evento `checkout_session.payment.paid`.
- Activar el cobro real: `update app_config set value = 'paymongo' where key = 'payments_mode';` (con `'demo'` se simula).
- Los reembolsos se calculan en `refund_php`; de momento se devuelven a mano desde el panel de PayMongo.

## Seguridad

- El frontend solo lleva la clave **publishable**, que es pública por diseño. La protección está en RLS y en las funciones que validan `auth.uid()`.
- Nunca subas la `service_role` / secret key.
- Las acciones (reservar, cancelar, registrar un centro…) exigen sesión iniciada (migración 007).

## Pendiente

- Reembolsos automáticos vía API de PayMongo.
- Foto de la tarjeta de certificación (Supabase Storage; la columna `photo_path` ya existe).
- Invitar a más staff a un centro.
- Buddies: emparejar buceadores con `seeks_buddy = true`.
- Notificaciones (email/WhatsApp) al confirmar o cancelar.
- Login con Google (la migración 006 ya lo prepara; falta activar el proveedor en Supabase).
