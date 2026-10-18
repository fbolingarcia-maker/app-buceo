import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
const [role, route, sel, out] = process.argv.slice(2)
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 375, height: 812 } })
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort())
await ctx.addInitScript((r) => { localStorage.setItem('mockRole', r) }, role)
const p = await ctx.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto('http://127.0.0.1:8765/index.html#' + route, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(500)
if (sel && sel !== '-') { await p.locator(sel).first().click(); await p.waitForTimeout(400) }
await p.screenshot({ path: out, fullPage: process.env.FULL !== '0' })
console.log('errors:', errs.join(' | ') || 'none')
await b.close()
