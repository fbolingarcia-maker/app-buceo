// Descarga una tabla como CSV (con BOM para que Excel respete los acentos)
export function downloadCsv(filename, header, rows) {
  // Textos que Excel tomaría por fórmulas (=, +, -, @) van con un apóstrofo delante (inyección de fórmulas en CSV)
  const safe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v)
  const esc = (v) => { v = safe(v); return v == null ? '' : /[",\n;]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v) }
  const text = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
