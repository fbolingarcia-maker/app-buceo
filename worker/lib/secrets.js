// AUTH_SECRET automático: si el Worker no tiene el secreto AUTH_SECRET, genera uno aleatorio (48 bytes) la primera vez y
// lo guarda en D1 (tabla app_secrets, que la importación no borra). Así el cambio a Cloudflare no necesita que nadie
// invente ni copie esa clave. Si más adelante se pone AUTH_SECRET como secreto del Worker, manda ese.
// Ojo: AUTH_SECRET cifra los dos pasos y firma sesiones de Google y enlaces de ficheros. Una vez en marcha, NO lo cambies
// (ni borres app_secrets): la gente tendría que volver a activar los dos pasos.
let cached = null

export async function withSecrets(env) {
  if (env.AUTH_SECRET || !env.DB) return env
  if (!cached) {
    const db = env.DB
    const bytes = crypto.getRandomValues(new Uint8Array(48))
    const fresh = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const [, , row] = await db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS app_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL)'),
      db.prepare('INSERT OR IGNORE INTO app_secrets (name, value, created_at) VALUES (?, ?, ?)').bind('auth_secret', fresh, new Date().toISOString()),
      db.prepare("SELECT value FROM app_secrets WHERE name = 'auth_secret'"),
    ])
    cached = row.results?.[0]?.value || null
  }
  return cached ? { ...env, AUTH_SECRET: cached, AUTH_SECRET_AUTO: '1' } : env
}

// Solo para las pruebas (cada prueba usa una D1 nueva)
export function _resetSecretsCache() { cached = null }
