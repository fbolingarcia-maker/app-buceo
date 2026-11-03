import { t } from './i18n'

// Texto para un campo de iCalendar (RFC 5545): escapa \ ; , y saltos de línea
const icsText = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
// Líneas de más de 75 octetos se parten (RFC 5545 §3.1)
const icsFold = (line) => {
  const out = []
  let cur = '', bytes = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch; bytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

// Descarga un .ics para añadir la salida al calendario del móvil, con dos recordatorios (la víspera y 2 h antes),
// el lugar del centro y el aviso de no volar justo después de bucear
export function calendarFile(b, now = new Date()) {
  const start = new Date(b.trips.departs_at)
  const end = new Date(start.getTime() + Math.max(3, (b.trips.num_dives || 2) * 1.5) * 3600000)
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const c = b.trips.centers || {}
  const where = [c.name, c.locality, c.destination].filter(Boolean).join(', ')
  const desc = [
    t('{n} inmersiones', { n: b.trips.num_dives }) + (b.trips.boats?.show_to_divers ? ' · ' + b.trips.boats.name : ''),
    c.phone ? t('Teléfono del centro: {tel}', { tel: c.phone }) : '',
    t('Lleva tu certificación y el seguro de buceo.'),
    t('Después de bucear, espera al menos 18 h antes de volar (12 h tras una sola inmersión sin descompresión).'),
    t('Tu reserva: {url}', { url: 'https://divingslot.com/app/#/reservas' }),
  ].filter(Boolean).join('\n')
  const alarm = (trigger) => ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(t('Buceo con {centro}', { centro: c.name || '' })), 'TRIGGER:' + trigger, 'END:VALARM']
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DivingSlot//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' + b.id + '@divingslot.com', 'DTSTAMP:' + f(now), 'DTSTART:' + f(start), 'DTEND:' + f(end),
    'SUMMARY:' + icsText(t('Buceo con {centro}', { centro: c.name || '' })),
    where && 'LOCATION:' + icsText(where),
    c.lat != null && c.lng != null && 'GEO:' + c.lat + ';' + c.lng,
    'DESCRIPTION:' + icsText(desc),
    'URL:https://divingslot.com/app/#/reservas',
    ...alarm('-PT12H'), ...alarm('-PT2H'),
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).map(icsFold).join('\r\n') + '\r\n'
}
