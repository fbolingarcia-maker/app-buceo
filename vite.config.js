import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// En GitHub Pages la app vive en /<nombre-del-repo>/. El workflow pasa BASE_PATH.
// Cabeceras de seguridad para la versión publicada (GitHub Pages no permite cabeceras HTTP propias,
// así que van como <meta>). Solo en build: en desarrollo Vite necesita scripts en línea y websockets locales.
const SUPABASE = 'https://tosgzcpnkpsrrkfqctgy.supabase.co'
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://flagcdn.com " + SUPABASE,
  "connect-src 'self' " + SUPABASE + ' ' + SUPABASE.replace('https://', 'wss://'),
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ')
const securityHeaders = {
  name: 'security-headers',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />',
    '<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="' + CSP + '" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />'),
}

// Dos páginas en el mismo dominio: la web comercial (landing) en / y la app en /app/
export default defineConfig({
  plugins: [react(), securityHeaders],
  base: process.env.BASE_PATH || '/',
  build: {
    rollupOptions: {
      input: {
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./legal/privacy.html', import.meta.url)),
        terms: fileURLToPath(new URL('./legal/terms.html', import.meta.url)),
        cancellation: fileURLToPath(new URL('./legal/cancellation.html', import.meta.url)),
      },
    },
  },
})
