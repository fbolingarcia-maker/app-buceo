// MP4 mínimo (una pista de vídeo H.264) para «Mi ruta en vídeo»: recibe los fragmentos de VideoEncoder (WebCodecs,
// formato «avc») y los envuelve en ftyp + moov + mdat con «faststart» (moov delante), listo para Instagram y WhatsApp.
// Sin B-frames: el codificador va en modo «realtime», así que el orden de decodificación = el de presentación.

const enc = new TextEncoder()
function box(type, ...parts) {
  const body = parts.flat()
  const len = 8 + body.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(len)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, len); out.set(enc.encode(type), 4)
  let o = 8
  for (const p of body) { out.set(p, o); o += p.length }
  return out
}
const u8 = (...v) => new Uint8Array(v)
const u16 = (v) => u8((v >> 8) & 255, v & 255)
const u32 = (v) => u8((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255)
const zeros = (n) => new Uint8Array(n)
const full = (v, flags) => u8(v, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255)
const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32)

// samples: [{ data: Uint8Array, key: bool }], avcC: Uint8Array (VideoDecoderConfig.description)
export function muxMp4({ width, height, fps, samples, avcC }) {
  const timescale = fps * 1000, delta = 1000
  const n = samples.length, dur = n * delta, durMs = Math.round((n / fps) * 1000)
  const ftyp = box('ftyp', enc.encode('isom'), u32(512), enc.encode('isomiso2avc1mp41'))
  const avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box('avcC', avcC))
  const sizes = samples.map((s) => u32(s.data.length))
  const sync = samples.map((s, i) => (s.key ? u32(i + 1) : null)).filter(Boolean)
  const stbl = (offset) => box('stbl',
    box('stsd', full(0, 0), u32(1), avc1),
    box('stts', full(0, 0), u32(1), u32(n), u32(delta)),
    box('stss', full(0, 0), u32(sync.length), sync),
    box('stsc', full(0, 0), u32(1), u32(1), u32(n), u32(1)),
    box('stsz', full(0, 0), u32(0), u32(n), sizes),
    box('stco', full(0, 0), u32(1), u32(offset)))
  const moov = (offset) => box('moov',
    box('mvhd', full(0, 0), u32(0), u32(0), u32(1000), u32(durMs), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
    box('trak',
      box('tkhd', full(0, 3), u32(0), u32(0), u32(1), u32(0), u32(durMs), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
      box('mdia',
        box('mdhd', full(0, 0), u32(0), u32(0), u32(timescale), u32(dur), u16(0x55c4), u16(0)),
        box('hdlr', full(0, 0), u32(0), enc.encode('vide'), zeros(12), enc.encode('VideoHandler\0')),
        box('minf',
          box('vmhd', full(0, 1), zeros(8)),
          box('dinf', box('dref', full(0, 0), u32(1), box('url ', full(0, 1)))),
          stbl(offset)))))
  // El desplazamiento de los datos depende del tamaño de moov, que no cambia con el valor de stco
  const moovLen = moov(0).length
  const offset = ftyp.length + moovLen + 8
  const total = samples.reduce((a, s) => a + s.data.length, 0)
  const mdatHead = new Uint8Array(8); new DataView(mdatHead.buffer).setUint32(0, 8 + total); mdatHead.set(enc.encode('mdat'), 4)
  return new Blob([ftyp, moov(offset), mdatHead, ...samples.map((s) => s.data)], { type: 'video/mp4' })
}
