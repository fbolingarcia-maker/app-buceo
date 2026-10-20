# Análisis de ciberseguridad de DiveSlot (19 oct 2026)

Revisión de la base de datos (Supabase), el almacenamiento de ficheros, las Edge Functions de pago y el frontend, siguiendo las recomendaciones de Supabase y OWASP.

## Datos sensibles: dónde están y cómo se protegen

| Dato | Dónde | Protección |
|---|---|---|
| Contraseñas | Supabase Auth (`auth.users`) | Nunca se guardan en claro: solo el hash **bcrypt** con sal. Ni la app, ni los administradores, ni la base de datos pueden leerlas. |
| Tarjetas / GCash del buceador | **PayMongo** (pasarela PCI-DSS) | La app nunca ve ni guarda números de tarjeta ni credenciales GCash: el pago se hace en la página de PayMongo. En `payments` solo hay importe, estado y la referencia de PayMongo. |
| Nº GCash del centro, nota de revisión, notas internas | `centers` | Solo los ve el propio centro y los administradores (`center_private()`; la migración 025 los quita de las lecturas públicas). |
| Documentos de verificación (DNI, permisos) | Bucket privado `center-docs` | Privado; solo el centro y los administradores, con enlaces firmados de 5 minutos. Solo PDF e imágenes, máx. 10 MB. |
| Fotos de la bitácora | Bucket privado `dive-photos/<user_id>/` | Cada usuario solo accede a su carpeta. |
| Email, perfil del buceador | `divers` | El propio usuario; el centro solo ve a sus clientes; los administradores ven todos (`admin_users()`). |
| Todo lo anterior en disco | Supabase | Cifrado en reposo (AES-256) y en tránsito (TLS) por Supabase. |

## Hallazgos y cambios

### Corregido y aplicado en Supabase (migración 024)
- **Permisos de escritura sobrantes:** el rol `anon` (visitante sin sesión) tenía permisos INSERT/UPDATE/DELETE/TRUNCATE en todas las tablas. Las políticas RLS ya lo bloqueaban, pero se han quitado por defensa en profundidad. Nadie puede hacer TRUNCATE (que no pasa por RLS). También para tablas futuras.
- **Bucket `center-docs` sin tipo de fichero:** aceptaba cualquier fichero; ahora solo PDF, JPG, PNG, WEBP y HEIC (también en el selector de la app).
- **Sin registro de auditoría:** nueva tabla `admin_audit` (solo legible por administradores) que guarda automáticamente cada cambio de estado de un centro y cada alta o baja de administrador, con quién y cuándo.
- **Administradores sin vista de usuarios:** nueva función `admin_users()` (solo administradores): perfil, email, alta, último acceso, certificaciones, reservas y centros de cada usuario. Nunca contraseñas ni datos de pago.
- **Datos privados del centro:** nueva función `center_private()`.

### Corregido y desplegado (Edge Function)
- `paymongo-webhook`: la firma de PayMongo se compara en tiempo constante (evita ataques de temporización) y los errores internos ya no se devuelven al exterior.

### Preparado, pendiente de subir (con el ordenador)
- **Frontend** (GitHub): cabecera **Content-Security-Policy** (solo scripts propios, conexiones solo a Supabase, sin `object`/`base` externos), **Referrer-Policy**, contraseñas nuevas de **mínimo 8 caracteres**, panel de administración con Usuarios y Registro, datos privados del centro leídos con `center_private()`.
- **Migración 025** (aplicar *después* de publicar el frontend): oculta `gcash_number`, `review_note` y `notes` de las lecturas públicas de `centers`.
- **Edge Function `crear-pago`**: CORS limitado a la propia app (antes `*`) y mensajes de error genéricos. El despliegue automático fue bloqueado por el control de seguridad; desplegar desde el panel de Supabase o pedírmelo con confirmación.

### Solo se puede cambiar en el panel de Supabase (Authentication → Policies / Providers)
1. **Protección de contraseñas filtradas** (HaveIBeenPwned): activar.
2. **Longitud mínima de contraseña:** 8 (y requisitos: letras y números).
3. Opcional, recomendado para administradores: **MFA (TOTP)**.
4. Revocar el token de GitHub «app-buceo-claude».

### Revisado y correcto
- RLS activado en **todas** las tablas; la vista `published_trips` usa `security_invoker`.
- Todas las funciones `SECURITY DEFINER` tienen `search_path` fijo y comprueban permisos dentro (`auth.uid()`, `is_staff`, `is_platform_admin`). Las que avisa el linter de Supabase son las RPC de la app y las auxiliares de RLS: es el diseño previsto.
- `settle_payment` y `start_online_payment` solo las puede ejecutar el servidor (service_role), no los usuarios.
- El pago de demostración comprueba el modo `demo` y que la reserva sea del usuario.
- El frontend solo lleva la clave *publishable*; ninguna clave secreta en el repositorio.
- React escapa todo el texto (no hay `innerHTML`); los enlaces externos usan `noopener`/`noreferrer`.
- La firma del webhook de PayMongo se verifica (HMAC-SHA256) y el pago se vuelve a confirmar con la API de PayMongo antes de darlo por pagado.

### Riesgos aceptados / siguientes pasos
- GitHub Pages no permite cabeceras HTTP propias (HSTS, `frame-ancestors`): la CSP va como `<meta>`. Si se pasa a Netlify/Cloudflare, añadir `Strict-Transport-Security`, `X-Frame-Options: DENY` y `frame-ancestors 'none'`.
- Límite de peticiones: Supabase limita los intentos de login/registro; para las reservas, valorar un límite por usuario si hay abuso.
