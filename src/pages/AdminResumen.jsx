import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { t } from '../lib/i18n'
import { php, dateTime, dayLabel, sourceName } from '../lib/format'

// Cuadro de mando de la plataforma (solo administradores): usuarios, centros, salidas, reservas, cobros y alertas.
// Todos los datos vienen de admin_dashboard() en una sola llamada.
const PERIODS = [7, 30, 90, 365]
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0)
const STATUS = { pending_payment: 'Pendiente de pago', confirmed: 'Confirmada', cancelled_by_diver: 'Cancelada por el buceador', cancelled_by_center: 'Cancelada por el centro' }
const METHOD = { cash: 'Efectivo', card: 'Tarjeta', gcash: 'GCash', demo: 'Demo' }

export default function AdminResumen({ go }) {
  const [days, setDays] = useState(30)
  const [demo, setDemo] = useState(false)
  const [r, setR] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setR(null); setErr('')
    supabase.rpc('admin_dashboard', { p_days: days, p_demo: demo }).then(({ data, error }) => {
      if (error) setErr(errMsg(error)); else setR(data)
    })
  }, [days, demo])

  const u = r?.users, c = r?.centers, tr = r?.trips, b = r?.bookings, p = r?.payments, a = r?.alerts
  const alerts = a ? [
    a.centers_pending > 0 && { text: t('{n} centros esperan validación', { n: a.centers_pending }), to: 'centers' },
    a.unpaid_soon > 0 && { text: t('{n} reservas con pago pendiente salen en menos de 48 h', { n: a.unpaid_soon }) },
    a.expired_holds > 0 && { text: t('{n} reservas sin pagar con la plaza ya caducada', { n: a.expired_holds }) },
    p?.failed > 0 && { text: t('{n} pagos online fallidos en el periodo', { n: p.failed }) },
  ].filter(Boolean) : []

  return (
    <>
      <div className="row between wrap" style={{ gap: 8 }}>
        <h1 style={{ margin: 0 }}><span aria-hidden>📊</span> {t('Resumen')}</h1>
        <div className="row wrap" style={{ gap: 6 }}>
          <div className="seg" role="group" aria-label={t('Periodo')}>
            {PERIODS.map((n) => <button key={n} type="button" className={days === n ? 'on' : ''} aria-pressed={days === n} onClick={() => setDays(n)}>{t('{n} días', { n })}</button>)}
          </div>
        </div>
      </div>
      <label className="check small" style={{ marginTop: 8 }}><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> {t('Incluir centros de demostración')}</label>

      {err && <div className="msg err" role="alert">{err}</div>}
      {!r && !err && <p className="muted">{t('Cargando…')}</p>}
      {r && <>
        {alerts.length > 0 && (
          <div className="msg err" role="status" style={{ marginTop: 10 }}>
            <b>⚠️ {t('Requiere atención')}</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {alerts.map((x, i) => <li key={i}>{x.to ? <a href="#/admin" onClick={(e) => { e.preventDefault(); go(x.to) }}>{x.text}</a> : x.text}</li>)}
            </ul>
          </div>
        )}

        <h3>{t('Negocio')} <span className="muted small">· {t('últimos {n} días', { n: r.days })}</span></h3>
        <div className="kpis">
          <Kpi label={t('Facturado')} value={php(b.gross)} sub={t('{n} buceadores', { n: b.divers })} />
          <Kpi label={t('Cobrado')} value={php(b.collected)} sub={t('{p} % de lo facturado', { p: pct(b.collected, b.gross) })} />
          <Kpi label={t('Comisión DiveSlot')} value={php(b.commission)} sub={t('reembolsos {amount}', { amount: php(b.refunds) })} />
          <Kpi label={t('Pendiente de cobro')} value={php(b.outstanding)} sub={t('en salidas futuras')} />
        </div>
        <Bars title={t('Reservas por día')} data={b.per_day} value={(x) => x.n} label={(x) => t('{d}: {n} reservas · {amount}', { d: dayLabel(x.day), n: x.n, amount: php(x.php) })} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <Breakdown title={t('Reservas por estado')} rows={Object.entries(b.by_status || {}).map(([k, n]) => [t(STATUS[k] || k), n])} />
          <Breakdown title={t('Origen de las reservas')} rows={Object.entries(b.by_source || {}).map(([k, n]) => [sourceName(k), n])} />
        </div>
        <Breakdown title={t('Cobrado por método')} rows={Object.entries(p.by_method || {}).map(([k, v]) => [t(METHOD[k] || k), v])} money />

        <h3>{t('Salidas')} <span className="muted small">· {t('próximos {n} días', { n: r.days })}</span></h3>
        <div className="kpis">
          <Kpi label={t('Salidas publicadas')} value={tr.upcoming} sub={t('{n} sin ninguna reserva', { n: tr.empty_upcoming })} />
          <Kpi label={t('Ocupación')} value={pct(tr.seats_booked, tr.seats_total) + ' %'} sub={tr.seats_booked + '/' + tr.seats_total} />
          <Kpi label={t('Completadas')} value={tr.completed} sub={t('últimos {n} días', { n: r.days })} />
          <Kpi label={t('Canceladas por mal tiempo')} value={tr.cancelled_weather} sub={t('{n} borradores', { n: tr.drafts })} />
        </div>

        <h3>{t('Usuarios')}</h3>
        <div className="kpis">
          <Kpi label={t('Usuarios')} value={u.total} sub={t('{a} buceadores · {b} centros', { a: u.divers, b: u.center_accounts })} />
          <Kpi label={t('Nuevos')} value={u.new} sub={t('últimos {n} días', { n: r.days })} />
          <Kpi label={t('Activos')} value={u.active} sub={t('han entrado en el periodo')} />
          <Kpi label={t('Sin confirmar email')} value={u.unconfirmed} sub={t('{n} certificaciones sin verificar', { n: r.activity.certs_unverified })} />
        </div>
        <Bars title={t('Altas por día')} data={u.signups} value={(x) => x.n} label={(x) => t('{d}: {n} altas', { d: dayLabel(x.day), n: x.n })} />
        <Breakdown title={t('Países')} rows={(u.countries || []).map((x) => [x.country, x.n])} />

        <h3>{t('Centros')}</h3>
        <div className="kpis">
          <Kpi label={t('Verificados')} value={c.by_status?.verified || 0} sub={t('{n} nuevos en el periodo', { n: c.new })} />
          <Kpi label={t('En revisión')} value={c.by_status?.pending || 0} sub={t('{n} reclaman ficha', { n: c.claims_pending })} />
          <Kpi label={t('Sin verificar')} value={c.by_status?.unverified || 0} sub={t('{a} rechazados · {b} suspendidos', { a: c.by_status?.rejected || 0, b: c.by_status?.suspended || 0 })} />
          <Kpi label={t('Directorio')} value={c.directory} sub={t('fichas públicas sin cuenta')} />
        </div>
        <Breakdown title={t('Centros verificados por destino')} rows={(c.by_destination || []).map((x) => [x.destination, x.n])} />

        <div className="card">
          <b>{t('Centros con más ventas')}</b> <span className="muted small">· {t('últimos {n} días', { n: r.days })}</span>
          {c.top?.length ? (
            <table className="small" style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}>
              <thead><tr className="muted"><th style={{ textAlign: 'left' }}>{t('Centro')}</th><th style={{ textAlign: 'right' }}>{t('Reservas')}</th><th style={{ textAlign: 'right' }}>{t('Facturado')}</th></tr></thead>
              <tbody>{c.top.map((x) => (
                <tr key={x.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '6px 4px 6px 0' }}><a href={'#/c/' + x.id}>{x.name}</a><div className="muted">{x.destination}</div></td>
                  <td style={{ textAlign: 'right' }}>{x.bookings}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{php(x.revenue)}</td>
                </tr>))}
              </tbody>
            </table>
          ) : <p className="muted small" style={{ marginBottom: 0 }}>{t('Sin reservas en el periodo.')}</p>}
        </div>

        <p className="muted small">{t('Bitácora: {n} inmersiones registradas en el periodo', { n: r.activity.dive_logs })} · {t('Actualizado {d}', { d: dateTime(r.generated_at) })}</p>
      </>}
    </>
  )
}

function Kpi({ label, value, sub }) {
  return <div className="kpi"><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>
}

// Barras verticales de una sola serie (un solo color, sin leyenda: el título la nombra). Tooltip al pasar/tocar cada barra.
function Bars({ title, data, value, label }) {
  const [hover, setHover] = useState(null)
  const vals = (data || []).map(value)
  const max = Math.max(1, ...vals)
  const total = vals.reduce((s, v) => s + v, 0)
  const W = 300, H = 90, n = vals.length || 1, gap = n > 60 ? 0.5 : 2, bw = Math.max(1, (W - gap * (n - 1)) / n)
  const sel = hover != null ? data[hover] : null
  return (
    <div className="card">
      <div className="row between"><b>{title}</b><span className="muted small">{t('Total: {n}', { n: total })}</span></div>
      <svg viewBox={'0 0 ' + W + ' ' + (H + 2)} width="100%" height="110" preserveAspectRatio="none" role="img" aria-label={title + ' · ' + t('Total: {n}', { n: total })} style={{ display: 'block', marginTop: 6 }} onMouseLeave={() => setHover(null)}>
        <line x1="0" y1={H + 1} x2={W} y2={H + 1} stroke="var(--line)" strokeWidth="1" />
        {vals.map((v, i) => {
          const h = v ? Math.max(3, (v / max) * H) : 0
          const x = i * (bw + gap)
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={x} y="0" width={bw + gap} height={H + 2} fill="transparent" />
              {h > 0 && <rect x={x} y={H + 1 - h} width={bw} height={h} rx={Math.min(2, bw / 2)} fill="var(--brand)" opacity={hover == null || hover === i ? 1 : 0.45} />}
              <title>{label(data[i])}</title>
            </g>
          )
        })}
      </svg>
      <div className="row between small muted" style={{ marginTop: 2 }}>
        <span>{data?.length ? dayLabel(data[0].day) : ''}</span>
        <span aria-live="polite">{sel ? label(sel) : ''}</span>
        <span>{data?.length ? dayLabel(data[data.length - 1].day) : ''}</span>
      </div>
    </div>
  )
}

// Reparto en barras horizontales con la cifra escrita al lado (nunca solo color)
function Breakdown({ title, rows, money }) {
  const total = rows.reduce((s, [, v]) => s + Number(v || 0), 0)
  const sorted = [...rows].sort((x, y) => y[1] - x[1])
  return (
    <div className="card">
      <b>{title}</b>
      {sorted.length === 0 && <p className="muted small" style={{ marginBottom: 0 }}>{t('Sin datos en el periodo.')}</p>}
      {sorted.map(([k, v]) => (
        <div key={k} style={{ marginTop: 8 }}>
          <div className="row between small"><span>{k}</span><span>{money ? php(v) : v} <span className="muted">· {pct(v, total)} %</span></span></div>
          <div className="bar" style={{ marginTop: 3 }}><div style={{ width: pct(v, total) + '%', background: 'var(--brand)' }} /></div>
        </div>
      ))}
    </div>
  )
}

