// Pruebas de la importación de inmersiones (src/lib/diveImport.js): node --no-warnings worker/test/bitacora-import.mjs
// Genera un FIT de una inmersión (como un Garmin Descent) y prueba también UDDF, Subsurface XML, CSV y un ZIP.
import { parseFit, parseUddf, parseSubsurface, parseCsv, parseDiveFile } from '../../src/lib/diveImport.js'
import zlib from 'node:zlib'

let fails = 0, passes = 0
const ok = (c, name, extra) => { if (c) passes++; else { fails++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '') } }

// ── FIT mínimo: activity (34) con hora local, dive_gas (259), session (18) y records (20), uno con marca comprimida ──
function fit() {
  const b = []
  const u8 = (v) => b.push(v & 0xff)
  const u16 = (v) => { u8(v); u8(v >> 8) }
  const u32 = (v) => { u16(v & 0xffff); u16(v >>> 16) }
  const def = (local, g, fields) => { u8(0x40 | local); u8(0); u8(0); u16(g); u8(fields.length); for (const [n, s, t] of fields) { u8(n); u8(s); u8(t) } }
  const FIT = 631065600
  const start = Date.UTC(2026, 9, 20, 0, 30, 0) / 1000 - FIT // 08:30 en Manila (UTC+8)
  def(0, 34, [[253, 4, 0x86], [5, 4, 0x86]]); u8(0); u32(start + 3000); u32(start + 3000 + 8 * 3600)
  def(1, 259, [[1, 1, 0x02], [2, 1, 0x00]]); u8(1); u8(32); u8(1)
  def(2, 18, [[253, 4, 0x86], [2, 4, 0x86], [7, 4, 0x86]]); u8(2); u32(start + 2700); u32(start); u32(2700 * 1000)
  def(3, 20, [[253, 4, 0x86], [92, 4, 0x86], [13, 1, 0x01]])
  const prof = [[0, 0.3], [60, 8], [600, 22.4], [1500, 18], [2400, 5], [2640, 0.4]]
  for (const [s, d] of prof) { u8(3); u32(start + s); u32(Math.round(d * 1000)); u8(s > 500 ? 27 : 29) }
  // marca de tiempo comprimida: local 3, +2 s respecto al último record
  u8(0x80 | (3 << 5) | ((start + 2642) & 0x1f)); u32(0); u32(300); u8(28) // el campo 253 se toma de la cabecera
  const data = Uint8Array.from(b)
  const head = new Uint8Array(14)
  const dv = new DataView(head.buffer)
  head[0] = 14; head[1] = 0x20; dv.setUint16(2, 2132, true); dv.setUint32(4, data.length, true); head.set([46, 70, 73, 84], 8)
  return Uint8Array.from([...head, ...data, 0, 0])
}
const f = parseFit(fit())
ok(f.length === 1 && f[0].dive_date === '2026-10-20' && f[0].entry_time === '08:31', 'FIT: fecha y hora local (entra al agua a 8 m)', f)
ok(f[0]?.max_depth_m === 22.4 && f[0].duration_min === 39 && f[0].water_temp_c === 27 && f[0].gas === 'nitrox' && f[0].o2_pct === 32, 'FIT: profundidad, tiempo, temperatura y nitrox', f[0])

// ZIP con el FIT dentro (deflate), como «Exportar original» de Garmin Connect
const raw = fit(), comp = zlib.deflateRawSync(raw)
const name = Buffer.from('12345_ACTIVITY.fit')
const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26)
const z = await parseDiveFile('activity.zip', new Uint8Array(Buffer.concat([lh, name, comp])))
ok(z.length === 1 && z[0].max_depth_m === 22.4, 'ZIP de Garmin Connect', z)

const uddf = `<?xml version="1.0"?><uddf version="3.2.1"><gasdefinitions><mix id="ean32"><o2>0.32</o2></mix></gasdefinitions>
<divesite><site id="s1"><name>Balicasag &amp; Black Forest</name></site></divesite>
<profiledata><repetitiongroup><dive id="d1"><informationbeforedive><link ref="s1"/><datetime>2026-10-21T09:05:00</datetime></informationbeforedive>
<samples><waypoint><divetime>0</divetime><depth>0</depth><switchmix ref="ean32"/></waypoint><waypoint><divetime>600</divetime><depth>24.6</depth><temperature>300.15</temperature></waypoint><waypoint><divetime>3000</divetime><depth>3</depth></waypoint></samples>
<informationafterdive><greatestdepth>24.6</greatestdepth><diveduration>3060</diveduration><lowesttemperature>300.15</lowesttemperature></informationafterdive></dive></repetitiongroup></profiledata></uddf>`
const u = parseUddf(uddf)
ok(u.length === 1 && u[0].site_name === 'Balicasag & Black Forest' && u[0].entry_time === '09:05' && u[0].duration_min === 51 && u[0].water_temp_c === 27 && u[0].o2_pct === 32, 'UDDF (Shearwater Cloud, Subsurface)', u)

const ssrf = `<divelog program='subsurface' version='3'><divesites><site uuid='ab12' name='Pescador Island'/></divesites><dives>
<dive number='12' divesiteid='ab12' date='2026-09-02' time='14:20:00' duration='48:30 min'><cylinder size='11.1 l' o2='30.0%' start='200.0 bar' end='60.0 bar' />
<divecomputer model='Suunto D5'><depth max='31.2 m' mean='16.4 m' /><temperature water='28.0 C' /></divecomputer></dive></dives></divelog>`
const s = parseSubsurface(ssrf)
ok(s.length === 1 && s[0].site_name === 'Pescador Island' && s[0].duration_min === 49 && s[0].max_depth_m === 31.2 && s[0].tank_end_bar === 60 && s[0].o2_pct === 30, 'XML de Subsurface', s)

const csv = 'dive number,date,time,duration [min],maxdepth [m],avgdepth [m],watertemp [C],location\n1,2026-08-01,10:15,45:00,18.5,10.2,29,"Napaling, Panglao"\n2,03/08/2026,08:00,52,22,12,28.5,Doljo'
const c = parseCsv(csv)
ok(c.length === 2 && c[0].site_name === 'Napaling, Panglao' && c[0].duration_min === 45 && c[1].dive_date === '2026-08-03' && c[1].max_depth_m === 22, 'CSV (Subsurface u hoja de cálculo)', c)
ok((await parseDiveFile('x.uddf', new TextEncoder().encode(uddf))).length === 1, 'detecta el formato por el contenido')

console.log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
