// Emails de DivingSlot desde el Worker (bilingües, mismas plantillas que tenía Supabase).
// Envío por Cloudflare Email Service (binding EMAIL), por Resend (RESEND_API_KEY) o, si no, por SMTP con TLS (SMTP_HOST, SMTP_PORT=465, SMTP_USER, SMTP_PASS),
// p. ej. la contraseña de aplicación de Gmail que ya usaba Supabase.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const button = (url, label) => `<p><a href="${esc(url)}" style="background:#0b5e8a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">${label}</a></p>`
const foot = (es, en) => `<p style="color:#5d7282;font-size:13px">${es}<br>${en}</p>`
const wrap = (body) => `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">${body}</div>`

export const TEMPLATES = {
  confirm: (url) => ({
    subject: 'Confirma tu cuenta de DivingSlot · Confirm your DivingSlot account',
    html: wrap(`<h2>DivingSlot 🤿</h2><p>¡Hola! Pulsa el botón para confirmar tu cuenta.<br>Hi! Tap the button to confirm your account.</p>${button(url, 'Confirmar cuenta · Confirm account')}${foot('Si no has creado una cuenta en DivingSlot, ignora este email.', "If you didn't sign up for DivingSlot, you can ignore this email.")}`),
  }),
  recovery: (url) => ({
    subject: 'Nueva contraseña de DivingSlot · Reset your DivingSlot password',
    html: wrap(`<h2>DivingSlot 🤿</h2><p>Pulsa el botón para crear una contraseña nueva.<br>Tap the button to create a new password.</p>${button(url, 'Crear contraseña · Reset password')}${foot('Si no lo has pedido tú, ignora este email.', "If you didn't ask for this, you can ignore this email.")}`),
  }),
  reauth: (code) => ({
    subject: 'Tu código de DivingSlot · Your DivingSlot code',
    html: wrap(`<h2>DivingSlot</h2><p>Escribe este código en la app para confirmar el cambio de contraseña.<br>Enter this code in the app to confirm your password change.</p><p style="font-size:28px;letter-spacing:6px;font-weight:700" data-code="1">${esc(code)}</p>${foot('Caduca en 10 minutos. Si no lo has pedido tú, cambia tu contraseña.', "It expires in 10 minutes. If you didn't ask for it, change your password.")}`),
  }),
  centerReviewed: (name, decision, note, url) => ({
    subject: decision === 'verified' ? 'Tu centro ya está verificado · Your centre is verified' : 'Revisión de tu centro · Your centre review',
    html: wrap(`<h2>DivingSlot 🤿</h2><p>${decision === 'verified'
      ? `<b>${esc(name)}</b> ya está verificado: puedes publicar salidas y recibir reservas.<br><b>${esc(name)}</b> is verified: you can publish trips and take bookings.`
      : `Hemos revisado <b>${esc(name)}</b> y necesitamos algún cambio.<br>We reviewed <b>${esc(name)}</b> and need some changes.`}</p>${note ? `<p style="background:#f3f6f8;padding:10px 12px;border-radius:8px">${esc(note)}</p>` : ''}${button(url, 'Abrir DivingSlot · Open DivingSlot')}`),
  }),
}

// Fecha y hora de Manila para los emails (bilingüe)
const when = (iso, lang) => new Date(iso).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { timeZone: 'Asia/Manila', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-US')
Object.assign(TEMPLATES, {
  // 24 h antes: enlace para pagar el resto (o recordatorio de llevarlo en efectivo)
  balanceDue: (center, departs, due, url, cash) => ({
    subject: cash ? `Mañana buceas con ${center} · Diving tomorrow with ${center}` : `Paga el resto de tu salida · Pay the rest of your dive trip`,
    html: wrap(`<h2>DivingSlot 🤿</h2><p>${cash
      ? `Tu salida con <b>${esc(center)}</b> es el ${esc(when(departs, 'es'))}. Lleva <b>${peso(due)}</b> en efectivo para pagar el resto en el centro.<br>Your trip with <b>${esc(center)}</b> is on ${esc(when(departs, 'en'))}. Bring <b>${peso(due)}</b> in cash to pay the rest at the centre.`
      : `Tu salida con <b>${esc(center)}</b> es el ${esc(when(departs, 'es'))}. Te quedan <b>${peso(due)}</b> por pagar: hazlo ahora con GCash o tarjeta, o en efectivo en el centro.<br>Your trip with <b>${esc(center)}</b> is on ${esc(when(departs, 'en'))}. <b>${peso(due)}</b> is still due: pay now by GCash or card, or in cash at the centre.`}</p>${button(url, cash ? 'Ver mi reserva · View my booking' : 'Pagar el resto · Pay the rest')}${foot('Lleva tu tarjeta de certificación.', 'Bring your certification card.')}`),
  }),
  // Día antes de la salida: hora, lugar, contacto, mar previsto y lo que queda por pagar
  tripTomorrow: (r, url, profileUrl) => {
    const place = [r.locality, r.destination].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')
    const map = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.lat != null && r.lng != null ? r.lat + ',' + r.lng : r.center + ' ' + (r.destination || ''))
    const wa = r.phone ? 'https://wa.me/' + String(r.phone).replace(/\D/g, '') : null
    const sea = r.sea && {
      good: ['Buenas condiciones', 'Good conditions'], moderate: ['Mar algo movido', 'Slightly choppy sea'], rough: ['Mar movido: el centro puede cancelar (si cancela, se devuelve todo)', 'Rough sea: the centre may cancel (full refund if it does)'],
    }[r.sea.level]
    const seaNum = r.sea ? [r.sea.wave_m != null && r.sea.wave_m + ' m', r.sea.wind_kmh != null && r.sea.wind_kmh + ' km/h'].filter(Boolean).join(' · ') : ''
    const row = (es, en, v) => `<tr><td style="color:#5d7282;padding:3px 12px 3px 0;vertical-align:top">${es}<br><span style="font-size:12px">${en}</span></td><td style="padding:3px 0">${v}</td></tr>`
    const pay = r.due <= 0 ? ['Todo pagado', 'Fully paid']
      : r.pay_on_site ? [`Lleva <b>${peso(r.due)}</b> en efectivo para pagar el resto en el centro.`, `Bring <b>${peso(r.due)}</b> in cash to pay the rest at the centre.`]
        : [`Quedan <b>${peso(r.due)}</b>: págalo en la app con GCash o tarjeta, o en efectivo en el centro.`, `<b>${peso(r.due)}</b> is still due: pay in the app by GCash or card, or in cash at the centre.`]
    return {
      subject: `Mañana buceas con ${r.center} · Diving tomorrow with ${r.center}`,
      html: wrap(`<h2>DivingSlot 🤿</h2><p>Todo listo para tu salida. Aquí tienes lo que necesitas.<br>You're all set for your trip. Here's what you need.</p>
<table style="border-collapse:collapse;font-size:15px">
${row('Salida', 'Departs', `<b>${esc(when(r.departs_at, 'es'))}</b><br>${esc(when(r.departs_at, 'en'))}`)}
${row('Centro', 'Centre', `<b>${esc(r.center)}</b>${place ? '<br>' + esc(place) : ''}<br><a href="${esc(map)}">Mapa · Map</a>${wa ? ` · <a href="${esc(wa)}">WhatsApp</a>` : ''}`)}
${r.boat ? row('Barco', 'Boat', esc(r.boat)) : ''}
${row('Plazas', 'Spots', String(r.seats) + ' · ' + (r.num_dives || 2) + ' inmersiones / dives')}
${sea ? row('Mar previsto', 'Sea forecast', `${sea[0]}${seaNum ? ' (' + esc(seaNum) + ')' : ''}<br><span style="font-size:13px">${sea[1]}</span>`) : ''}
${row('Pago', 'Payment', `${pay[0]}<br><span style="font-size:13px">${pay[1]}</span>`)}
</table>
<p>Lleva tu tarjeta de certificación y llega 15 minutos antes. No vueles en las 18 h siguientes a bucear.<br>Bring your certification card and arrive 15 minutes early. Don't fly within 18 h after diving.</p>
${r.insured ? '' : `<p style="background:#f3f6f8;padding:10px 12px;border-radius:8px">No tenemos tu seguro de buceo en el perfil. Muchos centros lo piden. <a href="${esc(profileUrl)}">Añadirlo</a><br>We don't have your dive insurance on file. Many centres ask for it. <a href="${esc(profileUrl)}">Add it</a></p>`}
${button(url, r.due > 0 && !r.pay_on_site ? 'Pagar el resto · Pay the rest' : 'Ver mi reserva · View my booking')}${foot('Previsión de Open-Meteo, orientativa: el centro decide si sale.', 'Forecast by Open-Meteo, for guidance only: the centre decides whether to go out.')}`),
    }
  },
  // El seguro de buceo que el buceador indicó en su perfil caduca pronto
  insuranceExpiring: (provider, expiry, danUrl, profileUrl) => {
    const d = (lang) => new Date(expiry + 'T00:00:00+08:00').toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { timeZone: 'Asia/Manila', day: 'numeric', month: 'long', year: 'numeric' })
    return {
      subject: 'Tu seguro de buceo caduca pronto · Your dive insurance expires soon',
      html: wrap(`<h2>DivingSlot 🤿</h2><p>Tu seguro de buceo (<b>${esc(provider)}</b>) caduca el <b>${esc(d('es'))}</b>. Renuévalo antes de tu próxima salida y actualiza la fecha en tu perfil.<br>Your dive insurance (<b>${esc(provider)}</b>) expires on <b>${esc(d('en'))}</b>. Renew it before your next trip and update the date in your profile.</p>${button(profileUrl, 'Actualizar mi perfil · Update my profile')}<p><a href="${esc(danUrl)}">Ver seguros DAN · See DAN plans</a></p>${foot('Recibes este aviso porque indicaste la fecha en tu perfil. DivingSlot no vende seguros.', 'You get this because you added the date to your profile. DivingSlot does not sell insurance.')}`),
    }
  },
  // Lista de espera: se ha liberado una plaza y está retenida unos minutos para el buceador
  waitlistOffer: (center, departs, mins, url) => ({
    subject: `Plaza libre con ${center} · A spot opened up with ${center}`,
    html: wrap(`<h2>DivingSlot 🤿</h2><p>Se ha liberado una plaza en la salida de <b>${esc(center)}</b> del ${esc(when(departs, 'es'))}. Está retenida para ti <b>${mins} minutos</b>: paga la señal para confirmarla.<br>A spot opened up on the <b>${esc(center)}</b> trip on ${esc(when(departs, 'en'))}. It is held for you for <b>${mins} minutes</b>: pay the deposit to confirm it.</p>${button(url, 'Pagar y confirmar · Pay and confirm')}${foot('Si no pagas a tiempo, la plaza pasa al siguiente de la lista.', 'If you do not pay in time, the spot goes to the next person on the list.')}`),
  }),
  // Alguien de nivel parecido busca buddy en un destino que el buceador sigue
  buddyAlert: (name, level, center, dest, departs, url) => ({
    subject: `${name} busca buddy en ${dest} · ${name} is looking for a buddy in ${dest}`,
    html: wrap(`<h2>DivingSlot 🤿</h2><p><b>${esc(name)}</b>${level ? ' (' + esc(String(level).replace('_', ' ')) + ')' : ''} ha reservado con <b>${esc(center)}</b> el ${esc(when(departs, 'es'))} y busca buddy.<br><b>${esc(name)}</b> booked with <b>${esc(center)}</b> on ${esc(when(departs, 'en'))} and is looking for a buddy.</p>${button(url, 'Ver la salida · See the trip')}${foot('Recibes esto porque marcaste «Busco buddy» y sigues este destino. Puedes quitarlo en tu perfil.', 'You get this because you are looking for a buddy and follow this destination. You can turn it off in your profile.')}`),
  }),
  // Plazas de última hora en un destino que el buceador sigue
  lastMinute: (center, dest, departs, free, unit, price, url) => ({
    subject: `Última hora en ${dest}: ${free === 1 ? '1 plaza' : free + ' plazas'} · Last-minute spots in ${dest}`,
    html: wrap(`<h2>DivingSlot 🤿</h2><p><b>${esc(center)}</b> tiene ${free === 1 ? '1 plaza libre' : free + ' plazas libres'} en el barco del ${esc(when(departs, 'es'))}${unit < price ? `, a <b>${peso(unit)}</b> en vez de ${peso(price)}` : ` por ${peso(price)}`}.<br><b>${esc(center)}</b> has ${free === 1 ? '1 spot' : free + ' spots'} left on the boat on ${esc(when(departs, 'en'))}${unit < price ? `, at <b>${peso(unit)}</b> instead of ${peso(price)}` : ` for ${peso(price)}`}.</p>${button(url, 'Ver la salida · See the trip')}${foot('Recibes este aviso porque lo activaste en tu perfil (Avisos de última hora). Puedes quitarlo allí.', 'You get this alert because you turned on last-minute alerts in your profile. You can turn it off there.')}`),
  }),
})

export async function sendEmail(env, to, { subject, html }) {
  const from = env.EMAIL_FROM || 'DivingSlot <no-reply@divingslot.com>'
  // Cloudflare Email Service (binding send_email «EMAIL» en wrangler.jsonc): sin claves. Necesita Workers Paid y el
  // dominio dado de alta en Email Sending (o, en el plan gratuito, solo a direcciones verificadas de Email Routing).
  if (env.EMAIL?.send) {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(from)
    await env.EMAIL.send({ from: m ? { name: m[1], email: m[2] } : from, to, subject, html })
    return
  }
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
  if (env.EMAIL_DEV_LOG === '1') { console.log('EMAIL (modo prueba)', to, subject, html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&') ?? html.match(/data-code="1">(\d{6})</)?.[1]); return }
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
  const msg = [`From: ${env.EMAIL_FROM || 'DivingSlot <' + fromAddr + '>'}`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@divingslot.com>`, '', body, '.'].join('\r\n')
  await cmd(msg, 250)
  await w.write(te.encode('QUIT\r\n')).catch(() => {})
  await sock.close().catch(() => {})
}
