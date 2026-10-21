// Genera worker/schema.sql a partir de worker/schema.js:  node worker/gen-schema.mjs
import fs from 'node:fs'
import { schemaSql } from './schema.js'
fs.writeFileSync(new URL('./schema.sql', import.meta.url), schemaSql())
console.log('worker/schema.sql generado')
