// Emails de DiveSlot desde el Worker (bilingües, mismas plantillas que tenía Supabase).
// Envío por Resend (RESEND_API_KEY) o, si no, por SMTP con TLS (SMTP_HOST, SMTP_PORT=465, SMTP_USER, SMTP_PASS),
// p. ej. la contraseña de aplicación de Gmail que ya usaba Supabase.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const button = (url, label) => `<p><a href="${esc(url)}" style="background:#0b5e8a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">${label}</a></p>`
const foot = (es, en) => `<p style="color:#5d7282;font-size:13px">${es}<br>${en}</p>`
const wrap = (body) => `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">${body}</div>`

export const TEMPLATES = {
  confirm: (url) => ({
    subject: 'Confirma tu cuenta de DiveSlot · Confirm your DiveSlot account',
    html: wrap(`<h2>DiveSlot 🤿</h2><p>¡Hola! Pulsa el botón para confirmar tu cuenta.<br>Hi! Tap the button to confirm your account.</p>${button(url, 'Confirmar cuenta · Confirm account')}${foot('Si no has creado una cuenta en DiveSlot, ignora este email.', "If you didn't sign up for DiveSlot, you can ignore this email.")}`),
  }),
  recovery: (url) => ({
    subject: 'Nueva contraseña de DiveSlot · Reset your DiveSlot password',
    html: wrap(`<h2>DiveSlot 🤿</h2><p>Pulsa el botón para crear una contraseña nueva.<br>Tap the button to create a new password.</p>${button(url, 'Crear contraseña · Reset password')}${foot('Si no lo has pedido tú, ignora este email.', "If you didn't ask for this, you can ignore this email.")}`),
  }),
  centerReviewed: (name, decision, note, url) => ({
    subject: decision === 'verified' ? 'Tu centro ya está verificado · Your centre is verified' : 'Revisión de tu centro · Your centre review',
    html: wrap(`<h2>DiveSlot 🤿</h2><p>${decision === 'verified'
      ? `<b>${esc(name)}</b> ya está verificado: puedes publicar salidas y recibir reservas.<br><b>${esc(name)}</b> is verified: you can publish trips and take bookings.`
      : `Hemos revisado <b>${esc(name)}</b> y necesitamos algún cambio.<br>We reviewed <b>${esc(name)}</b> and need some changes.`}</p>${note ? `<p style="background:#f3f6f8;padding:10px 12px;border-radius:8px">${esc(note)}</p>` : ''}${button(url, 'Abrir DiveSlot · Open DiveSlot')}`),
  }),
}

export async function sendEmail(env, to, { subject, html }) {
  const from = env.EMAIL_FROM || 'DiveSlot <no-reply@divingslot.com>'
  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    })
    if (!r.ok) throw new Error('resend ' + r.status)
    return
  }
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return smtpSend(env, to, subject, html)
  if (env.EMAIL_DEV_LOG === '1') { console.log('EMAIL (modo prueba)', to, subject, html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&')); return }
  throw new Error('email no configurado')
}

// SMTP mínimo sobre TLS directo (puerto 465) con cloudflare:sockets
async function smtpSend(env, to, subject, html) {
  const { connect } = await import('cloudflare:sockets')
  const sock = connect({ hostname: env.SMTP_HOST, port: +(env.SMTP_PORT || 465) }, { secureTransport: 'on' })
  const w = sock.writable.getWriter(), r = sock.readable.getReader()
  const te = new TextEncoder(), td = new TextDecoder()
  let buf = ''
  const read = async () => {
    for (;;) {
      const m = /(^|\r\n)(\d{3}) [^\r\n]*\r\n$/.exec(buf)
      if (m) { const out = buf; buf = ''; return +m[2] === 0 ? out : out }
      const { value, done } = await r.read(); if (done) throw new Error('smtp cerrado')
      buf += td.decode(value)
    }
  }
  const cmd = async (line, ok) => { if (line !== null) await w.write(te.encode(line + '\r\n')); const res = await read(); if (!res.match(new RegExp(`(^|\\r\\n)${ok} `))) throw new Error('smtp ' + res.slice(0, 80)) }
  const fromAddr = (env.EMAIL_FROM || env.SMTP_USER).replace(/^.*<|>.*$/g, '')
  const b64 = (s) => btoa(String.fromCharCode(...te.encode(s)))
  await cmd(null, 220)
  await cmd('EHLO divingslot.com', 250)
  await cmd('AUTH PLAIN ' + b64(`\0${env.SMTP_USER}\0${env.SMTP_PASS}`), 235)
  await cmd(`MAIL FROM:<${fromAddr}>`, 250)
  await cmd(`RCPT TO:<${to}>`, 250)
  await cmd('DATA', 354)
  const body = b64(html).replace(/.{1,76}/g, '$&\r\n')
  const msg = [`From: ${env.EMAIL_FROM || 'DiveSlot <' + fromAddr + '>'}`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@divingslot.com>`, '', body, '.'].join('\r\n')
  await cmd(msg, 250)
  await w.write(te.encode('QUIT\r\n')).catch(() => {})
  await sock.close().catch(() => {})
}
