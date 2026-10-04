/* Native Apple device transport. No device content is uploaded at connection
   time. The native layer validates origins, permissions and every action. */
window.BelnaApple = (() => {
  const native = window.BelnaNative;
  if (!native || !['ios','mac'].includes(native.platform)) return { available: false };
  document.documentElement.classList.add('belna-native');
  let identity = '', deviceId = '', registered = false, polling = false, lastHeartbeat = 0;
  const pendingResults = new Map();
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
  function reset() { identity = ''; registered = false; pendingResults.clear(); lastHeartbeat = 0; native.request({method:'lock'}).catch(()=>{}); }
  window.addEventListener('belna-auth-changed', () => {
    if (!window.LingonAuth?.signedIn()) reset();
    else { lastHeartbeat = 0; tick(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastHeartbeat = 0; tick(); } });
  window.addEventListener('belna-apple-changed', () => { lastHeartbeat = 0; tick(); });
  setInterval(tick, 1500);
  setTimeout(tick, 0);
  return {
    available: true,
    platform: native.platform,
    async commandActive(commandId) {
      if (!active() || !deviceId || window.LingonAuth.get()?.user?.id !== identity) return false;
      const out = await window.LingonAuth.api('/api/apple/devices/' + encodeURIComponent(deviceId) + '/commands/' + encodeURIComponent(commandId));
      return out.active === true;
    },
    settings: () => native.request({method:'settings'}),
    async signIn(termsVersion) {
      const credential = await native.request({method:'signIn'});
      return window.LingonAuth.api('/api/auth/apple', { method: 'POST', body: JSON.stringify({ ...credential, terms_version: termsVersion }) });
    },
    async disconnect() {
      if (deviceId && identity) await window.LingonAuth.api('/api/apple/devices/' + deviceId, {method:'DELETE'});
      await native.request({method:'disconnect'}); registered = false; lastHeartbeat = 0;
    },
  };
})();
