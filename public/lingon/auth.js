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
    try { window.LingonConfig.userId = (s && s.user && s.user.id) || window.LingonConfig.userId; } catch {}
  };
  const headers = (extra = {}) => {
    const s = get();
    return { 'Content-Type': 'application/json', ...(s?.access_token ? { Authorization: 'Bearer ' + s.access_token } : {}), ...extra };
  };
  async function api(path, opts = {}) {
    const r = await fetch((window.LingonConfig.apiBase || '') + path, { ...opts, headers: headers(opts.headers || {}) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      // try refresh once
      const s = get();
      if (s?.refresh_token && path !== '/api/auth/refresh') {
        try {
          const rr = await fetch((window.LingonConfig.apiBase || '') + '/api/auth/refresh', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: s.refresh_token }),
          });
          const jj = await rr.json();
          if (rr.ok && jj.access_token) {
            set({ access_token: jj.access_token, refresh_token: jj.refresh_token, user: jj.user });
            return api(path, opts);
          }
        } catch {}
      }
      set(null);
      throw Object.assign(new Error(j.error || 'Sign in required.'), { code: 401 });
    }
    if (!r.ok) {
      const e = new Error(j.error || `HTTP ${r.status}`);
      e.code = r.status;
      e.upgrade = !!j.upgrade_required;
      throw e;
    }
    return j;
  }
  return { get, set, headers, api, signedIn: () => !!get()?.access_token };
})();
