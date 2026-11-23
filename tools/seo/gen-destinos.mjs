// Páginas estáticas de destinos para buscadores (la app usa rutas con #, que Google no indexa bien):
//   /dive/ y /dive/<destino>          en inglés   (public/dive/index.html y public/dive/<destino>.html)
//   /es/buceo/ y /es/buceo/<destino>  en español (public/es/buceo/…)
// Cloudflare sirve <destino>.html en /dive/<destino> (html_handling «auto-trailing-slash»).
// Cada página tiene los puntos de buceo (nivel, profundidad, qué se ve), los centros del directorio, destinos cercanos
// y el botón a las salidas de la app. Sin JavaScript; el estilo es public/dive/dive.css. También regenera
// public/sitemap.xml.
//
// Datos: tools/seo/datos.json, una foto de las tablas públicas de D1 (destinations, dive_sites y el directorio de
// centers). Para actualizarla: npx wrangler d1 execute diveslot --remote --json --file tools/seo/datos.sql |
// node tools/seo/from-d1.mjs, y vuelve a ejecutar: node tools/seo/gen-destinos.mjs (detalles en tools/seo/README.md)
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
  // Apo Reef se bucea desde Sablayan y desde Pandan Island; la Manta Bowl (Ticao Pass), desde Ticao y desde Donsol
  'Apo Reef': ['Pandan Island'],
  'Ticao Island': ['Donsol'],
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
    title: (d) => `${d.name} diving: dive sites and dive centres (${d.province}) · DivingSlot`,
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
    siteDir: 'site/', centreDir: 'centre/',
    siteTitle: (s, a) => `${s.name.includes(a) ? s.name : s.name + ', ' + a}: dive site guide · DivingSlot`,
    siteDesc: (s, a, d) => `${s.name} dive site in ${a}, ${d.province}, Philippines.${s.hl ? ' ' + s.hl + '.' : ''} Depth, recommended level and dive centres nearby.`,
    siteH1: (s) => `${s.name} dive site`,
    siteLead: (a, d) => `${a} · ${d.province} · ${d.island_group}, Philippines`,
    depthL: 'Depth', levelL: 'Recommended level', feeL: 'Sanctuary or park fee', fromL: 'Dived from', marineL: 'What you will see',
    otherSites: (a) => `More dive sites in ${a}`, centresNear: (d) => `Dive centres in ${d.name}`,
    centreTitle: (c, d) => `${c.name}, ${d.name}: dive centre · DivingSlot`,
    centreDesc: (c, d, n) => `${c.name} is a dive centre in ${c.locality && c.locality !== d.name ? c.locality + ', ' : ''}${d.name} (${d.province}, Philippines). Dive sites nearby${n ? ` (${n})` : ''}, agencies and how to book dive trips.`,
    centreLead: (c, d) => `Dive centre in ${c.locality && c.locality !== d.name ? c.locality + ', ' : ''}${d.name} · ${d.province}, Philippines`,
    agenciesL: 'Agencies', langsL: 'Languages', webL: 'Website', gfL: 'Green Fins', gfV: 'Eco practices checked by DivingSlot',
    bookOnline: 'Book dive trips online with this centre on DivingSlot.',
    listed: 'Listed from public sources: trips with this centre cannot be booked on DivingSlot yet.',
    claim: 'Is this your dive centre? Claim the listing in the app to publish your trips.',
    seeTrips: 'See trips and details', sitesNear: (d) => `Dive sites in ${d.name}`, otherCentres: (d) => `Other dive centres in ${d.name}`,
  },
  es: {
    lang: 'es', base: '/es/buceo/', other: 'en', appLang: 'es',
    indexTitle: 'Destinos de buceo en Filipinas · DivingSlot',
    indexH1: 'Destinos de buceo en Filipinas',
    indexLead: (d, s, c) => `${d} destinos, ${s} puntos de buceo y ${c} centros. Elige un lugar para ver sus puntos de buceo, el nivel que pide cada uno y quién sale a bucear allí.`,
    indexDesc: (d, s) => `Guía de ${d} destinos de buceo en Filipinas: ${s} puntos de buceo con profundidad, nivel recomendado y fauna, y los centros de buceo de cada zona.`,
    title: (d) => `Buceo en ${d.name}: puntos de buceo y centros (${d.province}) · DivingSlot`,
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
    siteDir: 'punto/', centreDir: 'centro/',
    siteTitle: (s, a) => `${s.name.includes(a) ? s.name : s.name + ' (' + a + ')'}: punto de buceo · DivingSlot`,
    siteDesc: (s, a, d) => `Punto de buceo ${s.name} en ${a}, ${d.province}, Filipinas.${(s.hl_es || s.hl) ? ' ' + (s.hl_es || s.hl) + '.' : ''} Profundidad, nivel recomendado y centros de buceo cercanos.`,
    siteH1: (s) => `Punto de buceo ${s.name}`,
    siteLead: (a, d) => `${a} · ${d.province} · ${d.island_group}, Filipinas`,
    depthL: 'Profundidad', levelL: 'Nivel recomendado', feeL: 'Tasa del santuario o parque', fromL: 'Se bucea desde', marineL: 'Qué se ve',
    otherSites: (a) => `Más puntos de buceo en ${a}`, centresNear: (d) => `Centros de buceo en ${d.name}`,
    centreTitle: (c, d) => `${c.name} (${d.name}): centro de buceo · DivingSlot`,
    centreDesc: (c, d, n) => `${c.name} es un centro de buceo en ${c.locality && c.locality !== d.name ? c.locality + ', ' : ''}${d.name} (${d.province}, Filipinas). Puntos de buceo cercanos${n ? ` (${n})` : ''}, agencias y cómo reservar salidas.`,
    centreLead: (c, d) => `Centro de buceo en ${c.locality && c.locality !== d.name ? c.locality + ', ' : ''}${d.name} · ${d.province}, Filipinas`,
    agenciesL: 'Agencias', langsL: 'Idiomas', webL: 'Web', gfL: 'Green Fins', gfV: 'Prácticas ecológicas comprobadas por DivingSlot',
    bookOnline: 'Reserva salidas de buceo con este centro en DivingSlot.',
    listed: 'Ficha a partir de fuentes públicas: aún no se pueden reservar salidas con este centro en DivingSlot.',
    claim: '¿Es tu centro de buceo? Reclama la ficha en la app para publicar tus salidas.',
    seeTrips: 'Ver salidas y detalles', sitesNear: (d) => `Puntos de buceo en ${d.name}`, otherCentres: (d) => `Otros centros de buceo en ${d.name}`,
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
  // Google corta los títulos de unos 60 caracteres: si no cabe, sin la marca al final
  if (title.length > 62 && title.endsWith(' · DivingSlot')) title = title.slice(0, -' · DivingSlot'.length)
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
<nav aria-label="Footer"><a href="${T.base}">${T.destinations}</a><a href="/app/">${T.openApp}</a><a href="/legal/privacy">${T.privacy}</a><a href="/legal/terms">${T.terms}</a><a href="mailto:divingslot@gmail.com">${T.contact}</a></nav>
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
    return `<li class="card"><div class="row"><h3><a href="${T.base}${T.siteDir}${siteSlug.get(s)}">${esc(s.name)}</a></h3><span class="pill${s.level === 'advanced' ? ' warn' : ''}" title="${T.levelFor}">${T.levels[s.level] || esc(s.level)}</span></div>${meta ? `<p class="meta">${meta}</p>` : ''}${hl(s) ? `<p>${esc(hl(s))}</p>` : ''}</li>`
  }).join('')}</ul>` : `<p class="card muted">${T.noSites}</p>`
  const centreHtml = centres.length ? `<ul class="list cols">${centres.map((c) => `<li><a class="card row" href="${T.base}${T.centreDir}${centreSlug.get(c)}"><span><b>${esc(c.name)}</b>${c.locality && c.locality !== d.name ? `<span class="meta"> · ${esc(c.locality)}</span>` : ''}</span>${c.socio ? `<span class="pill ok">${T.bookable}</span>` : ''}</a></li>`).join('')}</ul><p class="meta">${T.note}</p>` : ''
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


// Slugs únicos para puntos y centros (si dos se llaman igual, se añade la zona o el destino)
const uniq = (items, base, extra) => {
  const seen = new Map(), out = new Map()
  for (const it of items) { const k = slug(base(it)); seen.set(k, (seen.get(k) || 0) + 1) }
  for (const it of items) {
    let k = slug(base(it))
    if (seen.get(k) > 1) k = slug(base(it) + '-' + extra(it))
    let n = 2, kk = k
    while ([...out.values()].includes(kk)) kk = k + '-' + n++
    out.set(it, kk)
  }
  return out
}
const siteSlug = uniq(data.sites, (s) => s.name, (s) => s.area)
const centreSlug = uniq(data.centers, (c) => c.name, (c) => c.dest)
// Destino desde el que se bucea una zona (la propia zona o la que la tiene en EXTRA_AREAS)
const destOfArea = (area) => dests.find((d) => d.name === area) || dests.find((d) => (EXTRA_AREAS[d.name] || []).includes(area))
const AGENCY = (a) => String(a).toUpperCase() === a ? a : a.charAt(0).toUpperCase() + a.slice(1)
const LANGN = { en: 'English', es: 'Español', de: 'Deutsch', fr: 'Français', it: 'Italiano', ja: '日本語', ko: '한국어', zh: '中文', tl: 'Tagalog', ru: 'Русский', nl: 'Nederlands' }
const facts = (rows) => `<dl class="facts">${rows.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
const subUrl = (l, dir, k) => SITE + L[l].base + L[l][dir] + k

function crumbs2(l, d, last) {
  const T = L[l]
  return `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">${T.home}</a> <span aria-hidden="true">/</span> <a href="${T.base}">${T.destinations}</a> <span aria-hidden="true">/</span> <a href="${T.base}${slug(d.name)}">${esc(d.name)}</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(last)}</span></nav>`
}
const crumbLd = (l, d, name, url) => ({ '@type': 'BreadcrumbList', itemListElement: [
  { '@type': 'ListItem', position: 1, name: L[l].home, item: SITE + '/' },
  { '@type': 'ListItem', position: 2, name: L[l].destinations, item: pageUrl(l) },
  { '@type': 'ListItem', position: 3, name: d.name, item: pageUrl(l, d) },
  { '@type': 'ListItem', position: 4, name, item: url },
] })

function sitePage(l, s) {
  const T = L[l]
  const d = destOfArea(s.area)
  const hl = l === 'es' ? s.hl_es || s.hl : s.hl
  const others = data.sites.filter((x) => x.area === s.area && x !== s).sort((a, b) => a.name.localeCompare(b.name))
  const centres = centresOf(d).slice(0, 12)
  const url = subUrl(l, 'siteDir', siteSlug.get(s))
  const body = `${crumbs2(l, d, s.name)}
<section class="hero"><h1>${esc(T.siteH1(s))}</h1><p class="lead">${esc(T.siteLead(s.area, d))}</p>
<p class="ctas"><a class="btn" href="${appUrl('/d/' + encodeURIComponent(d.name))}">${esc(T.cta(d))}</a></p></section>
${facts([[T.marineL, hl ? esc(hl) : ''], [T.depthL, T.depth(s.min, s.max)], [T.levelL, T.levels[s.level] || esc(s.level || '')], [T.feeL, s.fee ? '₱' + s.fee.toLocaleString('en-US') : ''], [T.fromL, `<a href="${T.base}${slug(d.name)}">${esc(d.name)}</a>`]])}
${others.length ? `<h2>${esc(T.otherSites(s.area))} <span class="count">${others.length}</span></h2>
<ul class="list cols">${others.map((x) => `<li><a class="card row" href="${T.base}${T.siteDir}${siteSlug.get(x)}"><b>${esc(x.name)}</b><span class="meta">${[T.depth(x.min, x.max), T.levels[x.level] || ''].filter(Boolean).join(' · ')}</span></a></li>`).join('')}</ul>` : ''}
${centres.length ? `<h2>${esc(T.centresNear(d))}</h2>
<ul class="list cols">${centres.map((c) => `<li><a class="card row" href="${T.base}${T.centreDir}${centreSlug.get(c)}"><b>${esc(c.name)}</b>${c.socio ? `<span class="pill ok">${T.bookable}</span>` : ''}</a></li>`).join('')}</ul>` : ''}`
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'TouristAttraction', name: s.name, url, description: hl || undefined, inLanguage: T.lang, touristType: 'Scuba divers',
      containedInPlace: { '@type': 'TouristDestination', name: d.name, url: pageUrl(l, d), geo: { '@type': 'GeoCoordinates', latitude: d.lat, longitude: d.lng } } },
    crumbLd(l, d, s.name, url),
  ] }
  return layout(l, { title: T.siteTitle(s, s.area), desc: T.siteDesc(s, s.area, d), url, alt: subUrl(T.other, 'siteDir', siteSlug.get(s)), body, jsonld })
}

function centrePage(l, c) {
  const T = L[l]
  const d = dests.find((x) => x.name === c.dest)
  const sites = sitesOf(d)
  const others = centresOf(d).filter((x) => x !== c).slice(0, 12)
  const url = subUrl(l, 'centreDir', centreSlug.get(c))
  let web = ''
  try { if (c.web) { const u = new URL(/^https?:/i.test(c.web) ? c.web : 'https://' + c.web); web = `<a href="${esc(u.href)}" rel="nofollow noopener" target="_blank">${esc(u.hostname.replace(/^www\./, ''))}</a>` } } catch (e) { /* web no válida */ }
  const body = `${crumbs2(l, d, c.name)}
<section class="hero"><h1>${esc(c.name)}</h1><p class="lead">${esc(T.centreLead(c, d))}</p>
<p class="ctas"><a class="btn" href="${appUrl('/c/' + c.id)}">${T.seeTrips}</a></p>
<p class="meta">${c.socio ? T.bookOnline : `${T.listed} ${T.claim}`}</p></section>
${facts([[T.agenciesL, (c.agencies || []).map((a) => esc(AGENCY(a))).join(', ')], [T.langsL, (c.languages || []).map((x) => esc(LANGN[x] || x)).join(', ')], [T.webL, web], [T.gfL, c.gf ? T.gfV : '']])}
${sites.length ? `<h2>${esc(T.sitesNear(d))} <span class="count">${sites.length}</span></h2>
<ul class="list cols">${sites.map((x) => `<li><a class="card row" href="${T.base}${T.siteDir}${siteSlug.get(x)}"><b>${esc(x.name)}</b><span class="meta">${[x.area !== d.name ? esc(x.area) : '', T.depth(x.min, x.max)].filter(Boolean).join(' · ')}</span></a></li>`).join('')}</ul>` : ''}
${others.length ? `<h2>${esc(T.otherCentres(d))}</h2>
<ul class="list cols">${others.map((x) => `<li><a class="card row" href="${T.base}${T.centreDir}${centreSlug.get(x)}"><b>${esc(x.name)}</b>${x.socio ? `<span class="pill ok">${T.bookable}</span>` : ''}</a></li>`).join('')}</ul>` : ''}
<p class="meta">${T.note}</p>`
  const biz = { '@type': 'SportsActivityLocation', name: c.name, url, description: T.centreDesc(c, d, sites.length),
    address: { '@type': 'PostalAddress', addressLocality: c.locality || d.name, addressRegion: d.province, addressCountry: 'PH' } }
  if (web) biz.sameAs = [new URL(/^https?:/i.test(c.web) ? c.web : 'https://' + c.web).href]
  if ((c.languages || []).length) biz.knowsLanguage = c.languages
  const jsonld = { '@context': 'https://schema.org', '@graph': [biz, crumbLd(l, d, c.name, url)] }
  return layout(l, { title: T.centreTitle(c, d), desc: T.centreDesc(c, d, sites.length), url, alt: subUrl(T.other, 'centreDir', centreSlug.get(c)), body, jsonld })
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
  // Una página por punto de buceo y por centro (subcarpetas site/ y centre/, o punto/ y centro/)
  for (const [sub, items, slugs, fn] of [[L[l].siteDir, data.sites.filter((s) => destOfArea(s.area)), siteSlug, sitePage], [L[l].centreDir, data.centers.filter((c) => dests.some((d) => d.name === c.dest)), centreSlug, centrePage]]) {
    const sd = path.join(dir, sub)
    fs.rmSync(sd, { recursive: true, force: true })
    fs.mkdirSync(sd, { recursive: true })
    for (const it of items) { fs.writeFileSync(path.join(sd, slugs.get(it) + '.html'), fn(l, it)); n++ }
  }
}

// sitemap.xml con las versiones en los dos idiomas
const TODAY = new Date().toISOString().slice(0, 10)
const fixed = [
  ['/', 'weekly', '1.0'], ['/app/', 'daily', '0.8'],
  ['/legal/privacy', 'yearly', '0.2'], ['/legal/terms', 'yearly', '0.2'], ['/legal/cancellation', 'yearly', '0.2'],
]
const pair = (d) => [pageUrl('en', d), pageUrl('es', d)]
const alts = (en, es) => `<xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="es" href="${es}"/>`
const urls = [
  ...fixed.map(([p, f, pr]) => `  <url><loc>${SITE}${p}</loc><changefreq>${f}</changefreq><priority>${pr}</priority></url>`),
  ...[null, ...dests].flatMap((d) => { const [en, es] = pair(d); return [en, es].map((u) => `  <url><loc>${u}</loc>${alts(en, es)}<lastmod>${TODAY}</lastmod></url>`) }),
  ...[['siteDir', data.sites.filter((s) => destOfArea(s.area)), siteSlug], ['centreDir', data.centers.filter((c) => dests.some((d) => d.name === c.dest)), centreSlug]]
    .flatMap(([dir, items, slugs]) => items.flatMap((it) => { const en = subUrl('en', dir, slugs.get(it)), es = subUrl('es', dir, slugs.get(it)); return [en, es].map((u) => `  <url><loc>${u}</loc>${alts(en, es)}<lastmod>${TODAY}</lastmod></url>`) })),
]
fs.writeFileSync(path.join(ROOT, 'public/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`)
console.log(n, 'páginas,', urls.length, 'URL en sitemap.xml')
