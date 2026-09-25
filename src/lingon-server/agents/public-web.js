/* Public web pages for the edge runtime: any public http(s) page can be read, as
   the Node runtime allows (server/agents/sandbox.js). Private, local and
   link-local addresses, credentials in URLs and non-web ports are refused on
   every redirect hop; Workers fetch cannot reach private networks either. Pages
   come back as readable text, not raw HTML. */
const MAX_BYTES = 2 * 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; BelnaAgent/1.0; +https://belna.se)',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'Accept-Language': 'en,sv;q=0.8',
};

function privateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || host === '168.63.129.16';
}
function privateIPv6(host) {
  const h = host.toLowerCase();
  return h === '::' || h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h) || h.startsWith('::ffff:');
}
function publicUrlProblem(value) {
  let u;
  try { u = new URL(String(value)); } catch { return 'invalid URL'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'only http and https URLs are allowed';
  if (u.username || u.password) return 'URLs with credentials are not allowed';
  if (u.port && !['80', '443'].includes(u.port)) return 'only standard web ports are allowed';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(host)) return 'private host';
  if (host.includes(':')) return privateIPv6(host) ? 'private address' : '';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return privateIPv4(host) ? 'private address' : '';
  if (!host.includes('.')) return 'private host';
  return '';
}

async function fetchPublic(url, { signal, timeoutMs = 9000, maxBytes = MAX_BYTES } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = String(url);
  for (let hop = 0; hop <= 4; hop++) {
    const problem = publicUrlProblem(current);
    if (problem) throw Object.assign(new Error(`${problem}: ${current.slice(0, 200)}`), { code: 'HOST_BLOCKED' });
    const res = await fetch(current, { redirect: 'manual', signal: combined, headers: PAGE_HEADERS });
    if (REDIRECT_CODES.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`redirect without a location from ${new URL(current).hostname}`);
      current = new URL(location, current).href;
      continue;
    }
    if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${new URL(current).hostname}`);
    const chunks = [];
    let size = 0, truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // A long page is cut, not rejected: its beginning is still useful.
        const room = maxBytes - size;
        chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
        size += Math.min(value.byteLength, room);
        if (size >= maxBytes) { truncated = true; await reader.cancel().catch(() => {}); break; }
      }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return { url: current, status: res.status, contentType: res.headers.get('content-type') || '', body, truncated };
  }
  throw new Error('too many redirects');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e] ?? m;
  const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});
function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/tr|\/section|\/article|\/ul|\/ol|\/table|\/blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body).replace(/[ \t\f\v\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: decodeEntities(title).replace(/\s+/g, ' ').trim(), text };
}
function decodeBody(body, contentType) {
  const charset = (/charset=([\w-]+)/i.exec(contentType) || [])[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(body); } catch { return new TextDecoder('utf-8').decode(body); }
}

// Fetch a public page and return readable text for the model.
async function readPage(url, { signal, timeoutMs, maxChars = 12000 } = {}) {
  const page = await fetchPublic(url, { signal, timeoutMs });
  const type = page.contentType.toLowerCase();
  if (/html|xml/.test(type) || !type) {
    const { title, text } = htmlToText(decodeBody(page.body, type));
    return { url: page.url, title, text: text.slice(0, maxChars) };
  }
  if (/^text\/|json/.test(type)) return { url: page.url, title: '', text: decodeBody(page.body, type).slice(0, maxChars) };
  throw new Error(`unsupported content type ${type.split(';')[0] || 'unknown'} at ${new URL(page.url).hostname}`);
}

export { publicUrlProblem, fetchPublic, readPage, htmlToText };
