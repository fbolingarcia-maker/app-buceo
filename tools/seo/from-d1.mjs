// Convierte la salida de «wrangler d1 execute … --json --file tools/seo/datos.sql» en tools/seo/datos.json.
// Uso (desde la raíz del repo, con wrangler con sesión en la cuenta de Cloudflare):
//   npx wrangler d1 execute diveslot --remote --json --file tools/seo/datos.sql | node tools/seo/from-d1.mjs
//   node tools/seo/gen-destinos.mjs
// También vale pegar el valor de la columna «data» (un JSON) por la entrada estándar.
import fs from 'node:fs'

const input = fs.readFileSync(0, 'utf8').trim()
let parsed = JSON.parse(input)
if (Array.isArray(parsed)) parsed = parsed[0]?.results?.[0]?.data ?? parsed
if (typeof parsed === 'string') parsed = JSON.parse(parsed)
const { destinations, sites, centers } = parsed || {}
if (!Array.isArray(destinations) || !Array.isArray(sites) || !Array.isArray(centers)) {
  console.error('La entrada no tiene destinations, sites y centers. ¿Es la salida de tools/seo/datos.sql?')
  process.exit(1)
}
const out = new URL('./datos.json', import.meta.url)
fs.writeFileSync(out, JSON.stringify({ sites, centers, destinations }, null, 1) + '\n')
console.log(`datos.json: ${destinations.length} destinos, ${sites.length} puntos, ${centers.length} centros`)
