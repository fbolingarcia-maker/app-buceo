// Importar inmersiones del ordenador de buceo a la bitácora, todo en el navegador (el fichero no se sube):
// FIT (Garmin Descent, Suunto) · ZIP con FIT («Exportar original» de Garmin Connect) · UDDF (Shearwater Cloud,
// Subsurface, MacDive…) · XML de Subsurface · CSV. Devuelve filas con las columnas de dive_logs.

const FIT_EPOCH = 631065600 // 1989-12-31T00:00:00Z en segundos Unix
const SIZE = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 1, 8: 4, 9: 8, 10: 1, 11: 2, 12: 4, 13: 1, 14: 8, 15: 8, 16: 8 }
const pad = (n) => String(n).padStart(2, '0')
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10)

// Lee un valor FIT; los «inválidos» del formato pasan a null
function fitValue(dv, p, type, le) {
  switch (type & 0x1f) {
    case 0: case 2: case 10: case 13: { const v = dv.getUint8(p); return v === 0xff && (type & 0x1f) !== 10 ? null : v }
    case 1: { const v = dv.getInt8(p); return v === 0x7f ? null : v }
    case 3: { const v = dv.getInt16(p, le); return v === 0x7fff ? null : v }
    case 4: case 11: { const v = dv.getUint16(p, le); return v === 0xffff ? null : v }
    case 5: { const v = dv.getInt32(p, le); return v === 0x7fffffff ? null : v }
    case 6: case 12: { const v = dv.getUint32(p, le); return v === 0xffffffff ? null : v }
    case 8: return dv.getFloat32(p, le)
    case 9: return dv.getFloat64(p, le)
    default: return null
  }
}

export function parseFit(u8) {
  if (u8.length < 14 || String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) !== '.FIT') throw new Error('no es un fichero FIT')
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const hs = u8[0], end = Math.min(u8.length, hs + dv.getUint32(4, true))
  const defs = {}
  const recs = [], sessions = [], gases = []
  let lastTs = 0, offset = null, p = hs
  const read = (d) => {
    if (p + d.fields.reduce((s, f) => s + f.size, 0) + d.devSize > u8.length) throw new Error('FIT incompleto')
    const v = {}
    for (const f of d.fields) {
      if (SIZE[f.type & 0x1f] === f.size) v[f.num] = fitValue(dv, p, f.type, d.le)
      p += f.size
    }
    p += d.devSize
    return v
  }
  const handle = (g, v) => {
    if (v[253] != null) lastTs = v[253]
    if (g === 20) recs.push({ ts: v[253], depth: v[92] == null ? null : v[92] / 1000, temp: v[13] })
    else if (g === 18) sessions.push({ start: v[2] ?? v[253], elapsed: v[7] == null ? null : v[7] / 1000 })
    else if (g === 259) gases.push({ o2: v[1], status: v[2] })
    else if (g === 34 && v[5] != null && v[253] != null) offset = v[5] - v[253]
  }
  while (p < end) {
    const h = u8[p++]
    if (h & 0x80) { // cabecera con marca de tiempo comprimida
      const d = defs[(h >> 5) & 3]
      if (!d) throw new Error('FIT dañado')
      const off = h & 0x1f
      let ts = (lastTs & ~0x1f) + off
      if (off < (lastTs & 0x1f)) ts += 0x20
      const v = read(d); v[253] = ts; handle(d.g, v)
    } else if (h & 0x40) { // definición
      p++
      const le = u8[p++] === 0
      const g = dv.getUint16(p, le); p += 2
      const n = u8[p++], fields = []
      for (let i = 0; i < n; i++, p += 3) fields.push({ num: u8[p], size: u8[p + 1], type: u8[p + 2] })
      let devSize = 0
      if (h & 0x20) { const nd = u8[p++]; for (let i = 0; i < nd; i++, p += 3) devSize += u8[p + 1] }
      defs[h & 0x0f] = { g, le, fields, devSize }
    } else {
      const d = defs[h & 0x0f]
      if (!d) throw new Error('FIT dañado')
      handle(d.g, read(d))
    }
  }
  const gas = gases.find((x) => x.status !== 0 && x.o2 > 21 && x.o2 <= 100)
  const tz = offset ?? -new Date().getTimezoneOffset() * 60
  const spans = sessions.length ? sessions.map((s) => [s.start, s.start + (s.elapsed ?? 86400) + 60]) : [[-Infinity, Infinity]]
  return spans.map(([a, b]) => {
    const rs = recs.filter((r) => r.ts != null && r.ts >= a && r.ts <= b)
    const wet = rs.filter((r) => r.depth != null && r.depth > 0.5)
    if (!wet.length) return null
    const start = wet[0].ts, last = wet[wet.length - 1].ts
    const local = new Date((start + FIT_EPOCH + tz) * 1000)
    const temps = rs.map((r) => r.temp).filter((x) => x != null)
    return {
      dive_date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
      entry_time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
      max_depth_m: r1(Math.max(...wet.map((r) => r.depth))),
      avg_depth_m: r1(wet.reduce((s, r) => s + r.depth, 0) / wet.length),
      duration_min: Math.max(1, Math.round((last - start) / 60)),
      water_temp_c: temps.length ? Math.min(...temps) : null,
      gas: gas ? 'nitrox' : 'air', o2_pct: gas ? gas.o2 : null,
    }
  }).filter(Boolean)
}

// ── XML (UDDF y Subsurface) con expresiones sencillas: funciona igual en el navegador y en Node ──
const tag = (s, name) => { const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(s); return m ? m[1].trim() : null }
const tags = (s, name) => [...s.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => ({ attrs: m[1], body: m[2] }))
const attr = (s, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(s || ''); return m ? m[2] : null }
const num = (x) => { const v = parseFloat(String(x ?? '').replace(',', '.')); return Number.isFinite(v) ? v : null }
const unxml = (s) => s?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&') ?? null

export function parseUddf(xml) {
  const sites = Object.fromEntries(tags(xml, 'site').map((s) => [attr(s.attrs, 'id'), unxml(tag(s.body, 'name'))]))
  const mixes = Object.fromEntries(tags(xml, 'mix').map((m) => [attr(m.attrs, 'id'), num(tag(m.body, 'o2'))]))
  return tags(xml, 'dive').map(({ body }) => {
    const before = tag(body, 'informationbeforedive') || ''
    const after = tag(body, 'informationafterdive') || ''
    const dt = tag(before, 'datetime') || tag(body, 'datetime')
    if (!dt) return null
    const m = /(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(dt)
    if (!m) return null
    const depths = [...body.matchAll(/<depth>([\d.]+)<\/depth>/gi)].map((x) => +x[1])
    const times = [...body.matchAll(/<divetime>([\d.]+)<\/divetime>/gi)].map((x) => +x[1])
    const temps = [...body.matchAll(/<temperature>([\d.]+)<\/temperature>/gi)].map((x) => +x[1])
    const maxD = num(tag(after, 'greatestdepth')) ?? (depths.length ? Math.max(...depths) : null)
    const avgD = num(tag(after, 'averagedepth')) ?? (depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : null)
    const dur = num(tag(after, 'diveduration')) ?? (times.length ? Math.max(...times) : null)
    const tempK = num(tag(after, 'lowesttemperature')) ?? (temps.length ? Math.min(...temps) : null)
    const siteRef = attr((/<link\b[^>]*>/i.exec(before) || [''])[0], 'ref')
    const mixRef = attr((/<switchmix\b[^>]*>/i.exec(body) || [''])[0], 'ref')
    const o2 = mixRef && mixes[mixRef] != null ? Math.round(mixes[mixRef] <= 1 ? mixes[mixRef] * 100 : mixes[mixRef]) : null
    return {
      dive_date: `${m[1]}-${m[2]}-${m[3]}`, entry_time: m[4] ? `${m[4]}:${m[5]}` : null,
      max_depth_m: r1(maxD), avg_depth_m: r1(avgD), duration_min: dur == null ? null : Math.max(1, Math.round(dur / 60)),
      water_temp_c: tempK == null ? null : r1(tempK > 200 ? tempK - 273.15 : tempK), // UDDF usa kelvin
      site_name: (siteRef && sites[siteRef]) || null,
      gas: o2 && o2 > 21 ? 'nitrox' : 'air', o2_pct: o2 && o2 > 21 ? o2 : null,
    }
  }).filter(Boolean)
}

const minutes = (s) => {
  if (s == null) return null
  const m = /(\d+):(\d{2})(?::(\d{2}))?/.exec(s)
  if (m) return m[3] != null ? +m[1] * 60 + +m[2] + +m[3] / 60 : +m[1] + +m[2] / 60
  return num(s)
}
export function parseSubsurface(xml) {
  const sites = Object.fromEntries([...xml.matchAll(/<site\b([^>]*)>/gi)].map((m) => [attr(m[1], 'uuid'), unxml(attr(m[1], 'name'))]))
  return [...xml.matchAll(/<dive\b([^>]*)>([\s\S]*?)<\/dive>/gi)].map(([, a, body]) => {
    const date = attr(a, 'date')
    if (!date) return null
    const depth = (/<depth\b([^>]*)\/?>/i.exec(body) || [])[1]
    const temp = (/<temperature\b([^>]*)\/?>/i.exec(body) || [])[1]
    const cyl = (/<cylinder\b([^>]*)\/?>/i.exec(body) || [])[1]
    const o2 = num(attr(cyl, 'o2'))
    const loc = tag(body, 'location')
    return {
      dive_date: date, entry_time: attr(a, 'time')?.slice(0, 5) || null,
      max_depth_m: r1(num(attr(depth, 'max'))), avg_depth_m: r1(num(attr(depth, 'mean'))),
      duration_min: (() => { const v = minutes(attr(a, 'duration')); return v == null ? null : Math.max(1, Math.round(v)) })(),
      water_temp_c: r1(num(attr(temp, 'water'))),
      site_name: sites[attr(a, 'divesiteid')] || unxml(loc) || null,
      gas: o2 && o2 > 21 ? 'nitrox' : 'air', o2_pct: o2 && o2 > 21 ? Math.round(o2) : null,
      tank_start_bar: num(attr(cyl, 'start')) == null ? null : Math.round(num(attr(cyl, 'start'))),
      tank_end_bar: num(attr(cyl, 'end')) == null ? null : Math.round(num(attr(cyl, 'end'))),
    }
  }).filter(Boolean)
}

// ── CSV (Subsurface, hojas de cálculo, exportaciones de otras apps): columnas reconocidas por el nombre ──
function splitCsv(line, sep) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === sep) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((x) => x.trim())
}
function csvDate(s) {
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s || '')
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`
  m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s || '')
  if (!m) return null
  const [d, mo] = +m[2] > 12 ? [+m[2], +m[1]] : [+m[1], +m[2]] // día primero salvo que no pueda serlo
  return `${m[3]}-${pad(mo)}-${pad(d)}`
}
export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ','
  const head = splitCsv(lines[0], sep).map((h) => h.toLowerCase())
  const col = (...res) => head.findIndex((h) => res.some((r) => r.test(h)))
  const c = {
    date: col(/^dive_date$/, /\bdate\b/, /fecha/), time: col(/^entry_time$/, /\btime\b/, /hora/), dur: col(/duration/, /duraci/, /bottom time/, /^tiempo/),
    max: col(/max.?depth/, /maxdepth/, /prof.*m[aá]x/, /^max_depth_m$/), avg: col(/av(g|erage).?depth/, /mean/, /prof.*media/),
    temp: col(/water.?temp/, /watertemp/, /temp.*agua/, /^water_temp_c$/, /temperature/), site: col(/site/, /location/, /punto/, /lugar/),
    o2: col(/o2/, /oxygen/), start: col(/start.?pressure/, /startpressure/, /tank_start/), end: col(/end.?pressure/, /endpressure/, /tank_end/),
  }
  if (c.date < 0) throw new Error('falta la columna de fecha')
  return lines.slice(1).map((l) => {
    const v = splitCsv(l, sep)
    const get = (i) => (i >= 0 ? v[i] : null)
    const date = csvDate(get(c.date))
    if (!date) return null
    const tm = /(\d{1,2}):(\d{2})/.exec(get(c.time) || (c.time < 0 ? get(c.date) : '') || '')
    const durRaw = get(c.dur)
    const dur = durRaw && durRaw.includes(':') ? minutes(durRaw) : num(durRaw)
    const o2 = num(get(c.o2))
    return {
      dive_date: date, entry_time: tm ? `${pad(+tm[1])}:${tm[2]}` : null,
      max_depth_m: r1(num(get(c.max))), avg_depth_m: r1(num(get(c.avg))),
      duration_min: dur == null ? null : Math.max(1, Math.round(dur)), water_temp_c: r1(num(get(c.temp))),
      site_name: get(c.site) || null, gas: o2 && o2 > 21 ? 'nitrox' : 'air', o2_pct: o2 && o2 > 21 ? Math.round(o2) : null,
      tank_start_bar: num(get(c.start)) == null ? null : Math.round(num(get(c.start))), tank_end_bar: num(get(c.end)) == null ? null : Math.round(num(get(c.end))),
    }
  }).filter(Boolean)
}

// ZIP («Exportar original» de Garmin Connect): saca los .fit con DecompressionStream
async function unzipFits(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const out = []
  let p = 0
  while (p + 30 <= u8.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true), csize = dv.getUint32(p + 18, true)
    const nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true)
    const name = new TextDecoder().decode(u8.subarray(p + 30, p + 30 + nlen))
    const data = u8.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + csize)
    p += 30 + nlen + xlen + csize
    if (!/\.fit$/i.test(name)) continue
    if (method === 0) out.push(data)
    else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      out.push(new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()))
    }
  }
  return out
}

// Punto de entrada: un fichero → lista de inmersiones
export async function parseDiveFile(name, u8) {
  const lower = name.toLowerCase()
  if (u8[0] === 0x50 && u8[1] === 0x4b) return (await Promise.all((await unzipFits(u8)).map(parseFit))).flat()
  if (lower.endsWith('.fit') || (u8.length > 12 && String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) === '.FIT')) return parseFit(u8)
  const text = new TextDecoder().decode(u8)
  if (/<uddf\b/i.test(text)) return parseUddf(text)
  if (/<divelog\b|<dives\b/i.test(text)) return parseSubsurface(text)
  return parseCsv(text)
}
