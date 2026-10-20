// Genera tools/smoke/lucide-shim.js: los iconos de Lucide que usa la app, con la misma API que lucide-react
// (size, strokeWidth, color, className…). Solo para las pruebas de humo sin red: en producción se usa lucide-react de npm.
// Uso: node gen-lucide-shim.mjs <carpeta icons/ del repo lucide-icons/lucide>
//   (git clone --depth 1 --filter=blob:none --sparse https://github.com/lucide-icons/lucide && git sparse-checkout set icons)
import fs from 'node:fs'
import path from 'node:path'

const ICONS = process.argv[2]
if (!ICONS) { console.error('Falta la carpeta icons/ de lucide'); process.exit(1) }
const APP = new URL('../..', import.meta.url).pathname
const S = new URL('.', import.meta.url).pathname

// Nombres importados de 'lucide-react' en src/
const names = new Set()
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name)
  if (e.isDirectory()) return walk(p)
  if (!/\.(jsx?|mjs)$/.test(e.name)) return
  const src = fs.readFileSync(p, 'utf8')
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g)) m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((n) => names.add(n))
})
walk(path.join(APP, 'src'))

// Alias (nombres antiguos que lucide-react sigue exportando, p. ej. Waves → waves-horizontal)
const alias = {}
for (const f of fs.readdirSync(ICONS).filter((f) => f.endsWith('.json'))) {
  const meta = JSON.parse(fs.readFileSync(path.join(ICONS, f), 'utf8'))
  for (const a of meta.aliases || []) alias[typeof a === 'string' ? a : a.name] = f.replace(/\.json$/, '')
}
const kebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').replace(/([a-zA-Z])(\d)/g, '$1-$2').toLowerCase()

const out = [`// Generado por gen-lucide-shim.mjs — iconos de Lucide (licencia ISC, https://lucide.dev). No editar a mano.`,
  `import { createElement as h, forwardRef } from 'react'`,
  `const make = (name, nodes) => { const C = forwardRef(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '', children, ...rest }, ref) =>`,
  `  h('svg', { ref, xmlns: 'http://www.w3.org/2000/svg', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', className: ('lucide ' + className).trim(), ...rest },`,
  `    ...nodes.map(([t, a], i) => h(t, { key: i, ...a })), children)); C.displayName = name; return C }`]
const missing = []
for (const n of [...names].sort()) {
  let k = kebab(n)
  if (!fs.existsSync(path.join(ICONS, k + '.svg'))) k = alias[k] || k
  const file = path.join(ICONS, k + '.svg')
  if (!fs.existsSync(file)) { missing.push(n); continue }
  const svg = fs.readFileSync(file, 'utf8').replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '')
  const nodes = [...svg.matchAll(/<(\w+)([^>]*?)\/?>/g)].map(([, tag, attrs]) => [tag, Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, a, v]) => [a.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]))])
  out.push(`export const ${n} = make('${n}', ${JSON.stringify(nodes)})`)
}
if (missing.length) { console.error('No encontrados en Lucide:', missing.join(', ')); process.exit(1) }
fs.writeFileSync(path.join(S, 'lucide-shim.js'), out.join('\n') + '\n')
console.log('lucide-shim.js:', names.size, 'iconos')
