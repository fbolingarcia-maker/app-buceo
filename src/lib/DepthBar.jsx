// Barra de profundidad de un punto: de su mínima a su máxima, coloreada con la escala de profundidad
const BANDS = [[0, 5, 'var(--depth-1)'], [5, 18, 'var(--depth-2)'], [18, 30, 'var(--depth-3)'], [30, 40, 'var(--depth-4)'], [40, 200, 'var(--depth-5)']]
export default function DepthBar({ min, max, scale = 40 }) {
  if (max == null) return <div className="depth-track" />
  const lo = Math.max(0, min ?? 0), hi = Math.min(max, scale)
  const span = Math.max(hi - lo, 1)
  const stops = BANDS.filter(([a, b]) => b > lo && a < hi).map(([a, b, c]) => {
    const s = ((Math.max(a, lo) - lo) / span) * 100, e = ((Math.min(b, hi) - lo) / span) * 100
    return c + ' ' + s + '% ' + e + '%'
  })
  return (
    <div className="depth-track" role="img" aria-label={(min ?? 0) + '–' + max + ' m'}>
      <i style={{ left: (lo / scale) * 100 + '%', width: ((hi - lo) / scale) * 100 + '%', background: 'linear-gradient(90deg, ' + stops.join(', ') + ')' }} />
    </div>
  )
}
