# Emails de DiveSlot (confirmación de cuenta y nueva contraseña)

## Por qué no llegaban

Supabase trae un servidor de correo de pruebas. Ese servidor solo envía a los emails del equipo del proyecto en Supabase (por eso a fbolingarcia@gmail.com sí le llegaba) y como mucho 2 emails por hora. Para que llegue a cualquier usuario hace falta un servidor SMTP propio.

## Opción rápida: Gmail (gratis, unos 500 emails al día)

1. **Activa la verificación en 2 pasos en Google.** Entra en la cuenta de Google de fbolingarcia@gmail.com y ve a https://myaccount.google.com/security.
2. **Crea una contraseña de aplicación.**
   - Entra en https://myaccount.google.com/apppasswords.
   - Ponle de nombre «DiveSlot».
   - Copia la clave de 16 letras.
3. **Rellena el SMTP en Supabase.**
   - Entra en Authentication → Emails → SMTP Settings y activa «Enable custom SMTP».
   - Rellena estos campos:
     - Sender email: fbolingarcia@gmail.com
     - Sender name: DiveSlot
     - Host: smtp.gmail.com
     - Port: 465
     - Username: fbolingarcia@gmail.com
     - Password: la clave de 16 letras del paso 2
   - Guarda con «Save changes».
4. **Sube el límite de envío.** En Authentication → Rate Limits, pon «emails/h» a 100 y guarda.
5. **Prueba el envío.** Crea una cuenta en la app con otro email. Si no aparece en la bandeja de entrada, mira en spam.

## Opción para más adelante: dominio propio

Si DiveSlot tiene dominio propio (p. ej. diveslot.ph), conviene usar Resend o Brevo con ese dominio. Hay que añadir sus registros DNS y enviar desde no-reply@diveslot.ph. Así llega mejor a la bandeja de entrada y no a spam.

## Plantillas (Authentication → Emails → Templates)

### Confirm signup

- **Asunto:** Confirma tu cuenta de DiveSlot · Confirm your DiveSlot account
- **Cuerpo:**

```html
<h2>DiveSlot 🤿</h2>
<p>¡Hola! Pulsa el botón para confirmar tu cuenta.<br>Hi! Tap the button to confirm your account.</p>
<p><a href="{{ .ConfirmationURL }}" style="background:#0b5e8a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Confirmar cuenta · Confirm account</a></p>
<p style="color:#5d7282;font-size:13px">Si no has creado una cuenta en DiveSlot, ignora este email.<br>If you didn't sign up for DiveSlot, you can ignore this email.</p>
```

### Reset password

- **Asunto:** Nueva contraseña de DiveSlot · Reset your DiveSlot password
- **Cuerpo:**

```html
<h2>DiveSlot 🤿</h2>
<p>Pulsa el botón para crear una contraseña nueva.<br>Tap the button to create a new password.</p>
<p><a href="{{ .ConfirmationURL }}" style="background:#0b5e8a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Crear contraseña · Reset password</a></p>
<p style="color:#5d7282;font-size:13px">Si no lo has pedido tú, ignora este email.<br>If you didn't ask for this, you can ignore this email.</p>
```

## En la app

- Después de crear la cuenta, la app dice a qué email se ha enviado, recuerda mirar en spam y ofrece «Reenviar email de confirmación».
- Si alguien intenta entrar sin haber confirmado, también puede reenviar el email desde la misma pantalla.
- Los errores de envío de Supabase («email rate limit exceeded», «Error sending confirmation email») salen traducidos.
