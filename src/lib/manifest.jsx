import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { t } from './i18n'
import { levelName, dateTime, manilaDate, time, php } from './format'
import { medicalValid, daysSinceDive } from './medical'
import { downloadCsv } from './csv'

// Manifiesto de la salida para imprimir o descargar (lo que piden el capitán, el guía y la Coast Guard antes de zarpar):
// buceadores, certificación, médico, última inmersión, tallas si alquila equipo, pago y huecos para check-in y firma.
// Contacto de emergencia y nacionalidad se rellenan a mano si no los tenemos.
export function manifestRows(active) {
  return active.map((b, i) => {
    const d = b.divers
    const best = (d?.certifications || []).reduce((m, c) => (!m || (c.verified_at && !m.verified_at) ? c : m), null)
    const days = daysSinceDive(d)
    const sizes = b.with_gear && d ? [d.wetsuit_size && t('Traje {s}', { s: d.wetsuit_size }), d.bcd_size && t('Chaleco {s}', { s: d.bcd_size }), d.fin_size && t('Aletas {s}', { s: d.fin_size })].filter(Boolean).join(' · ') : ''
    return {
      n: i + 1,
      name: d?.full_name || b.guest_name || '',
      seats: b.seats,
      cert: best ? [best.agency, levelName(best.level), best.verified_at ? t('verificada') : ''].filter(Boolean).join(' ') : '',
      dives: d?.logged_dives ?? '',
      medical: !d ? '' : medicalValid(d) ? (d.medical_result === 'physician_ok' ? t('Con autorización médica') : t('Al día')) : t('Falta'),
      last: days == null ? '' : t('hace {n} días', { n: days }),
      nitrox: d?.nitrox ? t('Sí') : '',
      gear: b.with_gear ? (sizes || t('Sí, sin tallas')) : t('No'),
      pay: b.paid_php >= b.amount_php ? t('Pagado') : t('Falta {amount}', { amount: php(b.amount_php - b.paid_php) }),
      onboard: b.checked_in_at ? t('Sí') : '',
    }
  })
}

const COLS = () => [['n', t('N.º')], ['name', t('Nombre')], ['seats', t('Plazas')], ['cert', t('Certificación')], ['dives', t('Inmersiones')], ['medical', t('Médico')],
  ['last', t('Última inmersión')], ['nitrox', t('Nitrox')], ['gear', t('Equipo de alquiler')], ['pay', t('Pago')], ['onboard', t('A bordo')]]

export function manifestCsv(trip, active) {
  const cols = COLS()
  downloadCsv('manifiesto-' + manilaDate(new Date(trip.departs_at)) + '-' + time(trip.departs_at).replace(':', '') + '.csv',
    [...cols.map(([, h]) => h), t('Nacionalidad'), t('Contacto de emergencia')],
    manifestRows(active).map((r) => [...cols.map(([k]) => r[k]), '', '']))
}

// Hoja imprimible: se monta en <body> solo mientras se imprime y el resto de la página se oculta (styles.css, @media print)
export function ManifestSheet({ trip, active, centerName, sites, onDone }) {
  useEffect(() => {
    document.body.classList.add('printing')
    const done = () => { document.body.classList.remove('printing'); onDone() }
    window.addEventListener('afterprint', done, { once: true })
    const id = setTimeout(() => window.print(), 50)
    return () => { clearTimeout(id); window.removeEventListener('afterprint', done); document.body.classList.remove('printing') }
  }, [onDone])
  const rows = manifestRows(active)
  const cols = COLS()
  const seats = active.reduce((n, b) => n + b.seats, 0)
  return createPortal(
    <div className="print-sheet">
      <h1>{t('Manifiesto de buceo')}</h1>
      <p>
        <b>{centerName}</b> · {dateTime(trip.departs_at)}{trip.boats?.name ? ' · ' + trip.boats.name : ''}<br />
        {sites.length > 0 && <>{t('Puntos')}: {sites.join(', ')}<br /></>}
        {t('{n} inmersiones', { n: trip.num_dives })} · {t('mín. {level}', { level: levelName(trip.min_level) })} · {t('{n} buceadores', { n: seats })} · {trip.guides === 1 ? t('{n} guía', { n: 1 }) : t('{n} guías', { n: trip.guides })}
      </p>
      <table>
        <thead><tr>{cols.map(([k, h]) => <th key={k}>{h}</th>)}<th>{t('Nacionalidad')}</th><th>{t('Contacto de emergencia')}</th><th>{t('Firma')}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.n}>{cols.map(([k]) => <td key={k}>{r[k]}</td>)}<td /><td /><td /></tr>)}</tbody>
      </table>
      <p className="small">{t('Capitán')}: ____________________ · {t('Guía')}: ____________________ · {t('Hora de salida')}: ______ · {t('Hora de vuelta')}: ______</p>
      <p className="small">{t('Generado con DivingSlot')} · {dateTime(new Date().toISOString())}</p>
    </div>,
    document.body,
  )
}
