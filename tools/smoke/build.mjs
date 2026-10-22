import * as esbuild from '/opt/npm-tools/node_modules/esbuild/lib/main.js'
import fs from 'node:fs'
const S = process.argv[2] || new URL('.', import.meta.url).pathname.replace(/\/$/, ''), APP = process.env.APP || new URL('../..', import.meta.url).pathname.replace(/\/$/, '')

// Paquetes que no están en /opt/npm-tools:
// - lucide-react → lucide-shim.js (generado con gen-lucide-shim.mjs a partir de los SVG de Lucide)
// - @fontsource/* → las fuentes reales si FONTSOURCE_DIR apunta a fonts/google del repo fontsource/font-files; si no, CSS vacío
const FONTS = process.env.FONTSOURCE_DIR
const sinRed = {
  name: 'sin-red',
  setup(b) {
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: S + '/lucide-shim.js' }))
    b.onResolve({ filter: /^@fontsource\// }, (a) => {
      const p = FONTS && a.path.replace(/^@fontsource\//, FONTS + '/')
      return p && fs.existsSync(p) ? { path: p } : { path: a.path, namespace: 'vacio' }
    })
    b.onLoad({ filter: /.*/, namespace: 'vacio' }, () => ({ contents: '', loader: 'css' }))
  },
}

await esbuild.build({
  entryPoints: [APP + '/src/main.jsx'], bundle: true, outdir: S + '/out', format: 'esm', jsx: 'automatic', loader: { '.js': 'jsx', '.woff2': 'file', '.woff': 'file' },
  define: { 'import.meta.env.VITE_BACKEND': 'undefined', 'import.meta.env.VITE_SUPABASE_URL': 'undefined', 'import.meta.env.VITE_SUPABASE_KEY': 'undefined', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"' },
  alias: { '@supabase/supabase-js': S + '/mock-supabase.js', react: '/opt/npm-tools/node_modules/react', 'react-dom': '/opt/npm-tools/node_modules/react-dom' },
  plugins: [sinRed],
  nodePaths: ['/opt/npm-tools/node_modules'], logLevel: 'error',
})
console.log('built')
