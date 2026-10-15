import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'

export default function Centros() {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('centers').select('id, name, area, locality, website, phone, listing_status, lat, lng')
      .neq('listing_status', 'cerrado').not('name', 'like', 'Demo%').order('name')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setList(data || []) })
  }, [])

  const shown = (list || []).filter((c) => (c.name + ' ' + (c.locality || '')).toLowerCase().includes(q.toLowerCase()))
  const byZone = shown.reduce((m, c) => { const k = c.locality || c.area; (m[k] = m[k] || []).push(c); return m }, {})

  return (
    <>
      <h1>Centros en Panglao</h1>
      <input placeholder="Buscar centro o zona…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {error && <div className="msg err">{error}</div>}
      {list === null && <p className="muted">Cargando…</p>}
      {Object.keys(byZone).sort().map((z) => (
        <div key={z}>
          <h2>{z}</h2>
          {byZone[z].map((c) => (
            <div key={c.id} className="card">
              <div className="row between">
                <b>{c.name}</b>
                {c.listing_status === 'socio' ? <span className="pill ok">Reserva en la app</span> : <span className="pill">Próximamente</span>}
              </div>
              <div className="row wrap small" style={{ marginTop: 6, gap: 14 }}>
                {c.website && <a href={c.website} target="_blank" rel="noreferrer">Web</a>}
                {c.lat && c.lng && <a href={`https://maps.google.com/?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer">Mapa</a>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
