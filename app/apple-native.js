/* Native Apple device transport. No device content is uploaded at connection
   time. The native layer validates origins, permissions and every action. */
window.BelnaApple = (() => {
  const native = window.BelnaNative;
  if (!native || !['ios','mac'].includes(native.platform)) return { available: false };
  document.documentElement.classList.add('belna-native');
  let identity = '', deviceId = '', registered = false, polling = false, lastHeartbeat = 0;
  const pendingResults = new Map();
  let connectionStatus = null;
  function rememberStatus(status, userId) {
    if (window.LingonAuth.get()?.user?.id !== userId) return;
    const next = { userId, name: String(status.name || 'This device'), capabilities: Object.fromEntries(['calendar','reminders','contacts','health'].map(scope => [scope, status.capabilities?.[scope] === true])) };
    if (JSON.stringify(next) !== JSON.stringify(connectionStatus)) {
      connectionStatus = next;
      window.dispatchEvent(new Event('belna-apple-status'));
    }
  }
  const active = () => !document.hidden && window.LingonAuth?.signedIn();
  async function tick() {
    if (polling || !active()) return;
    polling = true;
    try {
      const userId = window.LingonAuth.get()?.user?.id;
      if (!userId) return;
      if (identity !== userId) {
        identity = userId; registered = false; lastHeartbeat = 0; pendingResults.clear();
        const key = 'belna.apple.device.' + userId;
        deviceId = localStorage.getItem(key) || crypto.randomUUID();
        localStorage.setItem(key, deviceId);
      }
      if (Date.now() - lastHeartbeat > 15000) {
        const status = await native.request({ method: 'status', accountId: userId });
        if (window.LingonAuth.get()?.user?.id !== userId || !active()) return;
        rememberStatus(status, userId);
        await window.LingonAuth.api('/api/apple/devices', { method: 'POST', body: JSON.stringify({ id: deviceId, platform: native.platform, name: status.name, capabilities: status.capabilities }) });
        registered = true; lastHeartbeat = Date.now();
      }
      if (!registered) return;
      const base = '/api/apple/devices/' + encodeURIComponent(deviceId) + '/commands';
      // Retry delivery of a cached result, never re-execute the native action.
      for (const [id, payload] of pendingResults) {
        try { await window.LingonAuth.api(base + '/' + id, { method: 'POST', body: JSON.stringify(payload) }); pendingResults.delete(id); }
        catch (error) { if ([400,409,401].includes(error.code)) pendingResults.delete(id); else return; }
      }
      const { commands = [] } = await window.LingonAuth.api(base);
      for (const command of commands) {
        if (window.LingonAuth.get()?.user?.id !== userId || !active()) return;
        if (Date.parse(command.expiresAt) <= Date.now()) continue;
        let payload;
        try {
          const result = await native.request({ method: 'execute', accountId: userId, commandId: command.id, action: command.action, args: command.args, expiresAt: command.expiresAt });
          payload = { leaseToken: command.leaseToken, result };
        } catch (error) { payload = { leaseToken: command.leaseToken, error: String(error.message || error).slice(0,400) }; }
        if (window.LingonAuth.get()?.user?.id !== userId) return;
        pendingResults.set(command.id, payload);
        try { await window.LingonAuth.api(base + '/' + command.id, { method: 'POST', body: JSON.stringify(payload) }); pendingResults.delete(command.id); }
        catch (error) { if ([400,409,401].includes(error.code)) pendingResults.delete(command.id); }
      }
    } catch { /* Availability is visible in Apple apps; no noisy chat notifications. */ }
    finally { polling = false; }
  }
  function reset() { identity = ''; registered = false; connectionStatus = null; pendingResults.clear(); lastHeartbeat = 0; native.request({method:'lock'}).catch(()=>{}); window.dispatchEvent(new Event('belna-apple-status')); }
  window.addEventListener('belna-auth-changed', () => {
    if (!window.LingonAuth?.signedIn()) reset();
    else { lastHeartbeat = 0; tick(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastHeartbeat = 0; tick(); } });
  window.addEventListener('belna-apple-changed', () => { lastHeartbeat = 0; tick(); });
  setInterval(tick, 1500);
  setTimeout(tick, 0);
  // App Store rules allow buttons that send people to the browser to pay only in
  // these storefronts (ISO 3166-1 alpha-3). Elsewhere it needs Apple's paid
  // external-link entitlement, so the app keeps purchases out. Builds without the
  // storefront method answer with an error, which keeps purchases out too.
  const LINK_OUT_STOREFRONTS = ['USA'];
  let storefront = null;
  native.request({ method: 'storefront' }).then(out => {
    storefront = String(out?.countryCode || '').toUpperCase();
    window.dispatchEvent(new Event('belna-purchase-options'));
  }).catch(() => { storefront = ''; });
  return {
    available: true,
    platform: native.platform,
    // True once the storefront is known and allows completing purchases in the browser.
    browserPurchases: () => !!storefront && LINK_OUT_STOREFRONTS.includes(storefront),
    async commandActive(commandId) {
      if (!active() || !deviceId || window.LingonAuth.get()?.user?.id !== identity) return false;
      const out = await window.LingonAuth.api('/api/apple/devices/' + encodeURIComponent(deviceId) + '/commands/' + encodeURIComponent(commandId));
      return out.active === true;
    },
    connectionStatus: () => connectionStatus?.userId === window.LingonAuth.get()?.user?.id ? structuredClone(connectionStatus) : null,
    async refreshStatus() {
      const userId = window.LingonAuth.get()?.user?.id;
      if (!active() || !userId) return null;
      const status = await native.request({method:'status',accountId:userId});
      rememberStatus(status,userId);
      return connectionStatus?.userId === userId ? structuredClone(connectionStatus) : null;
    },
    settings: scope => native.request({method:'settings',...(scope ? {scope} : {})}),
    async signIn(termsVersion) {
      const credential = await native.request({method:'signIn'});
      return window.LingonAuth.api('/api/auth/apple', { method: 'POST', body: JSON.stringify({ ...credential, terms_version: termsVersion }) });
    },
    // Google blocks sign-in inside app web views; builds with webAuth open it in the
    // system browser sheet. The session returns sealed to this page's verifier.
    googleSignIn: Array.isArray(native.features) && native.features.includes('webAuth') ? async (termsVersion) => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const verifier = b64url(bytes);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const start = await fetch('/api/auth/oauth-url?' + new URLSearchParams({ provider: 'google', native: '1', terms_version: termsVersion, challenge }));
      const { url, error } = await start.json().catch(() => ({}));
      if (!start.ok || !url) throw new Error(error || 'Google sign-in unavailable');
      const back = new URL((await native.request({ method: 'webAuth', url })).url);
      if (back.searchParams.get('error')) throw new Error(back.searchParams.get('error'));
      return window.LingonAuth.api('/api/auth/native-exchange', { method: 'POST', body: JSON.stringify({ code: back.searchParams.get('code'), verifier }) });
    } : null,
    async disconnect() {
      if (deviceId && identity) await window.LingonAuth.api('/api/apple/devices/' + deviceId, {method:'DELETE'});
      await native.request({method:'disconnect'}); registered = false; lastHeartbeat = 0;
    },
  };
})();
