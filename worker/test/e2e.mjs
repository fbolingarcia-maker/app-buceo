// Prueba de extremo a extremo SIN red: compila la app con VITE_BACKEND=cloudflare (cliente src/lib/cf-client.js),
// la sirve junto al Worker (D1 simulado con node:sqlite y datos de seed.mjs) y recorre las pantallas con Chromium por rol.
// Falla si hay errores de JavaScript, respuestas de error de la API inesperadas o algo se sale de 375 px.
//   node --no-warnings worker/test/e2e.mjs [shots] [roles,separados,por,comas]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import * as esbuild from '/opt/npm-tools/node_modules/esbuild/lib/main.js'
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import { D1, R2 } from './shim.mjs'
import { seed } from './seed.mjs'
import { handleApi } from '../index.js'
import { totpAt } from '../lib/crypto.js'

const APP = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const OUT = path.join(APP, 'worker/test/.e2e')
const SMOKE = path.join(APP, 'tools/smoke')
fs.mkdirSync(OUT, { recursive: true })
const FONTS = process.env.FONTSOURCE_DIR
await esbuild.build({
  entryPoints: [APP + '/src/main.jsx'], bundle: true, outdir: OUT + '/out', format: 'esm', jsx: 'automatic', loader: { '.js': 'jsx', '.woff2': 'file', '.woff': 'file' },
  define: { 'import.meta.env.VITE_BACKEND': '"cloudflare"', 'import.meta.env.VITE_SUPABASE_URL': 'undefined', 'import.meta.env.VITE_SUPABASE_KEY': 'undefined', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"' },
  alias: { '@supabase/supabase-js': SMOKE + '/mock-supabase.js', react: '/opt/npm-tools/node_modules/react', 'react-dom': '/opt/npm-tools/node_modules/react-dom' },
  plugins: [{ name: 'sin-red', setup(b) {
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: SMOKE + '/lucide-shim.js' }))
    b.onResolve({ filter: /^@fontsource\// }, (a) => { const p = FONTS && a.path.replace(/^@fontsource\//, FONTS + '/'); return p && fs.existsSync(p) ? { path: p } : { path: a.path, namespace: 'vacio' } })
    b.onLoad({ filter: /.*/, namespace: 'vacio' }, () => ({ contents: '', loader: 'css' }))
  } }],
  nodePaths: ['/opt/npm-tools/node_modules'], logLevel: 'error',
})
fs.writeFileSync(OUT + '/index.html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/out/main.css"></head><body><div id="root"></div><script type="module" src="/out/main.js"></script></body></html>')

const db = new D1(path.join(APP, 'worker/schema.sql'))
await seed(db)
const mails = []
const env = { DB: db, AUTH_SECRET: 'e2e-secreto-de-prueba-0123456789', EMAIL_DEV_LOG: '1', PBKDF2_ITER: '1000', DIVE_PHOTOS: new R2(), CENTER_DOCS: new R2() }
const log = console.log
console.log = (...a) => { if (a[0] === 'EMAIL (modo prueba)') mails.push(a); else log(...a) }

const PORT = 8766
const ORIGIN = `http://localhost:${PORT}`
const apiErrors = []
const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const url = new URL(req.url, ORIGIN)
  if (url.pathname.startsWith('/api/')) {
    const r = await handleApi(new Request(ORIGIN + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: 'manual' }), env, { waitUntil: () => {} })
    const body = Buffer.from(await r.arrayBuffer())
    if (r.status >= 400) apiErrors.push(`${r.status} ${req.method} ${url.pathname} ${chunks.length ? Buffer.concat(chunks).toString().slice(0, 160) : ''} → ${body.toString().slice(0, 160)}`)
    const h = {}
    r.headers.forEach((v, k) => { h[k] = v })
    res.writeHead(r.status, h); res.end(body); return
  }
  const file = url.pathname === '/' ? OUT + '/index.html' : path.join(OUT, path.normalize(url.pathname))
  if (!file.startsWith(OUT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(file))
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

// Cuenta con dos pasos activados (para el rol mfa)
const mfaSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
{
  const { encryptSecret } = await import('../lib/crypto.js')
  await db.prepare("INSERT INTO mfa_factors (id, user_id, secret_enc, status) VALUES ('f1', 'u-otro', ?, 'verified')").bind(await encryptSecret(env.AUTH_SECRET, mfaSecret)).run()
}

const plan = {
  anon: [null, ['/', '/centros', '/c/c1', '/d/Panglao', '/salida/t1-2', '/login', '/reservas', '/bitacora', '/admin']],
  diver: ['buzo', ['/', '/salida/t1-2', '/salida/t2-2', '/reservas', '/perfil', '/bitacora', '/bitacora/lg1', '/c/c1', '/admin']],
  center: ['nuevo', ['/', '/perfil', '/centro', '/centro/agenda', '/centro/salidas', '/centro/nueva', '/centro/ajustes', '/centro/informes', '/centro/verificacion']],
  centerv: ['centro', ['/centro', '/perfil', '/centro/agenda', '/centro/salidas', '/centro/salida/t1-4', '/centro/informes', '/centro/informes?ver=cobros', '/centro/informes?ver=clientes', '/centro/informes?ver=movimientos', '/centro/ajustes', '/centro/verificacion']],
  admin: ['admin', ['/', '/admin', '/admin/centers', '/admin/users', '/admin/admins', '/admin/log', '/perfil']],
  mfa: ['otro', ['/', '/perfil']],
}
const shots = process.argv[2] === 'shots'
const only = (process.argv[3] || '').split(',').filter(Boolean)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch())
let fails = 0
const report = (role, r, bad, txt) => { if (bad.length) fails++; log(`[${role}] ${r} :: ${bad.length ? 'ERR ' + bad.join(' | ') : 'ok'} :: ${txt}`) }
for (const [role, [who, routes]] of Object.entries(plan)) {
  if (only.length && !only.includes(role)) continue
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(() => { localStorage.setItem('lang', 'es') })
  await ctx.route(/^https?:\/\/(?!localhost:8766)/, (r) => r.abort())
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 200)) })
  await page.goto(ORIGIN + '/#/', { waitUntil: 'domcontentloaded' })
  if (who) {
    // Entrar con el formulario de verdad
    await page.goto(ORIGIN + '/#/login', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[type=email]')
    await page.fill('input[type=email]', `${who}@divingslot.test`)
    await page.fill('input[type=password]', 'Clave1234')
    await page.press('input[type=password], #mfa-code', 'Enter')
    await page.waitForTimeout(700)
    if (role === 'mfa') {
      const txt = await page.locator('main').innerText()
      const bad = /Verificación en dos pasos/.test(txt) ? [] : ['no pide el código']
      report(role, 'reto 2 pasos', bad, txt.replace(/\s+/g, ' ').slice(0, 100))
      await page.fill('#mfa-code', await totpAt(mfaSecret, Math.floor(Date.now() / 30000)))
      await page.press('input[type=password], #mfa-code', 'Enter')
      await page.waitForTimeout(700)
    }
  }
  for (const r of routes) {
    errs.length = 0; apiErrors.length = 0
    await page.goto(ORIGIN + '/#' + r, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    const txt = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140)
    const bad = errs.filter((e) => !/favicon|flagcdn|ERR_|Failed to load resource/.test(e))
    bad.push(...apiErrors.filter((e) => !/^403 POST \/api\/rpc\/center_private/.test(e)).map((e) => 'API ' + e))
    const wide = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !e.closest('.days, .chips, .slots, table, .scroll-x') }).slice(0, 3).map((e) => e.tagName + ' «' + (e.textContent || '').trim().slice(0, 30) + '»'))
    if (wide.length) bad.push('DESBORDA ' + wide.join(', '))
    report(role, r, bad, txt)
    if (shots) { fs.mkdirSync(OUT + '/shots', { recursive: true }); await page.screenshot({ path: `${OUT}/shots/${role}-${r.replace(/\W+/g, '_')}.png`, fullPage: true }) }
  }
  await ctx.close()
}
await browser.close()
server.close()
log('FAILS', fails)
process.exit(fails ? 1 : 0)
