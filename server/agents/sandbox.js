/* Sandbox environment (our self-hosted equivalent of an Agents API environment).
   - No shell, no arbitrary code exec, no writes outside the run.
   - Network: allowlisted hosts only (web_search, github, model).
   - Files/artifacts: generated in-memory, rendered in sandboxed iframes.
   - Secrets: mounted as masked refs; values only leave via dedicated headers
     to their owning API (GitHub PAT → api.github.com), never to the model.
*/
const { ALLOW_HOSTS, hostAllowed } = require('../harness');

async function fetchAllowlisted(url, opts = {}, timeoutMs = 9000) {
  if (!hostAllowed(url)) {
    const e = new Error(`host blocked by sandbox allowlist: ${url}`);
    e.code = 'HOST_BLOCKED';
    throw e;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Lingon/1.0 (+agents-harness)', Accept: 'application/json,text/html', ...(opts.headers || {}) },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${new URL(url).hostname}`);
    return r;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { ALLOW_HOSTS, hostAllowed, fetchAllowlisted };
