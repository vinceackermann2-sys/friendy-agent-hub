/* Sandbox environment (our self-hosted equivalent of an Agents API environment).
   - No shell, no arbitrary code exec, no writes outside the run.
   - Network: allowlisted hosts only (web_search, github, model).
   - Files/artifacts: generated in-memory, rendered in sandboxed iframes.
   - Secrets: mounted as masked refs; values only leave via dedicated headers
     to their owning API (GitHub PAT → api.github.com), never to the model.
*/
const { ALLOW_HOSTS, hostAllowed } = require('../harness');

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function blocked(url) {
  const e = new Error(`host blocked by sandbox allowlist: ${url}`);
  e.code = 'HOST_BLOCKED';
  return e;
}

async function fetchAllowlisted(url, opts = {}, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const abort = () => ctrl.abort();
  if (opts.signal?.aborted) abort();
  else opts.signal?.addEventListener('abort', abort, { once: true });
  try {
    let current = new URL(url);
    if (!hostAllowed(current.href)) throw blocked(current.href);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const r = await fetch(current, {
        ...opts,
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Lingon/1.0 (+agents-harness)', Accept: 'application/json,text/html', ...(opts.headers || {}) },
      });
      if (REDIRECT_CODES.has(r.status)) {
        const location = r.headers.get('location');
        if (!location || redirects === 3) throw new Error('sandbox redirect limit exceeded');
        const next = new URL(location, current);
        if (!hostAllowed(next.href) || next.origin !== current.origin) throw blocked(next.href);
        current = next;
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${current.hostname}`);
      if (!r.body) return r;
      const reader = r.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          const e = new Error(`response exceeds sandbox limit (${MAX_RESPONSE_BYTES} bytes)`);
          e.code = 'BODY_TOO_LARGE';
          throw e;
        }
        chunks.push(value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
    }
  } finally {
    clearTimeout(t);
    opts.signal?.removeEventListener('abort', abort);
  }
}

module.exports = { ALLOW_HOSTS, hostAllowed, fetchAllowlisted };
