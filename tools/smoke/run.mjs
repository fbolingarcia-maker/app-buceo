import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
const plan = {
  anon: ['/', '/centros', '/c/4ec918c7-1b17-477e-acb7-2c33276224ac', '/d/Panglao', '/puntos', '/salida/t1-1', '/login', '/reservas', '/admin'],
  diver: ['/', '/salida/t1-1', '/salida/t2-1', '/reservas', '/perfil', '/bitacora', '/login', '/admin'],
  center: ['/', '/perfil', '/centro', '/centro/agenda', '/centro/salidas', '/centro/nueva', '/centro/ajustes', '/centro/informes', '/centro/verificacion'],
  centerv: ['/centro', '/perfil', '/centro/agenda', '/centro/salidas', '/centro/verificacion'],
  centerr: ['/centro/verificacion', '/centro'],
  admin: ['/', '/admin', '/admin/centers', '/admin/users', '/admin/admins', '/admin/log', '/perfil', '/centro'],
  admind: ['/', '/perfil', '/reservas', '/admin'],
  adminc: ['/', '/centro', '/centro/agenda', '/centro/informes', '/perfil'],
  mfa: ['/', '/perfil', '/reservas'],
  vacio: ['/', '/d/Panglao', '/puntos'],
}
const shots = process.argv[2] === 'shots'
const only = (process.argv[3] || '').split(',').filter(Boolean)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch())
let fails = 0
for (const [role, routes] of Object.entries(plan)) {
  if (only.length && !only.includes(role)) continue
  for (const lang of ['es', 'en']) {
    if (lang === 'en' && !['anon', 'center', 'vacio'].includes(role)) continue
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 })
    await ctx.addInitScript(([r, l]) => { localStorage.setItem('mockRole', r); localStorage.setItem('lang', l) }, [role, lang])
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort())
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 200)) })
    for (const r of routes) {
      errs.length = 0
      await page.goto('http://127.0.0.1:8765/index.html#' + r, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(350)
      const txt = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140)
      const bad = errs.filter((e) => !/favicon|flagcdn|ERR_|Failed to load resource/.test(e))
      // Nada debe salirse de la pantalla de 375 px (botones que no caben, filas sin wrap…)
      const wide = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !e.closest('.days, .chips, .slots, table, .scroll-x') }).slice(0, 3).map((e) => e.tagName + '.' + (e.className?.baseVal ?? e.className) + ' «' + (e.textContent || '').trim().slice(0, 30) + '»'))
      if (wide.length) bad.push('DESBORDA ' + wide.join(', '))
      if (bad.length) fails++
      console.log(`[${role}/${lang}] ${r} :: ${bad.length ? 'ERR ' + bad.join(' | ') : 'ok'} :: ${txt}`)
      if (shots) await page.screenshot({ path: `shots/${role}-${lang}-${r.replace(/\W+/g, '_')}.png`, fullPage: true })
    }
    await ctx.close()
  }
}
await browser.close()
console.log('FAILS', fails)
