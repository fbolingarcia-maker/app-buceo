// Páginas estáticas de destinos para buscadores (la app usa rutas con #, que Google no indexa bien):
//   /dive/ y /dive/<destino>          en inglés   (public/dive/index.html y public/dive/<destino>.html)
//   /es/buceo/ y /es/buceo/<destino>  en español (public/es/buceo/…)
// Cloudflare sirve <destino>.html en /dive/<destino> (html_handling «auto-trailing-slash»).
// Cada página tiene los puntos de buceo (nivel, profundidad, qué se ve), los centros del directorio, destinos cercanos
// y el botón a las salidas de la app. Sin JavaScript; el estilo es public/dive/dive.css. También regenera
// public/sitemap.xml.
//
// Datos: tools/seo/datos.json, una foto de las tablas públicas de Supabase (destinations, dive_sites y el directorio
// de centers). Para actualizarla, ejecuta en Supabase la consulta de tools/seo/README.md, guarda el resultado en
// datos.json y vuelve a ejecutar: node tools/seo/gen-destinos.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const SITE = 'https://divingslot.com'
const data = JSON.parse(fs.readFileSync(new URL('./datos.json', import.meta.url), 'utf8'))

// Igual que EXTRA_AREAS de src/lib/places.js: zonas que se bucean desde un destino
const EXTRA_AREAS = {
  Panglao: ['Balicasag', 'Pamilacan'],
  Dauin: ['Apo Island'],
  Dumaguete: ['Dauin', 'Apo Island'],
  Dalaguete: ['Oslob'],
  'Puerto Galera': ['Verde Island'],
  'Sogod Bay': ['Southern Leyte'],
  'Puerto Princesa': ['Tubbataha'],
}

const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const km = (a, b) => {
  const r = (x) => (x * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

const L = {
  en: {
    lang: 'en', base: '/dive/', other: 'es', appLang: 'en',
    indexTitle: 'Scuba diving destinations in the Philippines · DivingSlot',
    indexH1: 'Dive destinations in the Philippines',
    indexLead: (d, s, c) => `${d} destinations, ${s} dive sites and ${c} dive centres. Pick a place to see its dive sites, the level each one needs and who runs trips there.`,
    indexDesc: (d, s) => `Guide to ${d} scuba diving destinations in the Philippines: ${s} dive sites with depth, recommended level and marine life, plus local dive centres.`,
    title: (d) => `Scuba diving in ${d.name}, ${d.province} · Dive sites and centres · DivingSlot`,
    desc: (d, s, c) => `Diving in ${d.name} (${d.province}, ${d.island_group}): ${s} dive sites with depth, level and what you will see${c ? `, and ${c} dive centres` : ''}. Book boat dive trips on DivingSlot.`,
    h1: (d) => `Scuba diving in ${d.name}`,
    lead: (d, s, c) => `${d.province} · ${d.island_group}. ${s ? `${s} dive site${s === 1 ? '' : 's'}` : 'Dive sites coming soon'}${c ? ` and ${c} dive centre${c === 1 ? '' : 's'}` : ''}.`,
    cta: (d) => `See dive trips in ${d.name}`,
    ctaCentres: 'All dive centres',
    sites: 'Dive sites', centres: 'Dive centres', nearby: 'Nearby destinations', bookable: 'Book in the app',
    noSites: 'We have not listed dive sites here yet.',
    depth: (a, b) => (a != null && b ? `${a}–${b} m` : b ? `up to ${b} m` : ''),
    fee: (f) => `sanctuary fee ₱${f.toLocaleString('en-US')}`,
    levels: { open_water: 'Open Water', advanced: 'Advanced', rescue: 'Rescue', divemaster: 'Divemaster', instructor: 'Instructor' },
    levelFor: 'Recommended level',
    home: 'Home', destinations: 'Destinations', openApp: 'Open the app', switchTo: 'Español',
    privacy: 'Privacy', terms: 'Terms', contact: 'Contact',
    groups: { Luzon: 'Luzon', Visayas: 'Visayas', Mindanao: 'Mindanao', Mindoro: 'Mindoro', Palawan: 'Palawan' },
    km: (n) => `${n} km`,
    counts: (s, c) => `${s} site${s === 1 ? '' : 's'} · ${c} centre${c === 1 ? '' : 's'}`,
    note: 'Dive centre list from public sources and centres that joined DivingSlot. If something is out of date, write to divingslot@gmail.com.',
  },
  es: {
    lang: 'es', base: '/es/buceo/', other: 'en', appLang: 'es',
    indexTitle: 'Destinos de buceo en Filipinas · DivingSlot',
    indexH1: 'Destinos de buceo en Filipinas',
    indexLead: (d, s, c) => `${d} destinos, ${s} puntos de buceo y ${c} centros. Elige un lugar para ver sus puntos de buceo, el nivel que pide cada uno y quién sale a bucear allí.`,
    indexDesc: (d, s) => `Guía de ${d} destinos de buceo en Filipinas: ${s} puntos de buceo con profundidad, nivel recomendado y fauna, y los centros de buceo de cada zona.`,
    title: (d) => `Buceo en ${d.name}, ${d.province} · Puntos de buceo y centros · DivingSlot`,
    desc: (d, s, c) => `Bucear en ${d.name} (${d.province}, ${d.island_group}): ${s} puntos de buceo con profundidad, nivel y qué se ve${c ? `, y ${c} centros de buceo` : ''}. Reserva salidas en barco en DivingSlot.`,
    h1: (d) => `Buceo en ${d.name}`,
    lead: (d, s, c) => `${d.province} · ${d.island_group}. ${s ? `${s} punto${s === 1 ? '' : 's'} de buceo` : 'Pronto añadiremos puntos de buceo'}${c ? ` y ${c} centro${c === 1 ? '' : 's'} de buceo` : ''}.`,
    cta: (d) => `Ver salidas en ${d.name}`,
    ctaCentres: 'Todos los centros',
    sites: 'Puntos de buceo', centres: 'Centros de buceo', nearby: 'Destinos cercanos', bookable: 'Reserva en la app',
    noSites: 'Aún no hemos añadido puntos de buceo aquí.',
    depth: (a, b) => (a != null && b ? `${a}–${b} m` : b ? `hasta ${b} m` : ''),
    fee: (f) => `tasa del santuario ₱${f.toLocaleString('de-DE')}`,
    levels: { open_water: 'Open Water', advanced: 'Avanzado', rescue: 'Rescate', divemaster: 'Divemaster', instructor: 'Instructor' },
    levelFor: 'Nivel recomendado',
    home: 'Inicio', destinations: 'Destinos', openApp: 'Abrir la app', switchTo: 'English',
    privacy: 'Privacidad', terms: 'Términos', contact: 'Contacto',
    groups: { Luzon: 'Luzón', Visayas: 'Visayas', Mindanao: 'Mindanao', Mindoro: 'Mindoro', Palawan: 'Palawan' },
    km: (n) => `${n} km`,
    counts: (s, c) => `${s} punto${s === 1 ? '' : 's'} · ${c} centro${c === 1 ? '' : 's'}`,
    note: 'Lista de centros a partir de fuentes públicas y de los centros dados de alta en DivingSlot. Si algo no está al día, escribe a divingslot@gmail.com.',
  },
}

const dests = data.destinations
const sitesOf = (d) => {
  const areas = [d.name, ...(EXTRA_AREAS[d.name] || [])]
  return data.sites.filter((s) => areas.includes(s.area))
    .sort((a, b) => (a.area !== d.name) - (b.area !== d.name) || a.area.localeCompare(b.area) || a.name.localeCompare(b.name))
}
const centresOf = (d) => data.centers.filter((c) => c.dest === d.name).sort((a, b) => b.socio - a.socio || a.name.localeCompare(b.name))
const pageUrl = (l, d) => SITE + L[l].base + (d ? slug(d.name) : '')
const appUrl = (route) => '/app/#' + route

const FLAG = '<svg class="flag" viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" rx="2" fill="#d62828"/><polygon points="0,0 6,0 30,16 30,20 24,20 0,4" fill="#fff"/></svg>'

function layout(l, { title, desc, url, alt, h1, body, jsonld }) {
  const T = L[l]
  return `<!doctype html>
<html lang="${T.lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; base-uri 'self'; form-action 'self'; object-src 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="theme-color" content="#0a5a85">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="${T.lang}" href="${url}">
<link rel="alternate" hreflang="${L[T.other].lang}" href="${alt}">
<link rel="alternate" hreflang="x-default" href="${l === 'en' ? url : alt}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="DivingSlot">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:locale" content="${l === 'en' ? 'en_US' : 'es_ES'}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icon-192.png">
<link rel="stylesheet" href="/dive/dive.css">
<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>
</head>
<body>
<header class="top"><div class="wrap top-in">
<a href="/" class="brand" aria-label="DivingSlot">${FLAG}<span>DivingSlot</span></a>
<nav class="top-nav" aria-label="Main"><a href="${alt.replace(SITE, '')}" hreflang="${L[T.other].lang}" lang="${L[T.other].lang}">${T.switchTo}</a><a href="/app/" class="btn sm">${T.openApp}</a></nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="foot"><div class="wrap foot-in">
<span>© 2026 DivingSlot</span>
<nav aria-label="Footer"><a href="${T.base}">${T.destinations}</a><a href="/app/">${T.openApp}</a><a href="/legal/privacy.html">${T.privacy}</a><a href="/legal/terms.html">${T.terms}</a><a href="mailto:divingslot@gmail.com">${T.contact}</a></nav>
</div></footer>
</body>
</html>
`
}

function crumbs(l, d) {
  const T = L[l]
  return `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">${T.home}</a> <span aria-hidden="true">/</span> ${d ? `<a href="${T.base}">${T.destinations}</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(d.name)}</span>` : `<span aria-current="page">${T.destinations}</span>`}</nav>`
}

function destPage(l, d) {
  const T = L[l]
  const sites = sitesOf(d)
  const centres = centresOf(d)
  const near = dests.filter((x) => x !== d).map((x) => ({ x, k: km(d, x) })).sort((a, b) => a.k - b.k).slice(0, 4)
  const hl = (s) => (l === 'es' ? s.hl_es || s.hl : s.hl)
  const siteHtml = sites.length ? `<ul class="list">${sites.map((s) => {
    const meta = [s.area !== d.name ? esc(s.area) : '', T.depth(s.min, s.max), s.fee ? T.fee(s.fee) : ''].filter(Boolean).join(' · ')
    return `<li class="card"><div class="row"><h3>${esc(s.name)}</h3><span class="pill${s.level === 'advanced' ? ' warn' : ''}" title="${T.levelFor}">${T.levels[s.level] || esc(s.level)}</span></div>${meta ? `<p class="meta">${meta}</p>` : ''}${hl(s) ? `<p>${esc(hl(s))}</p>` : ''}</li>`
  }).join('')}</ul>` : `<p class="card muted">${T.noSites}</p>`
  const centreHtml = centres.length ? `<ul class="list cols">${centres.map((c) => `<li><a class="card row" href="${appUrl('/c/' + c.id)}"><span><b>${esc(c.name)}</b>${c.locality && c.locality !== d.name ? `<span class="meta"> · ${esc(c.locality)}</span>` : ''}</span>${c.socio ? `<span class="pill ok">${T.bookable}</span>` : ''}</a></li>`).join('')}</ul><p class="meta">${T.note}</p>` : ''
  const body = `${crumbs(l, d)}
<section class="hero"><h1>${esc(T.h1(d))}</h1><p class="lead">${esc(T.lead(d, sites.length, centres.length))}</p>
<p class="ctas"><a class="btn" href="${appUrl('/d/' + encodeURIComponent(d.name))}">${esc(T.cta(d))}</a></p></section>
<h2>${T.sites}${sites.length ? ` <span class="count">${sites.length}</span>` : ''}</h2>
${siteHtml}
${centres.length ? `<h2>${T.centres} <span class="count">${centres.length}</span></h2>\n${centreHtml}` : ''}
<h2>${T.nearby}</h2>
<ul class="chips">${near.map(({ x, k }) => `<li><a href="${T.base}${slug(x.name)}">${esc(x.name)} <span class="meta">${T.km(Math.round(k))}</span></a></li>`).join('')}</ul>`
  const url = pageUrl(l, d)
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'TouristDestination', name: d.name, url, description: T.desc(d, sites.length, centres.length), inLanguage: T.lang,
      geo: { '@type': 'GeoCoordinates', latitude: d.lat, longitude: d.lng },
      containedInPlace: { '@type': 'AdministrativeArea', name: d.province + ', Philippines' },
      touristType: 'Scuba divers',
      includesAttraction: sites.slice(0, 30).map((s) => ({ '@type': 'TouristAttraction', name: s.name, description: hl(s) || undefined })) },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: T.home, item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: T.destinations, item: pageUrl(l) },
      { '@type': 'ListItem', position: 3, name: d.name, item: url },
    ] },
  ] }
  return layout(l, { title: T.title(d), desc: T.desc(d, sites.length, centres.length), url, alt: pageUrl(T.other, d), body, jsonld })
}

function indexPage(l) {
  const T = L[l]
  const groups = {}
  for (const d of dests) (groups[d.island_group] ||= []).push(d)
  const order = ['Luzon', 'Mindoro', 'Visayas', 'Palawan', 'Mindanao'].filter((g) => groups[g]).concat(Object.keys(groups).filter((g) => !['Luzon', 'Mindoro', 'Visayas', 'Palawan', 'Mindanao'].includes(g)))
  const body = `${crumbs(l)}
<section class="hero"><h1>${T.indexH1}</h1><p class="lead">${esc(T.indexLead(dests.length, data.sites.length, data.centers.length))}</p>
<p class="ctas"><a class="btn" href="/app/">${T.openApp}</a> <a class="btn ghost" href="${appUrl('/centros')}">${T.ctaCentres}</a></p></section>
${order.map((g) => `<h2>${esc(T.groups[g] || g)}</h2>
<ul class="list cols">${groups[g].sort((a, b) => a.name.localeCompare(b.name)).map((d) => {
    const s = sitesOf(d).length, c = centresOf(d).length
    return `<li><a class="card row" href="${T.base}${slug(d.name)}"><span><b>${esc(d.name)}</b><span class="meta"> · ${esc(d.province)}</span></span><span class="meta">${T.counts(s, c)}</span></a></li>`
  }).join('')}</ul>`).join('\n')}`
  const url = pageUrl(l)
  const jsonld = { '@context': 'https://schema.org', '@type': 'ItemList', name: T.indexH1, url, inLanguage: T.lang,
    itemListElement: dests.map((d, i) => ({ '@type': 'ListItem', position: i + 1, name: d.name, url: pageUrl(l, d) })) }
  return layout(l, { title: T.indexTitle, desc: T.indexDesc(dests.length, data.sites.length), url, alt: pageUrl(T.other), body, jsonld })
}

// Escribir las páginas (borra antes las generadas, por si un destino cambia de nombre)
const outs = { en: path.join(ROOT, 'public/dive'), es: path.join(ROOT, 'public/es/buceo') }
let n = 0
for (const [l, dir] of Object.entries(outs)) {
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (f.endsWith('.html')) fs.rmSync(path.join(dir, f))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), indexPage(l)); n++
  for (const d of dests) {
    fs.writeFileSync(path.join(dir, slug(d.name) + '.html'), destPage(l, d)); n++
  }
}

// sitemap.xml con las versiones en los dos idiomas
const fixed = [
  ['/', 'weekly', '1.0'], ['/app/', 'daily', '0.8'],
  ['/legal/privacy.html', 'yearly', '0.2'], ['/legal/terms.html', 'yearly', '0.2'], ['/legal/cancellation.html', 'yearly', '0.2'],
]
const pair = (d) => [pageUrl('en', d), pageUrl('es', d)]
const alts = (en, es) => `<xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="es" href="${es}"/>`
const urls = [
  ...fixed.map(([p, f, pr]) => `  <url><loc>${SITE}${p}</loc><changefreq>${f}</changefreq><priority>${pr}</priority></url>`),
  ...[null, ...dests].flatMap((d) => { const [en, es] = pair(d); return [en, es].map((u) => `  <url><loc>${u}</loc>${alts(en, es)}<changefreq>weekly</changefreq><priority>${d ? '0.7' : '0.8'}</priority></url>`) }),
]
fs.writeFileSync(path.join(ROOT, 'public/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`)
console.log(n, 'páginas,', urls.length, 'URL en sitemap.xml')
