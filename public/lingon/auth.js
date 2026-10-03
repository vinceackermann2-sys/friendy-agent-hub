/* Lingon frontend auth — Supabase JWT via backend proxy (keys stay server-side).
   Session in localStorage: lingon.session {access_token, refresh_token, user}.
   All backend api() calls attach Authorization: Bearer <access_token>.
   GitHub PATs go via X-GitHub-Token only — never in Authorization. */
window.LingonAuth = (() => {
  const SKEY = 'lingon.session';
  const get = () => {
    try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch { return null; }
  };
  const set = (s) => {
    if (!s) localStorage.removeItem(SKEY);
    else localStorage.setItem(SKEY, JSON.stringify(s));
    // No demo/local identity: userId is the real Supabase id or null.
    try { window.LingonConfig.userId = (s && s.user && s.user.id) || null; } catch {}
  };
  const headers = (extra = {}) => {
    const s = get();
    return { 'Content-Type': 'application/json', ...(s?.access_token ? { Authorization: 'Bearer ' + s.access_token } : {}), ...extra };
  };
  let refreshPending = null;
  async function refreshSession(expiredToken) {
    const session = get();
    if (!session?.refresh_token) return false;
    if (session.access_token !== expiredToken) return true;
    if (!refreshPending) {
      const request = (async () => {
        const response = await fetch((window.LingonConfig.apiBase || '') + '/api/auth/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        });
        const next = await response.json().catch(() => ({}));
        if (!response.ok || !next.access_token) return false;
        const current = get();
        if (!current || current.access_token !== expiredToken) return !!current?.access_token;
        set({ access_token: next.access_token, refresh_token: next.refresh_token || current.refresh_token, user: next.user || current.user });
        return true;
      })().catch(() => false).finally(() => {
        if (refreshPending === request) refreshPending = null;
      });
      refreshPending = request;
    }
    return refreshPending;
  }
  async function api(path, opts = {}, retried = false) {
    const token = get()?.access_token;
    const r = await fetch((window.LingonConfig.apiBase || '') + path, { ...opts, headers: headers(opts.headers || {}) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      if (!retried && path !== '/api/auth/refresh' && await refreshSession(token)) return api(path, opts, true);
      if (get()?.access_token === token) set(null);
      throw Object.assign(new Error(j.error || 'Sign in required.'), { code: 401 });
    }
    if (!r.ok) {
      const e = new Error(j.error || `HTTP ${r.status}`);
      e.code = r.status;
      e.upgrade = !!j.upgrade_required;
      e.transferNotStarted = j.transferNotStarted === true;
      throw e;
    }
    return j;
  }
  async function apiStream(path, opts = {}) {
    // Raw fetch for SSE streaming (/api/chat/stream). Returns the Response
    // so callers can read deltas incrementally — never buffers JSON.
    const doFetch = () => fetch((window.LingonConfig.apiBase || '') + path, { ...opts, headers: headers(opts.headers || {}) });
    const token = get()?.access_token;
    let requestToken = token;
    let r = await doFetch();
    if (r.status === 401 && path !== '/api/auth/refresh') {
      if (await refreshSession(token)) { requestToken = get()?.access_token; r = await doFetch(); }
      if (r.status === 401) {
        if (get()?.access_token === requestToken) set(null);
        throw Object.assign(new Error('Sign in required.'), { code: 401 });
      }
    }
    return r;
  }
  return { get, set, headers, api, apiStream, signedIn: () => !!get()?.access_token };
})();
