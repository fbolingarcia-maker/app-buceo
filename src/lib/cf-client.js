// Cliente de la API de DiveSlot en Cloudflare con la misma forma que @supabase/supabase-js
// (from/select/filtros, rpc, auth, auth.mfa, storage y functions.invoke), para que las pantallas no cambien.
// Se usa cuando la app se compila con VITE_BACKEND=cloudflare (ver src/lib/supabase.js).
// La sesión va en una cookie httpOnly (__Host-ds_session): el JavaScript nunca ve el token.

const HEADERS = { 'Content-Type': 'application/json', 'X-DiveSlot': '1' }

async function call(path, body, method = 'POST') {
  let res
  try {
    res = await fetch('/api/' + path, { method, headers: HEADERS, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) })
  } catch (e) {
    return { error: { message: 'Failed to fetch', code: 'network' }, status: 0 }
  }
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.error) {
    const e = typeof j.error === 'object' && j.error ? j.error : { message: j.error || res.statusText }
    return { ...j, error: { message: e.message || 'Error', code: e.code, status: res.status }, status: res.status }
  }
  return { ...j, error: null, status: res.status }
}

// ── Consultas a tablas ──
class Query {
  constructor(table) { this.q = { table, op: 'select', select: '*', filters: [], order: [] } }
  select(cols = '*', opts = {}) {
    if (this.q.op === 'select') { this.q.select = cols; if (opts.count) this.q.count = opts.count; if (opts.head) this.q.head = true } else { this.q.returning = true; this.q.select = cols }
    return this
  }
  insert(values) { this.q.op = 'insert'; this.q.values = values; return this }
  upsert(values, opts = {}) { this.q.op = 'upsert'; this.q.values = values; if (opts.onConflict) this.q.onConflict = opts.onConflict; return this }
  update(values) { this.q.op = 'update'; this.q.values = values; return this }
  delete() { this.q.op = 'delete'; return this }
  _f(col, op, val) { this.q.filters.push([col, op, val]); return this }
  eq(c, v) { return this._f(c, 'eq', v) }
  neq(c, v) { return this._f(c, 'neq', v) }
  gt(c, v) { return this._f(c, 'gt', v) }
  gte(c, v) { return this._f(c, 'gte', v) }
  lt(c, v) { return this._f(c, 'lt', v) }
  lte(c, v) { return this._f(c, 'lte', v) }
  in(c, v) { return this._f(c, 'in', v) }
  is(c, v) { return this._f(c, 'is', v) }
  like(c, v) { return this._f(c, 'like', v) }
  ilike(c, v) { return this._f(c, 'ilike', v) }
  not(c, op, v) { return this._f(c, 'not.' + op, v) }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this }
  or(s) { this.q.or = this.q.or ? `${this.q.or},${s}` : s; return this }
  order(col, opts = {}) { this.q.order.push({ col, ascending: opts.ascending !== false, nullsFirst: opts.nullsFirst }); return this }
  limit(n) { this.q.limit = n; return this }
  range(from, to) { this.q.offset = from; this.q.limit = to - from + 1; return this }
  single() { this.q.single = 'single'; return this }
  maybeSingle() { this.q.single = 'maybe'; return this }
  throwOnError() { this.q.throw = true; return this }
  async _run() {
    const r = await call('rest', this.q)
    const out = { data: r.error ? null : r.data ?? null, error: r.error, count: r.count ?? null, status: r.status }
    if (this.q.throw && out.error) throw out.error
    return out
  }
  then(ok, ko) { return this._run().then(ok, ko) }
}

export function createCfClient() {
  const listeners = new Set()
  let state = null // { session, aal, factors }
  const emit = (event) => { for (const cb of listeners) { try { cb(event, state?.session || null) } catch (e) { console.error(e) } } }
  const refresh = async () => {
    const r = await call('auth/session', undefined, 'GET')
    state = r.error ? { session: null, aal: null, factors: [] } : { session: r.session || null, aal: r.aal || null, factors: r.factors || [] }
    return state
  }
  let first = null
  const ensure = () => (first = first || refresh())

  const auth = {
    async getSession() { await ensure(); return { data: { session: state.session }, error: null } },
    async getUser() { await ensure(); return { data: { user: state.session?.user || null }, error: null } },
    onAuthStateChange(cb) {
      listeners.add(cb)
      // Como supabase-js: al suscribirse llega el estado inicial (o PASSWORD_RECOVERY si se entró con el enlace del email)
      ensure().then(() => { if (listeners.has(cb)) cb(state.session?.recovery ? 'PASSWORD_RECOVERY' : 'INITIAL_SESSION', state.session) })
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
    },
    async signInWithPassword({ email, password }) {
      const r = await call('auth/login', { email, password })
      if (r.error) return { data: { user: null, session: null }, error: r.error }
      await refresh(); emit('SIGNED_IN')
      return { data: { user: state.session?.user, session: state.session }, error: null }
    },
    async signUp({ email, password, options = {} }) {
      const r = await call('auth/signup', { email, password, data: options.data, redirect: options.emailRedirectTo })
      return r.error ? { data: { user: null, session: null }, error: r.error } : { data: { user: r.user, session: null }, error: null }
    },
    async resend({ email, options = {} }) {
      const r = await call('auth/resend', { email, redirect: options.emailRedirectTo })
      return { data: {}, error: r.error }
    },
    async resetPasswordForEmail(email, opts = {}) {
      const r = await call('auth/recover', { email, redirect: opts.redirectTo })
      return { data: {}, error: r.error }
    },
    async updateUser({ password }) {
      const r = await call('auth/update', { password })
      if (r.error) return { data: { user: null }, error: r.error }
      await refresh(); emit('USER_UPDATED')
      return { data: { user: state.session?.user }, error: null }
    },
    async signOut() {
      await call('auth/logout', {})
      state = { session: null, aal: null, factors: [] }
      emit('SIGNED_OUT')
      return { error: null }
    },
    async refreshSession() { await refresh(); emit('TOKEN_REFRESHED'); return { data: { session: state.session }, error: null } },
    mfa: {
      async getAuthenticatorAssuranceLevel() { await refresh(); return { data: state.aal || { currentLevel: null, nextLevel: null }, error: null } },
      async listFactors() {
        await refresh()
        const all = state.factors || []
        return { data: { all, totp: all.filter((f) => f.status === 'verified') }, error: null }
      },
      async enroll({ friendlyName } = {}) {
        const r = await call('auth/mfa/enroll', { friendlyName })
        return r.error ? { data: null, error: r.error } : { data: { id: r.id, type: 'totp', totp: r.totp }, error: null }
      },
      async challengeAndVerify({ factorId, code }) {
        const r = await call('auth/mfa/verify', { factorId, code })
        if (r.error) return { data: null, error: r.error }
        await refresh(); emit('MFA_CHALLENGE_VERIFIED')
        return { data: {}, error: null }
      },
      async unenroll({ factorId }) {
        const r = await call('auth/mfa/unenroll', { factorId })
        if (!r.error) await refresh()
        return { data: r.error ? null : { id: factorId }, error: r.error }
      },
    },
  }

  const storage = {
    from(bucket) {
      return {
        async upload(path, file, opts = {}) {
          let res
          try {
            res = await fetch(`/api/storage/upload/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
              method: 'PUT', credentials: 'same-origin', headers: { 'X-DiveSlot': '1', 'Content-Type': opts.contentType || file?.type || 'application/octet-stream' }, body: file,
            })
          } catch (e) { return { data: null, error: { message: 'Failed to fetch' } } }
          const j = await res.json().catch(() => ({}))
          return res.ok ? { data: j.data, error: null } : { data: null, error: { message: j.error?.message || res.statusText, statusCode: String(res.status) } }
        },
        async createSignedUrls(paths, expiresIn) {
          const r = await call('storage/sign', { bucket, paths, expiresIn })
          return { data: r.error ? null : r.data, error: r.error }
        },
        async createSignedUrl(path, expiresIn) {
          const r = await call('storage/sign', { bucket, paths: [path], expiresIn })
          const one = r.data?.[0]
          if (r.error || !one?.signedUrl) return { data: null, error: r.error || { message: one?.error || 'Object not found' } }
          return { data: { signedUrl: one.signedUrl }, error: null }
        },
        async remove(paths) {
          const r = await call('storage/remove', { bucket, paths })
          return { data: r.error ? null : r.data, error: r.error }
        },
      }
    },
  }

  const functions = {
    // Igual que supabase-js: si falla, error.context es la respuesta (Reservas.jsx lee error.context.json())
    async invoke(name, { body } = {}) {
      let res
      try {
        res = await fetch('/api/functions/' + name, { method: 'POST', headers: HEADERS, credentials: 'same-origin', body: JSON.stringify(body || {}) })
      } catch (e) { return { data: null, error: { message: 'Failed to fetch' } } }
      if (!res.ok) return { data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: res } }
      return { data: await res.json().catch(() => null), error: null }
    },
  }

  return {
    from: (table) => new Query(table),
    rpc: async (name, args = {}) => {
      const r = await call('rpc/' + name, args)
      return { data: r.error ? null : r.data ?? null, error: r.error }
    },
    auth,
    storage,
    functions,
  }
}
