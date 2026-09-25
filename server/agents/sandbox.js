/* Sandbox environment (our self-hosted equivalent of an Agents API environment).
   - No shell, no arbitrary code exec, no writes outside the run.
   - Network: allowlisted hosts for API calls (github, model); public pages
     through fetchPublic, which blocks private and internal addresses.
   - Files/artifacts: generated in-memory, rendered in sandboxed iframes.
   - Secrets: mounted as masked refs; values only leave via dedicated headers
     to their owning API (GitHub PAT → api.github.com), never to the model.
*/
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const { ALLOW_HOSTS, hostAllowed } = require('../harness');

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

// Public web reading (web_search page text and URL fetches). Any public host is
// allowed, but every hop is resolved and checked, so a page can never reach
// loopback, private networks or cloud metadata, even through DNS or redirects.
const PRIVATE_NETS = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
  ['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) PRIVATE_NETS.addSubnet(address, prefix, 'ipv4');
PRIVATE_NETS.addAddress('168.63.129.16', 'ipv4'); // Azure platform endpoint
for (const [address, prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['64:ff9b::',96],['2001:db8::',32]]) PRIVATE_NETS.addSubnet(address, prefix, 'ipv6');
const PAGE_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; LingonAgent/1.0)', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5', 'Accept-Language': 'en,sv;q=0.8' };

function isPublicAddress(address) {
  const family = net.isIP(address);
  return !!family && !PRIVATE_NETS.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

// Returns why a URL may not be fetched from the public web, or '' when it may.
function publicUrlProblem(value) {
  let u;
  try { u = new URL(String(value)); } catch { return 'invalid URL'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'only http and https URLs are allowed';
  if (u.username || u.password) return 'URLs with credentials are not allowed';
  if (u.port && !['80', '443'].includes(u.port)) return 'only standard web ports are allowed';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(host) || !host.includes('.') && !net.isIP(host)) return 'private host';
  if (net.isIP(host) && !isPublicAddress(host)) return 'private address';
  return '';
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(Object.assign(new Error(`${hostname} resolves to a private address`), { code: 'HOST_BLOCKED' }));
    }
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function requestOnce(target, { signal, maxBytes }) {
  return new Promise((resolve, reject) => {
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.get(target, { lookup: safeLookup, signal, headers: PAGE_HEADERS }, (res) => {
      if (REDIRECT_CODES.has(res.statusCode)) {
        res.resume();
        resolve({ status: res.statusCode, headers: res.headers, location: res.headers.location, body: Buffer.alloc(0) });
        return;
      }
      const chunks = [];
      let size = 0, done = false;
      const finish = (truncated) => { if (!done) { done = true; resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated }); } };
      res.on('data', (chunk) => {
        if (done) return;
        const room = maxBytes - size;
        chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
        size += Math.min(chunk.length, room);
        // A long page is cut, not rejected: its beginning is still useful.
        if (size >= maxBytes) { finish(true); res.destroy(); }
      });
      res.on('end', () => finish(false));
      res.on('error', (error) => { if (!done) { done = true; reject(error); } });
    });
    req.on('error', reject);
  });
}

async function fetchPublic(url, { signal, timeoutMs = 10000, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const abort = () => ctrl.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    let current = String(url);
    for (let hop = 0; hop <= 4; hop++) {
      const problem = publicUrlProblem(current);
      if (problem) throw Object.assign(new Error(`${problem}: ${current.slice(0, 200)}`), { code: 'HOST_BLOCKED' });
      const target = new URL(current);
      const res = await requestOnce(target, { signal: ctrl.signal, maxBytes });
      if (REDIRECT_CODES.has(res.status)) {
        if (!res.location) throw new Error(`redirect without a location from ${target.hostname}`);
        current = new URL(res.location, target).href;
        continue;
      }
      if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${target.hostname}`);
      return { url: target.href, status: res.status, contentType: String(res.headers['content-type'] || ''), body: res.body, truncated: !!res.truncated };
    }
    throw new Error('too many redirects');
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', abort);
  }
}

const ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', ndash:'-', mdash:'-', hellip:'...', rsquo:"'", lsquo:"'", rdquo:'"', ldquo:'"' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e] ?? m;
  const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});

// The page's main content when it marks one (<main>, <article>); headers, menus and
// contact blocks would otherwise fill the reading budget.
function mainContent(html) {
  const blocks = [...html.matchAll(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const best = blocks.sort((x, y) => y.length - x.length)[0] || '';
  return best.replace(/<[^>]+>/g, '').trim().length > 400 ? best : html;
}
function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const body = mainContent(html)
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
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
  return { url: page.url, title: '', text: '', note: `Unsupported content type ${type.split(';')[0]}. Open it in the browser instead.` };
}

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

module.exports = { ALLOW_HOSTS, hostAllowed, fetchAllowlisted, fetchPublic, readPage, publicUrlProblem, isPublicAddress, safeLookup, htmlToText };
