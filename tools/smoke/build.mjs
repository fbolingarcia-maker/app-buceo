import * as esbuild from '/opt/npm-tools/node_modules/esbuild/lib/main.js'
const S = process.argv[2] || new URL('.', import.meta.url).pathname.replace(/\/$/, ''), APP = process.env.APP || new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
await esbuild.build({
  entryPoints: [APP + '/src/main.jsx'], bundle: true, outdir: S + '/out', format: 'esm', jsx: 'automatic', loader: { '.js': 'jsx' },
  define: { 'import.meta.env.VITE_SUPABASE_URL': 'undefined', 'import.meta.env.VITE_SUPABASE_KEY': 'undefined', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"' },
  alias: { '@supabase/supabase-js': S + '/mock-supabase.js', react: '/opt/npm-tools/node_modules/react', 'react-dom': '/opt/npm-tools/node_modules/react-dom' },
  nodePaths: ['/opt/npm-tools/node_modules'], logLevel: 'error',
})
console.log('built')
