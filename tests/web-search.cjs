const assert = require('node:assert/strict');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const { PassThrough } = require('node:stream');

// web_search searches with Firecrawl when FIRECRAWL_API_KEY is set, reads the
// top result pages through the public-web guard, and falls back to DuckDuckGo
// instant answers otherwise. Firecrawl (global fetch) and pages (http/https.get)
// are stubbed, so no network is used.
const searches = [];
let searchReply = () => new Response('{}', { status: 200 });
global.fetch = async (url, opts = {}) => { const u = new URL(url); searches.push({ url: u, opts }); return searchReply(u, opts); };
const pages = new Map(), pageRequests = [];
const fakeGet = (target, opts, onResponse) => {
  const u = new URL(target);
  pageRequests.push({ url: u.href, lookup: opts.lookup });
  const page = pages.get(u.href) || { status: 404, body: 'missing' };
  const res = new PassThrough();
  Object.assign(res, { statusCode: page.status, headers: { 'content-type': page.type || 'text/html; charset=utf-8', ...(page.location ? { location: page.location } : {}) } });
  const req = new PassThrough();
  process.nextTick(() => { onResponse(res); res.end(page.body || ''); });
  return req;
};
http.get = fakeGet;
https.get = fakeGet;
const { TOOLS } = require('../server/agents/tools');
const sandbox = require('../server/agents/sandbox');
const ctx = { trace: () => {} };

(async () => {
  // The public-web guard.
  for (const blocked of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://10.1.2.3/', 'https://[::1]/', 'http://localhost/',
    'http://intranet/', 'http://metadata.google.internal/', 'file:///etc/passwd', 'https://example.com:8443/', 'https://u:p@example.com/']) {
    assert.ok(sandbox.publicUrlProblem(blocked), `${blocked} is refused`);
  }
  assert.equal(sandbox.publicUrlProblem('https://sv.wikipedia.org/wiki/Uppsala'), '');
  for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '168.63.129.16', '::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(sandbox.isPublicAddress(address), false, address);
  for (const address of ['185.15.59.224', '2606:4700::1111']) assert.equal(sandbox.isPublicAddress(address), true, address);
  const realLookup = dns.lookup;
  dns.lookup = (host, opts, cb) => cb(null, [{ address: host === 'rebind.example' ? '127.0.0.1' : '93.184.215.14', family: 4 }]);
  const lookedUp = (host) => new Promise((resolve) => sandbox.safeLookup(host, {}, (error, address) => resolve(error ? error.code : address)));
  assert.equal(await lookedUp('rebind.example'), 'HOST_BLOCKED', 'a name that resolves to a private address is refused at connect time');
  assert.equal(await lookedUp('example.com'), '93.184.215.14');
  dns.lookup = realLookup;

  const html = '<html><head><title>Öppettider &amp; info</title><style>.x{}</style></head><body><nav>Menu</nav><h1>Stadsbiblioteket</h1><p>Öppet 10&ndash;19</p><script>evil()</script><ul><li>Lån</li><li>Wifi</li></ul><footer>Cookies</footer></body></html>';
  assert.deepEqual(sandbox.htmlToText(html), { title: 'Öppettider & info', text: 'Stadsbiblioteket\nÖppet 10-19\n\n- Lån\n- Wifi' });

  // Firecrawl search; the top result pages are read directly, with a Firecrawl
  // scrape only when the direct read finds almost no text.
  process.env.FIRECRAWL_API_KEY = 'fc-test';
  pages.set('https://bibliotek.example.se/', { status: 200, body: html.replace('Wifi', 'Wifi ' + 'Studierum och grupprum. '.repeat(10)) });
  pages.set('https://redirect.example.se/', { status: 302, location: 'https://final.example.se/page' });
  pages.set('https://final.example.se/page', { status: 200, type: 'text/plain', body: 'Plain text page '.repeat(20) });
  pages.set('https://app.example.se/', { status: 200, body: '<title>App</title><div id="root"></div>' });
  const scrapes = [];
  searchReply = (url, opts) => {
    const body = JSON.parse(opts.body || '{}');
    if (url.pathname === '/v2/scrape') {
      scrapes.push(body.url);
      return new Response(JSON.stringify({ success: true, data: { markdown: '# Rendered app\nText that only exists after JavaScript runs.', metadata: { title: 'App', sourceURL: body.url } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, data: { web: [
      { url: 'https://bibliotek.example.se/', title: 'Stadsbiblioteket', description: 'Opening hours' },
      { url: 'https://bibliotek.example.se/', title: 'Duplicate', description: 'dup' },
      { url: 'https://redirect.example.se/', title: 'Redirected', description: 'moved' },
      { url: 'https://app.example.se/', title: 'JavaScript app', description: 'needs rendering' },
      { url: 'https://unread.example.se/', title: 'Fourth', description: 'only a snippet' },
    ] } }), { status: 200 });
  };
  const [hit] = await TOOLS.web_search.run({ query: 'öppettider bibliotek', country: 'se' }, ctx);
  const search = searches.find((s) => s.url.pathname === '/v2/search');
  assert.equal(search.url.origin, 'https://api.firecrawl.dev');
  assert.equal(search.opts.headers.Authorization, 'Bearer fc-test');
  assert.equal(search.opts.redirect, 'manual', "the edge runtime rejects redirect: 'error'");
  assert.deepEqual(JSON.parse(search.opts.body), { query: 'öppettider bibliotek', limit: 8, sources: ['web'], country: 'SE' });
  assert.equal(hit.ok, true);
  const parsed = JSON.parse(hit.text);
  assert.equal(parsed.results.length, 4, 'duplicate URLs are merged');
  assert.match(parsed.results[0].text, /^Stadsbiblioteket\nÖppet 10-19/);
  assert.match(parsed.results[1].text, /^Plain text page/, 'redirects are followed');
  assert.match(parsed.results[2].text, /only exists after JavaScript/, 'a page without text is scraped by Firecrawl');
  assert.deepEqual(scrapes, ['https://app.example.se/'], 'pages with text cost no Firecrawl credits');
  assert.equal(parsed.results[3].text, undefined, 'only the top three results are read');
  assert.ok(!pageRequests.some((r) => r.url.includes('unread')));
  assert.ok(pageRequests.every((r) => r.lookup === sandbox.safeLookup), 'every page request resolves through the guard');

  // The chat reply (quick) reads only the first result and never waits for a scrape.
  pageRequests.length = 0; scrapes.length = 0;
  await TOOLS.web_search.run({ query: 'quick' }, { ...ctx, quick: true });
  assert.deepEqual([...new Set(pageRequests.map((r) => new URL(r.url).hostname))], ['bibliotek.example.se']);
  assert.equal(scrapes.length, 0);

  await TOOLS.web_search.run({ query: 'news', country: 'XX' }, ctx);
  assert.equal(JSON.parse(searches.filter((s) => s.url.pathname === '/v2/search').at(-1).opts.body).country, undefined, 'unknown country codes are dropped');
  searchReply = () => new Response(JSON.stringify({ success: true, data: { web: [] } }), { status: 200 });
  assert.match((await TOOLS.web_search.run({ query: 'nothing' }, ctx))[0].text, /No results/);
  searchReply = () => new Response(JSON.stringify({ success: false, error: 'Insufficient credits' }), { status: 402 });
  const [down] = await TOOLS.web_search.run({ query: 'busy' }, ctx);
  assert.equal(down.ok, false);
  assert.match(down.error, /Insufficient credits/);

  // Reading URLs directly works for any public page, never a private one, and
  // private addresses are never passed to Firecrawl either.
  scrapes.length = 0;
  searchReply = (url, opts) => { scrapes.push(JSON.parse(opts.body).url); return new Response('{}', { status: 500 }); };
  const [pageHit, privateHit] = await TOOLS.web_search.run({ urls: ['https://bibliotek.example.se/', 'http://169.254.169.254/latest'] }, ctx);
  assert.equal(pageHit.ok, true);
  assert.equal(pageHit.title, 'Öppettider & info');
  assert.equal(privateHit.ok, false);
  assert.match(privateHit.error, /private address/);
  assert.deepEqual(scrapes, []);

  // Without a Firecrawl key, DuckDuckGo instant answers are used.
  delete process.env.FIRECRAWL_API_KEY;
  searchReply = () => new Response(JSON.stringify({ Heading: 'Uppsala', AbstractText: 'A city in Sweden.', AbstractURL: 'https://en.wikipedia.org/wiki/Uppsala', RelatedTopics: [] }), { status: 200 });
  const [fallback] = await TOOLS.web_search.run({ query: 'Uppsala' }, ctx);
  assert.equal(searches.at(-1).url.hostname, 'api.duckduckgo.com');
  assert.equal(JSON.parse(fallback.text).abstract, 'A city in Sweden.');

  await assert.rejects(TOOLS.web_search.run({}, ctx), /query or URL is required/);
  console.log('web search: firecrawl with page text and scrape fallback, public-web guard (address, DNS, redirects), quick lookups, duckduckgo fallback: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
