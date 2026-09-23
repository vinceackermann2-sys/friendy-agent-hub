/* Tool registry — Agents API shape adapted to our stack.
   Each tool: { name, type, description, approval, run(args, ctx) }.
   - Tool search: pickTools(task) loads only relevant definitions (saves tokens).
   - Programmatic calling: runParallel executes independent calls concurrently.
   ctx: { userId, sessionId, trace (push fn), signal }
   App actions run through Composio (per-user OAuth) — never via vault PATs.
*/
const { fetchAllowlisted, readPage, publicUrlProblem } = require('./sandbox');
const { entry } = require('./tracing');
const composio = require('../composio');
const store = require('../store');
const azure = require('./azure-vm');
const live = require('./live');
const pc = require('./pc');
const { generateImage } = require('../foundry');
const { PLANS } = require('../plans');
const browserResult = (s) => ({ url:s.url, title:s.title, text:s.text, elements:s.elements, scrollY:s.scrollY, pageHeight:s.pageHeight, dialog:s.dialog || undefined, links:s.links, screenshot:s.screenshot, liveId:s.id, transport:s.relay ? 'cdp-screencast' : 'compatibility' });
const BROWSER_ACTIONS = new Set(['click', 'double_click', 'right_click', 'click_text', 'hover', 'type', 'key', 'scroll', 'select', 'drag', 'back', 'forward', 'reload', 'wait']);
const badInput = (message) => Object.assign(new Error(message), { code: 'BAD_INPUT' });
const inViewport = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1280 && y >= 0 && y <= 900;
const elementRef = (value) => (value == null || value === '' ? null : Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : NaN);
// Validates a model browser action into a relay input event. Agent events are
// marked so the VM moves the pointer visibly and pauses like a person.
function browserEvent(args) {
  const type = String(args.type || '');
  if (!BROWSER_ACTIONS.has(type)) throw badInput('Unsupported browser action.');
  const event = { type, agent: true };
  const ref = elementRef(args.ref);
  if (Number.isNaN(ref)) throw badInput('ref must be an element number from the latest page state.');
  if (ref) event.ref = ref;
  else if (args.x != null || args.y != null) {
    if (!inViewport(args.x, args.y)) throw badInput('Coordinates must be inside the 1280x900 browser viewport.');
    event.x = args.x; event.y = args.y;
  }
  const targeted = ref || event.x != null;
  if (['click', 'double_click', 'right_click', 'hover', 'select'].includes(type) && !targeted) throw badInput(`${type} needs a ref, or x and y.`);
  if (type === 'click_text') {
    event.text = String(args.text || '').slice(0, 200);
    if (!event.text) throw badInput('click_text needs the visible text.');
  } else if (type === 'type') {
    event.text = String(args.text ?? '').slice(0, 1000);
    if (!event.text && args.clear !== true) throw badInput('type needs text.');
    event.clear = args.clear === true;
    event.submit = args.submit === true;
  } else if (type === 'key') {
    event.key = String(args.key || 'Escape').slice(0, 40);
  } else if (type === 'scroll') {
    for (const axis of ['dx', 'dy']) {
      if (args[axis] == null) continue;
      if (!Number.isFinite(args[axis]) || Math.abs(args[axis]) > 5000) throw badInput('Invalid scroll distance.');
      event[axis] = args[axis];
    }
  } else if (type === 'select') {
    if (!ref) throw badInput('select needs the ref of a dropdown.');
    event.value = String(args.value ?? args.text ?? '').slice(0, 200);
  } else if (type === 'drag') {
    const toRef = elementRef(args.to_ref);
    if (Number.isNaN(toRef)) throw badInput('to_ref must be an element number.');
    if (!targeted) throw badInput('drag needs a start ref, or x and y.');
    if (toRef) event.to_ref = toRef;
    else if (inViewport(args.to_x, args.to_y)) { event.to_x = args.to_x; event.to_y = args.to_y; }
    else throw badInput('drag needs to_ref, or to_x and to_y inside the viewport.');
  } else if (type === 'wait') {
    if (args.text) event.text = String(args.text).slice(0, 200);
    else event.ms = Math.min(10000, Math.max(0, Number(args.ms) || 1000));
  }
  return event;
}
async function openPage(name, url, ctx) {
  const u = String(url || '');
  const problem = publicUrlProblem(u);
  if (problem) throw Object.assign(new Error(`Cannot open this address: ${problem}.`), { code: 'HOST_BLOCKED' });
  if (ctx.signal?.aborted) throw Object.assign(new Error('Task interrupted'), { name: 'AbortError' });
  if (process.env.BROWSER_TOOL === 'off') throw Object.assign(new Error('browser tool disabled'), { code: 'DISABLED' });
  const session = await live.forTool(ctx.userId, ctx.sessionId, ctx.trace);
  const out = browserResult(await live.navigate(session, u, ctx.trace));
  ctx.trace(entry('globe', `${name}: ${new URL(u).hostname}`));
  return out;
}
async function pageAction(name, args, ctx) {
  const event = browserEvent(args || {});
  if (name === 'browser_submit' && !String(args.summary || '').trim()) throw badInput('browser_submit needs a summary of what the action will do.');
  const session = await live.forTool(ctx.userId, ctx.sessionId, ctx.trace, false);
  const out = browserResult(await live.agentInput(session, event, ctx.trace));
  ctx.trace(entry('globe', `${name}: ${event.type}`));
  return out;
}
const COMPUTER_ACTIONS = new Set(['screenshot', 'click', 'double_click', 'right_click', 'move', 'drag', 'type', 'key', 'scroll', 'open_app', 'wait']);
// Validates a model computer action into a desktop relay input event. The VM
// checks coordinates and keys again against the actual screen.
function desktopEvent(args) {
  const type = String(args.action || args.type || '');
  if (!COMPUTER_ACTIONS.has(type)) throw badInput('Unsupported computer action.');
  const event = { type, agent: true };
  for (const field of ['x', 'y', 'to_x', 'to_y', 'dx', 'dy', 'ms']) {
    if (args[field] == null) continue;
    if (!Number.isFinite(args[field])) throw badInput(`${field} must be a number.`);
    event[field] = args[field];
  }
  if (['click', 'double_click', 'right_click', 'move', 'drag'].includes(type) && !inViewport(event.x, event.y)) throw badInput(`${type} needs x and y inside the 1280x900 screen.`);
  if (type === 'drag' && !inViewport(event.to_x, event.to_y)) throw badInput('drag needs to_x and to_y inside the screen.');
  if (type === 'type') {
    event.text = String(args.text ?? '').slice(0, 2000);
    if (!event.text && args.clear !== true) throw badInput('type needs text.');
    event.clear = args.clear === true;
    event.submit = args.submit === true;
  } else if (type === 'key') {
    event.key = String(args.key || '').slice(0, 60);
    if (!event.key) throw badInput('key needs a key such as Enter or ctrl+s.');
  } else if (type === 'open_app') {
    event.app = String(args.app || '');
    if (!['browser', 'files', 'editor'].includes(event.app)) throw badInput('open_app supports browser, files and editor.');
    if (args.url) {
      const problem = publicUrlProblem(args.url);
      if (problem) throw Object.assign(new Error(`Cannot open this address: ${problem}.`), { code: 'HOST_BLOCKED' });
      event.url = String(args.url);
    }
  }
  return event;
}
const desktopResult = (s) => ({ desktop:true, title:s.title, windows:s.windows, screenshot:s.screenshot, liveId:s.id, transport:'x11-stream' });
async function desktopAction(name, args, ctx) {
  const event = desktopEvent(args || {});
  if (name === 'computer_submit' && !String(args.summary || '').trim()) throw badInput('computer_submit needs a summary of what the action will do.');
  if (ctx.signal?.aborted) throw Object.assign(new Error('Task interrupted'), { name: 'AbortError' });
  const session = await live.forDesktop(ctx.userId, ctx.sessionId, ctx.trace);
  if (event.type === 'screenshot') await live.content(session);
  else await live.agentInput(session, event, ctx.trace);
  ctx.trace(entry('term', `${name}: ${event.type}`));
  return desktopResult(session);
}
// Credentials and payment details come from the user's vault by reference. The
// owner approves each use; the value goes straight to the VM, is never shown to
// the model, and is only typed on the approved site or window.
const secretRef = (value) => {
  const ref = String(value || '').trim();
  if (!/^sec_[A-Za-z0-9]{2,16}$/.test(ref)) throw badInput('secret must be a vault ref such as sec_ab12, from vault_list.');
  return ref;
};
async function vaultSecret(userId, ref) {
  const row = (await store.listSecrets(userId)).find((item) => item.ref === ref);
  if (!row) throw badInput(`No vault secret ${ref}. Use vault_list, or ask the user to add it to the vault.`);
  const value = await store.revealSecret(userId, row.id);
  if (!value) throw badInput(`Vault secret ${ref} is empty.`);
  return { name: row.name, value };
}
const hostMatches = (url, host) => {
  try {
    const current = new URL(url).hostname.toLowerCase(), want = String(host || '').toLowerCase().replace(/^www\./, '');
    return !!want && (current === want || current.endsWith(`.${want}`) || current === `www.${want}`);
  } catch { return false; }
};
async function secretApprovalDetail(args, { userId }) {
  let name = String(args.secret || '');
  try { name = (await store.listSecrets(userId)).find((item) => item.ref === args.secret)?.name || name; } catch {}
  const where = args.host ? `on ${args.host}` : `in the window “${args.window || 'unknown'}”`;
  return JSON.stringify({ ...args, summary: `Type your saved “${name}” ${where}` });
}
async function fillBrowserSecret(args, ctx) {
  const ref = secretRef(args.secret);
  const host = String(args.host || '').trim().toLowerCase();
  if (!host) throw badInput('host is the site the secret is for, such as github.com.');
  const event = browserEvent({ type: 'type', ref: args.ref, x: args.x, y: args.y, text: 'x', clear: true, submit: args.submit === true });
  if (event.ref == null && event.x == null) throw badInput('Give the ref, or x and y, of the field to fill.');
  const session = await live.forTool(ctx.userId, ctx.sessionId, ctx.trace, false);
  if (!hostMatches(session.url, host)) throw badInput(`The browser is on ${(() => { try { return new URL(session.url).hostname; } catch { return 'another page'; } })()}, not ${host}. Nothing was typed.`);
  const { value } = await vaultSecret(ctx.userId, ref);
  const out = browserResult(await live.agentInput(session, { ...event, text: value, secret: true }, ctx.trace));
  ctx.trace(entry('lock', `browser_fill_secret: ${ref} on ${host}`));
  return out;
}
async function fillDesktopSecret(args, ctx) {
  const ref = secretRef(args.secret);
  const window = String(args.window || '').trim().slice(0, 120);
  if (!window) throw badInput('window is text from the title of the window to type into, as shown in the latest windows list.');
  const event = desktopEvent({ action: 'type', x: args.x, y: args.y, text: 'x', clear: true, submit: args.submit === true });
  const session = await live.forDesktop(ctx.userId, ctx.sessionId, ctx.trace, false);
  const { value } = await vaultSecret(ctx.userId, ref);
  await live.agentInput(session, { ...event, text: value, secret: true, expectTitle: window }, ctx.trace);
  ctx.trace(entry('lock', `computer_fill_secret: ${ref}`));
  return desktopResult(session);
}
const computerResult = (out, ctx) => {
  const session = pc.getOrCreate(ctx.userId, ctx.sessionId);
  const lines = [out.stdout, out.stderr].filter(Boolean).map(String);
  pc.report(session, { lines, who:'agent' });
  return { ...out, pcId:session.pcId };
};

// Lowercase and fold to ASCII (sök→sok, ø→o, æ→ae, ß→ss) so keyword stems stay ASCII.
const foldText = (text) => String(text || '').toLowerCase().replace(/ø/g,'o').replace(/æ/g,'ae').replace(/ß/g,'ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'');

// Web search runs on Firecrawl (FIRECRAWL_API_KEY, managed through Lovable).
// A search costs 1 credit per 10 results. The top result pages are read
// directly for free; Firecrawl scrapes a page (1 credit) only when the direct
// read fails or finds almost no text, as on pages built by JavaScript.
const FIRECRAWL_API = 'https://api.firecrawl.dev/v2';
const SEARCH_COUNTRIES = new Set(['US','GB','SE','NO','DK','FI','DE','FR','ES','NL','IT','PT','PL','AT','CH','BE','IE','CA','AU','NZ']);
const firecrawlKey = () => String(process.env.FIRECRAWL_API_KEY || '').trim();
async function firecrawl(pathname, body, signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const r = await fetch(`${FIRECRAWL_API}${pathname}`, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${firecrawlKey()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.success === false) throw new Error(`Firecrawl ${pathname.slice(1)} failed: ${String(json.error || `HTTP ${r.status}`).slice(0, 200)}`);
  return json.data;
}
async function scrapePage(url, signal, timeoutMs = 20000) {
  const data = await firecrawl('/scrape', { url, formats: ['markdown'], onlyMainContent: true, timeout: timeoutMs }, signal, timeoutMs + 5000);
  const title = Array.isArray(data?.metadata?.title) ? data.metadata.title[0] : data?.metadata?.title;
  return { url: data?.metadata?.sourceURL || url, title: String(title || ''), text: String(data?.markdown || '') };
}
// Reads a public page as text: directly first, then through Firecrawl if needed.
async function readWebPage(url, { signal, timeoutMs = 8000, maxChars = 12000, fallback = true } = {}) {
  let page = null, failure = null;
  try { page = await readPage(url, { signal, timeoutMs, maxChars }); } catch (error) { failure = error; }
  // Private addresses are refused outright, never sent to Firecrawl.
  if (failure?.code === 'HOST_BLOCKED') throw failure;
  if (fallback && (!page || page.text.trim().length < 200) && firecrawlKey()) {
    try {
      const scraped = await scrapePage(url, signal);
      if (scraped.text.trim()) return { ...scraped, text: scraped.text.slice(0, maxChars) };
    } catch (error) { failure = failure || error; }
  }
  if (page) return page;
  throw failure;
}
async function searchWeb(query, { country } = {}, ctx) {
  const q = String(query).slice(0, 400);
  if (!firecrawlKey()) {
    const u = `https://api.duckduckgo.com/?q=${encodeURIComponent(q.slice(0, 300))}&format=json&no_html=1&skip_disambig=1`;
    const r = await fetchAllowlisted(u, { signal: ctx.signal });
    return { url: u, provider: 'duckduckgo', text: instantAnswer(await r.text()) };
  }
  const body = { query: q, limit: 8, sources: ['web'] };
  const cc = String(country || '').toUpperCase();
  if (SEARCH_COUNTRIES.has(cc)) body.country = cc;
  const data = await firecrawl('/search', body, ctx.signal, 15000);
  const seen = new Set();
  const results = (data?.web || []).filter((item) => item.url && !seen.has(item.url) && seen.add(item.url)).slice(0, 8)
    .map((item) => ({ title: String(item.title || '').slice(0, 200), url: item.url, snippet: String(item.description || '').slice(0, 400) }));
  // The chat reply reads one page directly to stay fast; tasks read the top three.
  const readCount = ctx.quick ? 1 : 3;
  await Promise.all(results.slice(0, readCount).map(async (item) => {
    try { item.text = (await readWebPage(item.url, { signal: ctx.signal, timeoutMs: ctx.quick ? 4000 : 7000, maxChars: 1800, fallback: !ctx.quick })).text; } catch {}
  }));
  const text = results.length ? JSON.stringify({ results }) : JSON.stringify({ note: 'No results found for this query.' });
  return { url: `search:${q}`, provider: 'firecrawl', text };
}

// DuckDuckGo instant answers arrive as verbose JSON; keep only what a model can use.
function instantAnswer(raw) {
  let json;
  try { json = JSON.parse(raw); } catch { return raw; }
  const topics = (json.RelatedTopics || []).flatMap((t) => t.Topics || [t]).filter((t) => t.Text).slice(0, 8);
  const out = { heading:json.Heading || undefined, answer:json.Answer || undefined, abstract:json.AbstractText || undefined,
    source:json.AbstractURL || undefined, definition:json.Definition || undefined, related:topics.map((t) => ({ text:t.Text, url:t.FirstURL })) };
  if (!out.answer && !out.abstract && !out.definition && !topics.length) return JSON.stringify({ note:'No instant answer found for this query.' });
  return JSON.stringify(out);
}

const CAPABILITY_ALIASES = {
  mejl:'email mail inbox', epost:'email mail inbox', kalender:'calendar schedule',
  minne:'memory remember', glom:'forget memory', webb:'web browser search',
  sok:'search find', fil:'file workspace', kod:'code script', kop:'buy shop purchase',
  betala:'pay payment shop', automatisera:'automation schedule trigger',
  webblasare:'web browser', surfa:'web browser', boka:'book browser form', formular:'form browser',
  nettleser:'web browser', bestill:'book browser shop', husk:'memory remember', glem:'forget memory',
  suche:'search find', suchen:'search find', buchen:'book browser form', datei:'file workspace',
  recherche:'search find', chercher:'search find', navigateur:'web browser', reserver:'book browser form', fichier:'file workspace',
  buscar:'search find', navegador:'web browser', reservar:'book browser form', archivo:'file workspace', correo:'email mail inbox',
};
function capabilityTerms(query) {
  const raw=foldText(query);
  const terms=raw.replace(/[^a-z0-9_\s-]/g,' ').split(/\s+/).filter(Boolean);
  return [...new Set(terms.flatMap(term=>[term,...String(CAPABILITY_ALIASES[term] || '').split(/\s+/).filter(Boolean)]))];
}

const TOOLS = {
  capability_search: {
    name:'capability_search', type:'function', approval:false,
    description:'Find the agent tools that can handle a request when the available capability is unclear. Matching tools become available on the next step.',
    run:async({query},ctx)=>{
      const terms=capabilityTerms(query);
      if(!terms.length)throw Object.assign(new Error('Capability query required.'),{code:'BAD_INPUT'});
      const matches=Object.values(TOOLS).filter(tool=>tool.name!=='capability_search').map(tool=>{
        const haystack=`${tool.name} ${tool.type || ''} ${tool.description || ''}`.toLowerCase();
        const score=terms.reduce((sum,term)=>sum+(haystack.includes(term)?(tool.name.includes(term)?4:1):0),0);
        return {tool,score};
      }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score || a.tool.name.localeCompare(b.tool.name)).slice(0,8);
      ctx.trace(entry('box',`capability_search: ${matches.length} matches`));
      return {tools:matches.map(({tool})=>({name:tool.name,description:tool.description,approval:!!tool.approval}))};
    },
  },
  web_search: {
    name: 'web_search', type: 'web_search', approval: false,
    description: 'Search the public web (top results include page text) or read up to 4 public URLs as text.',
    run: async ({ query, urls = [], country }, ctx) => {
      if (query) {
        const t0 = Date.now();
        try {
          const out = await searchWeb(query, { country }, ctx);
          ctx.trace(entry('globe', `web_search: ${out.provider} · ${Date.now() - t0}ms`));
          return [{ url: out.url, ok: true, text: out.text.slice(0, 12000) }];
        } catch (e) {
          ctx.trace(entry('alert', `web_search failed: ${e.message}`));
          return [{ url: `search:${String(query).slice(0, 100)}`, ok: false, error: e.message }];
        }
      }
      if (!urls.length) throw Object.assign(new Error('A search query or URL is required.'), { code:'BAD_INPUT' });
      // Any public page can be read; private and internal addresses are refused.
      return Promise.all(urls.slice(0, 4).map(async (u) => {
        const t0 = Date.now();
        try {
          const page = await readWebPage(u, { signal: ctx.signal, maxChars: 12000 });
          ctx.trace(entry('globe', `web_search: ${new URL(page.url).hostname} · ${Date.now() - t0}ms`));
          return { url: page.url, ok: true, title: page.title, text: page.text, note: page.note };
        } catch (e) {
          ctx.trace(entry('alert', `web_search failed: ${e.message}`));
          return { url: u, ok: false, error: e.message };
        }
      }));
    },
  },
  composio_apps: {
    name: 'composio_apps', type: 'function', approval: false,
    description: 'List the user’s Composio-connected apps (per-user OAuth via Belna Apps).',
    run: async (_, ctx) => {
      const connected = await composio.listConnected(ctx.userId);
      const active = connected.filter((c) => String(c.status).toUpperCase() === 'ACTIVE');
      ctx.trace(entry('box', `composio_apps: ${active.length} connected`));
      return active;
    },
  },
  composio_tools: {
    name:'composio_tools', type:'function', approval:false,
    description:'Discover exact enabled tool names and argument schemas for one connected app.',
    run:async ({toolkit,query},ctx) => {
      const slug=String(toolkit || '').toLowerCase().trim();
      if(!/^[a-z0-9_-]{2,60}$/.test(slug))throw Object.assign(new Error('Valid toolkit required.'),{code:'BAD_INPUT'});
      const connected=await composio.listConnected(ctx.userId);
      if(!connected.some(item=>String(item.toolkit || item.slug || '').toLowerCase()===slug&&String(item.status).toUpperCase()==='ACTIVE'))throw Object.assign(new Error('Connect this app under Apps first.'),{code:'BAD_INPUT'});
      const tools=await composio.listTools(slug,{limit:20,query:String(query || '').slice(0,100)});
      ctx.trace(entry('box',`composio_tools: ${slug} ${tools.length}`));
      return tools.map(tool=>({name:tool.slug || tool.name,description:String(tool.description || '').slice(0,240),parameters:tool.input_parameters || tool.parameters || {}}));
    },
  },
  composio_execute: {
    name: 'composio_execute', type: 'function', approval: true,
    description: 'Run a Composio tool on behalf of the user via their connected app (e.g. GMAIL_FETCH_EMAILS, GITHUB_LIST_PRS). Requires the toolkit to be connected under Apps.',
    run: async ({ tool, args, connectedAccountId }, ctx) => {
      const slug = String(tool || '').toUpperCase().trim();
      if (!/^[A-Z0-9_]+$/.test(slug)) throw Object.assign(new Error('Valid tool slug required.'), { code: 'BAD_INPUT' });
      const out = await composio.executeTool(ctx.userId, { tool: slug, args: args || {}, connectedAccountId });
      if (out && out.successful === false) throw new Error(String(out.error || 'App action failed.').slice(0, 400));
      ctx.trace(entry('box', `composio_execute: ${slug} done`));
      return out.data || out;
    },
  },
  shell: {
    name: 'shell', type: 'code', approval: false,
    description: 'Run a bash command in the user worker container inside the private Azure VM. Only the task workspace is mounted and files persist through the VM workspace backup.',
    run: async ({ command }, ctx) => {
      const out = await azure.execInSandbox(ctx.userId, 'shell', { command }, { alreadyRunning: ctx.vmReady === true, taskId: ctx.taskId });
      ctx.trace(entry('term', `shell: exit on ${out.vmName}`));
      return computerResult(out, ctx);
    },
  },
  computer_screenshot: {
    name: 'computer_screenshot', type: 'browser', approval: false,
    description: 'Open a public page in the user Azure VM browser (Chromium) and show it live in Canvas.',
    run: async ({ url }, ctx) => openPage('computer_screenshot', url, ctx),
  },
  browser_open: {
    name: 'browser_open', type: 'browser', approval: false,
    description: 'Open any public http or https page in the user Azure VM browser (Chromium). Returns the page text, numbered interactive elements and a live view.',
    run: async ({ url }, ctx) => openPage('browser_open', url, ctx),
  },
  browser_action: {
    name: 'browser_action', type: 'browser', approval: false,
    description: 'Use the current browser page like a person: click, double_click, right_click, hover, type, key, scroll, select, drag, back, forward, reload, wait. Target elements by ref from the latest page state, or by x,y from the screenshot.',
    run: async (args, ctx) => pageAction('browser_action', args, ctx),
  },
  browser_submit: {
    name: 'browser_submit', type: 'browser', approval: true,
    description: 'The final click or key press that buys, pays, books, sends, posts, deletes or changes account settings on a website. Same arguments as browser_action plus a summary. REQUIRES owner approval.',
    run: async (args, ctx) => pageAction('browser_submit', args, ctx),
  },
  computer_action: {
    name: 'computer_action', type: 'computer', approval: false,
    description: 'Use the virtual computer (a Linux desktop on the user Azure VM) like a person: screenshot, click, double_click, right_click, move, drag, type, key, scroll, open_app (browser, files, editor) and wait. Coordinates are pixels on the 1280x900 screen.',
    run: async (args, ctx) => desktopAction('computer_action', args, ctx),
  },
  computer_submit: {
    name: 'computer_submit', type: 'computer', approval: true,
    description: 'The final click or key press on the virtual computer that buys, pays, books, sends, posts, deletes or changes account settings. Same arguments as computer_action plus a summary. REQUIRES owner approval.',
    run: async (args, ctx) => desktopAction('computer_submit', args, ctx),
  },
  vault_list: {
    name: 'vault_list', type: 'function', approval: false,
    description: 'List the names and refs of the credentials and payment details the user saved in the vault. Values are never shown.',
    run: async (_, ctx) => {
      const secrets = await store.listSecrets(ctx.userId);
      ctx.trace(entry('lock', `vault_list: ${secrets.length}`));
      return { secrets: secrets.map((item) => ({ ref: item.ref, name: item.name })) };
    },
  },
  browser_fill_secret: {
    name: 'browser_fill_secret', type: 'browser', approval: true,
    description: 'Type a saved vault secret (password, username, card number, expiry, CVC) into a field of the current browser page. Give the field by ref or x,y and host, the site it is for. REQUIRES owner approval; only types when the page is on that host.',
    approvalDetail: secretApprovalDetail,
    run: async (args, ctx) => fillBrowserSecret(args, ctx),
  },
  computer_fill_secret: {
    name: 'computer_fill_secret', type: 'computer', approval: true,
    description: 'Type a saved vault secret into a field on the virtual computer at x,y. window is text from the title of the window it is for. REQUIRES owner approval; only types when that window is active.',
    approvalDetail: secretApprovalDetail,
    run: async (args, ctx) => fillDesktopSecret(args, ctx),
  },
  code_run: {
    name: 'code_run', type: 'code', approval: false,
    description: 'Execute js/python/bash ONLY inside the hardened worker container inside the user Azure VM. Disabled without Azure.',
    run: async (args, ctx) => {
      const out = await azure.execInSandbox(ctx.userId, 'code_run', args, { alreadyRunning: ctx.vmReady === true, taskId: ctx.taskId });
      ctx.trace(entry('code', `code_run: ${out.language} on ${out.vmName}`));
      return computerResult(out, ctx);
    },
  },
  build_page: {
    name: 'build_page', type: 'function', approval: false,
    description: 'Generate a single-file HTML page via the model (sandboxed preview).',
    run: async ({ html }, ctx) => {
      ctx.trace(entry('code', `build_page: ${String(html || '').length} chars (sandboxed iframe)`));
      return { html: String(html || '').slice(0, 60000) };
    },
  },
  memory_write: {
    name: 'memory_write', type: 'function', approval: false,
    description: 'Persist a user-scoped memory.',
    run: async ({ text, category, importance }, ctx) => {
      const m = await store.addMemory(ctx.userId,String(text).slice(0,2000),'agent',{category,importance,chatId:ctx.sessionId});
      ctx.trace(entry('book', `memory_write: saved (${String(text).slice(0, 60)}…)`));
      return m;
    },
  },
  memory_search: {
    name:'memory_search',type:'function',approval:false,description:'Search all active account memory without loading the full archive into the prompt.',
    run:async({query,limit},ctx)=>store.searchMemories(ctx.userId,String(query || '').slice(0,300),Math.min(Number(limit) || 8,20)),
  },
  memory_get: {
    name:'memory_get',type:'function',approval:false,description:'Read one account memory by exact id.',
    run:async({id},ctx)=>{const memory=await store.getMemory(ctx.userId,String(id || ''));if(!memory)throw Object.assign(new Error('Memory not found.'),{code:'NOT_FOUND'});return memory;},
  },
  memory_update: {
    name:'memory_update',type:'function',approval:false,description:'Correct an active memory. Preserves the old value as superseded history.',
    run:async({id,text,category,importance},ctx)=>store.updateMemory(ctx.userId,String(id || ''),{text,category,importance,src:'agent_correction'}),
  },
  memory_delete: {
    name:'memory_delete',type:'function',approval:false,description:'Forget one active memory by exact id when the owner asks.',
    run:async({id},ctx)=>{const count=await store.delMemory(ctx.userId,String(id || ''));return {deleted:count>0,count,id};},
  },
  history_search: {
    name: 'history_search', type: 'function', approval: false,
    description: 'Keyword search over the user\'s own past chat turns (transcripts).',
    run: async ({ query }, ctx) => {
      const store = require('../store');
      const turns = await store.searchTurns(ctx.userId, String(query || '').slice(0, 200));
      ctx.trace(entry('file', `history_search: ${turns.length} past turns matched`));
      return turns.map((t) => ({ role: t.role, text: String(t.text).slice(0, 600) }));
    },
  },
  canvas_show: {
    name: 'canvas_show', type: 'function', approval: false,
    description: 'Present a card or text file in the user Canvas.',
    run: async ({ title, format, content }, ctx) => {
      const allowed = new Set(['text','md','json','csv','html','svg','code']);
      const out = { title:String(title || 'Canvas item').slice(0,120), format:allowed.has(format) ? format : 'text', content:String(content || '').slice(0,60000) };
      ctx.trace(entry('board', `canvas_show: ${out.title}`));
      return out;
    },
  },
  trigger_list: {
    name: 'trigger_list', type: 'function', approval: false,
    description: 'List the user’s schedule, connected-app, and sub-agent watchers.',
    run: async (_, ctx) => {
      const store = require('../store');
      const agents = await store.listSubAgents(ctx.userId);
      ctx.trace(entry('clock', `trigger_list: ${agents.length} automation watchers`));
      return agents.map(({ id, name, enabled, trigger, lastStatus, nextRunAt }) => ({ id, name, enabled, trigger, lastStatus, nextRunAt }));
    },
  },
  image_generate: {
    name: 'image_generate', type: 'image', approval: false,
    description: 'Create a new image with GPT Image 2 and return it as a PNG file in Canvas.',
    run: async ({ prompt, size, quality, background }, ctx) => {
      const sub = await store.getSubscription(ctx.userId);
      const paid = ['active','canceling','trialing'].includes(sub.status)
        && (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now());
      const plan = paid && PLANS[sub.plan] ? sub.plan : 'free';
      const claimId = await store.claimTokenDaily(ctx.userId, 'image', PLANS[plan].imagesPerDay);
      if (!claimId) throw Object.assign(new Error('Your daily image limit or token allowance is used up.'), { code: 'NO_CREDIT' });
      let out;
      try { out = await generateImage({ prompt, size, quality, background, signal: ctx.signal }); }
      catch (error) { await store.releaseTokenDaily(ctx.userId, claimId); throw error; }
      await store.logUsage(ctx.userId, { model: out.model, usage: out.usage, cost: out.costUsd,
        usageEstimated: out.usageEstimated, claimId });
      ctx.trace(entry('image', `image_generate: ${out.name}`));
      return out;
    },
  },
  wallet_status: {
    name: 'wallet_status', type: 'function', approval: false,
    description: 'Read this account’s agent wallet address, balances, attached card status (last4 only), and remaining daily spend. Never invent numbers.',
    run: async (_, ctx) => {
      const privy = require('../privy');
      const snap = await privy.agentStatus(ctx.userId);
      ctx.trace(entry('wallet', `wallet_status: ${snap.address ? 'ready' : 'missing'}`));
      return snap;
    },
  },
  wallet_transfer: {
    name: 'wallet_transfer', type: 'function', approval: true,
    description: 'Send USDC or ETH from the agent wallet. REQUIRES owner approval. Never send without an explicit destination and amount.',
    run: async ({ to, amount, asset }, ctx) => {
      const privy = require('../privy');
      const out = await privy.transfer(ctx.userId, { to, amount, asset: asset || 'usdc', confirm: true });
      ctx.trace(entry('wallet', `wallet_transfer: ${out.asset} ${out.amount} sent`));
      return { status: out.status, asset: out.asset, amount: out.amount, to: String(out.to).slice(0, 6) + '…' + String(out.to).slice(-4), hash: out.hash };
    },
  },
  wallet_purchase: {
    name: 'wallet_purchase', type: 'function', approval: true,
    description: 'Ask the owner to approve a purchase. method=card authorizes a matching charge on the attached card without revealing the card number. method=wallet sends USDC to to=. REQUIRES owner approval. Never ask for or use full card numbers.',
    run: async ({ amount, merchant, reason, method, to }, ctx) => {
      const privy = require('../privy');
      const out = await privy.purchase(ctx.userId, { amount, merchant, reason, method, to, confirm: true });
      ctx.trace(entry('wallet', `wallet_purchase: ${out.method} ${out.amount} ${out.merchant} ${out.status}`));
      return out;
    },
  },
  shop_status: {
    name: 'shop_status', type: 'function', approval: false,
    description: 'Read whether Shop Pay is connected, remaining daily Shop Pay spend, and recent orders. Never invent connection state or amounts. Never request tokens or card numbers.',
    run: async (_, ctx) => {
      const shoppay = require('../shoppay');
      const snap = await shoppay.agentStatus(ctx.userId);
      ctx.trace(entry('wallet', `shop_status: ${snap.connected ? 'connected' : 'disconnected'}`));
      return snap;
    },
  },
  shop_search: {
    name: 'shop_search', type: 'function', approval: false,
    description: 'Search the Shopify UCP catalog for products the user can buy with Shop Pay. Returns titles, prices, merchant domains, and variant ids only.',
    run: async ({ query, country, limit }, ctx) => {
      const shoppay = require('../shoppay');
      const out = await shoppay.searchCatalog(ctx.userId, { query, country, limit });
      ctx.trace(entry('wallet', `shop_search: ${(out.products || []).length} products`));
      return out;
    },
  },
  shop_product: {
    name: 'shop_product', type: 'function', approval: false,
    description: 'Look up one Shopify catalog product or variant by id. Returns display-safe details and merchant domain.',
    run: async ({ id }, ctx) => {
      const shoppay = require('../shoppay');
      const out = await shoppay.getProduct(ctx.userId, { id });
      ctx.trace(entry('wallet', `shop_product: ${out.product && out.product.title}`));
      return out;
    },
  },
  shop_checkout: {
    name: 'shop_checkout', type: 'function', approval: false,
    description: 'Create or refresh a UCP checkout at a merchant. Does not charge. Pass merchant domain plus items[{id,quantity}] or an existing checkoutId to update buyer/shipping.',
    run: async (args, ctx) => {
      const shoppay = require('../shoppay');
      const out = args && args.checkoutId
        ? await shoppay.updateCheckout(ctx.userId, args)
        : await shoppay.createCheckout(ctx.userId, args);
      ctx.trace(entry('wallet', `shop_checkout: ${out.status} ${out.merchant}`));
      return out;
    },
  },
  shop_purchase: {
    name: 'shop_purchase', type: 'function', approval: true,
    description: 'Complete a Shop Pay UCP checkout after owner approval of the exact merchant and checkoutId. Never collect card numbers. If the merchant requires buyer review, returns continueUrl for Shop Pay.',
    run: async ({ merchant, checkoutId }, ctx) => {
      const shoppay = require('../shoppay');
      const out = await shoppay.completePurchase(ctx.userId, { merchant, checkoutId, confirm: true });
      ctx.trace(entry('wallet', `shop_purchase: ${out.status} ${out.merchant} ${out.amount}`));
      return out;
    },
  },
  shop_order: {
    name: 'shop_order', type: 'function', approval: false,
    description: 'Read one Shop Pay / UCP order by merchant domain and order id. Never invent tracking or payment details.',
    run: async ({ merchant, orderId }, ctx) => {
      const shoppay = require('../shoppay');
      const out = await shoppay.getOrder(ctx.userId, { merchant, orderId });
      ctx.trace(entry('wallet', `shop_order: ${out.status}`));
      return out;
    },
  },
  mail_status: {
    name: 'mail_status', type: 'function', approval: false,
    description: 'Read this agent’s own mailbox address, unread count, and whether sending is ready. Never invent the address.',
    run: async ({ agent_name }, ctx) => {
      const mail = require('../mail');
      const snap = await mail.agentStatus(ctx.userId, agent_name);
      ctx.trace(entry('mail', `mail_status: ${snap.address || 'missing'}`));
      return snap;
    },
  },
  mail_list: {
    name: 'mail_list', type: 'function', approval: false,
    description: 'List recent messages in this agent’s own inbox or sent folder. Never invent emails.',
    run: async ({ folder, limit }, ctx) => {
      const mail = require('../mail');
      const rows = await mail.agentList(ctx.userId, { folder: folder === 'sent' ? 'sent' : 'inbox', limit });
      ctx.trace(entry('mail', `mail_list: ${rows.length} ${folder || 'inbox'}`));
      return rows;
    },
  },
  mail_read: {
    name: 'mail_read', type: 'function', approval: false,
    description: 'Read one message from this agent’s mailbox by id. Marks inbound mail read.',
    run: async ({ id }, ctx) => {
      const mail = require('../mail');
      const msg = await mail.readMessage(ctx.userId, String(id || ''));
      ctx.trace(entry('mail', `mail_read: ${msg.subject}`));
      return msg;
    },
  },
  mail_draft: {
    name: 'mail_draft', type: 'function', approval: false,
    description: 'Save a draft in this agent’s mailbox. Does not send.',
    run: async ({ to, subject, body, id }, ctx) => {
      const mail = require('../mail');
      const draft = await mail.saveDraft(ctx.userId, { to, subject, body, id });
      ctx.trace(entry('mail', `mail_draft: ${draft.subject}`));
      return draft;
    },
  },
  mail_send: {
    name: 'mail_send', type: 'function', approval: true,
    description: 'Send email from this agent’s own mailbox (name@mail.belna.se). REQUIRES owner approval of exact to/subject/body.',
    run: async ({ to, subject, body, in_reply_to, agent_name }, ctx) => {
      const mail = require('../mail');
      const out = await mail.send(ctx.userId, { to, subject, body, inReplyTo: in_reply_to, agentName: agent_name, confirm: true });
      ctx.trace(entry('mail', `mail_send: ${out.subject} → ${(out.to || []).join(', ')}`));
      return { id: out.id, to: out.to, subject: out.subject, from: out.from };
    },
  },
  trigger_create: {
    name: 'trigger_create', type: 'function', approval: true,
    description: 'Create an isolated automation chat with a schedule, connected-app, or sub-agent trigger.',
    run: async (args, ctx) => {
      const store = require('../store');
      const { normalizeSubAgent, nextRunAt } = require('./triggers');
      const input = normalizeSubAgent(args || {});
      const existing = await store.listSubAgents(ctx.userId);
      if (existing.length >= 25) throw Object.assign(new Error('Sub-agent limit reached.'), { code: 'BAD_INPUT' });
      if (input.trigger.type === 'subagent' && !existing.some((agent) => agent.id === input.trigger.sourceAgentId)) throw Object.assign(new Error('Source sub-agent not found.'), { code: 'BAD_INPUT' });
      if (input.trigger.type === 'app') {
        const ok = await composio.isToolkitConnected(ctx.userId, input.trigger.app);
        if (!ok) throw Object.assign(new Error('Connected app required — connect it under Apps first.'), { code: 'BAD_INPUT' });
      }
      const agent = await store.createSubAgent(ctx.userId, input, nextRunAt(input.trigger));
      ctx.trace(entry('clock', `trigger_create: ${agent.name}`));
      return agent;
    },
  },
};

// Tool search: load only relevant definitions for the task (token saving).
// Keywords cover English, Swedish, Norwegian, Danish, German, French and Spanish,
// matched against foldText output, so stems are ASCII. capability_search still
// covers anything these patterns miss.
const TOOL_KEYWORDS = {
  memory: /(remember|memory|memories|forget|forgot|correct that|actually|used to|no longer|kom ihag|minns|minne|glom|husk|glem|merk dir|erinner|vergiss|gedachtnis|souviens|rappelle-toi|oublie|memoire|recuerda|olvida|memoria)/,
  apps: /(gmail|slack|calendar|kalender|calendrier|calendario|agenda|notion|drive|sheet|github|\bpr\b|pull request|repo|diff|code review|tweet|linkedin|hubspot|stripe|task|issue|ticket|arende)/,
  mail: /(email|e-mail|e-post|epost|inbox|inkorg|innboks|indbakke|posteingang|mailbox|mail |reply to|send (a |an )?mail|skriv (ett )?mejl|mejl|courriel|boite de reception|correo)/,
  page: /(build|landing|page|site|website|dashboard|bygg|webbsida|hemsida|landningssida|nettside|hjemmeside|webseite|pagina|sitio)/,
  image: /(generate|create|make|draw|design|skapa|gor|rita|generera|designa|lag|tegn|erstell|zeichne|generier|genere|cree|creer|dessine|crea|dibuja|genera).{0,30}(image|picture|photo|illustration|artwork|logo|bild|foto|logga|logotyp|bilde|billede|dessin|imagen|dibujo|ilustracion)|\b(image|picture|photo|illustration)\s+(?:of|for)\b/,
  browser: /(browse|browser|website|web page|fill|form|book|reservation|sign in|log in|surfa|webblasare|webbsida|hemsida|fyll i|formular|boka|reserv|logga in|nettleser|nettside|hjemmeside|skjema|bestill|logg inn|log ind|webseite|ausfull|buchen|anmeld|einlogg|navigat|site web|formulaire|rempli|connecte|connexion|naveg|sitio web|pagina web|formulario|rellen|inicia sesion|inicie sesion)/,
  code: /(code|script|terminal|shell|file|workspace|python|javascript|debug|compile|install|kod|skript|fil\b|filen|filer|datei|programm|fichier|codigo|archivo|instala)/,
  history: /(earlier|yesterday|last (week|time|chat)|we (talked|discussed)|discussed|previous|igar|i gar|forra veckan|senast|vi pratade|diskuterade|tidigare|forrige uke|sidste uge|snakket|talte om|tidligere|gestern|letzte woche|besprochen|vorhin|la semaine derniere|on a parle|discute|precedent|ayer|la semana pasada|hablamos|discutimos|anterior)/,
  triggers: /(trigger|watch|schedule|recurring|every (?:hour|day|week)|sub.?agent|automation|schemalagg|varje (?:timme|dag|vecka)|aterkommande|bevaka|automatiser|paminn|hver (?:time|dag|uke|uge)|overvak|zeitplan|jede (?:stunde|woche)|jeden tag|wiederkehrend|automatisier|uberwach|chaque (?:heure|jour|semaine)|planifi|recurren|automatis|surveill|cada (?:hora|dia|semana)|programa|automatiz|vigila)/,
  computer: /(computer|desktop|application|\bapp\b|window|file manager|spreadsheet|text editor|dator|datorn|skrivbord|fonster|programmet|datamaskin|skrivebord|vindue|rechner|anwendung|fenster|ordinateur|bureau|logiciel|fenetre|ordenador|escritorio|aplicacion|ventana)/,
  vault: /(log ?in|sign ?in|password|passcode|credential|account|checkout|pay\b|payment|card|logga in|inloggning|losenord|konto|betala|betalning|kort|logg inn|passord|log ind|adgangskode|anmelden|einloggen|passwort|konto|zahlung|karte|connexion|mot de passe|compte|paiement|carte|iniciar sesion|contrasena|cuenta|pago|tarjeta)/,
  shop: /(shop pay|shopify|shop_pay|\bshop\b|catalog|checkout|order|merchant|butik|bestall|kassa|bestell|kasse|boutique|commande|panier|marchand|tienda|pedido|carrito)/,
  wallet: /(wallet|pay|payment|transfer|usdc|\beth\b|invoice|payout|spend|debit card|virtual card|buy |purchase|planbok|betal|overfor|faktura|kop |lommebok|tegnebog|geldborse|bezahl|zahlung|uberweis|rechnung|kaufe|portefeuille|paie|paiement|virement|facture|achet|billetera|cartera|pago|paga|transferencia|factura|compra)/,
};
function pickTools(task) {
  const t = foldText(task);
  // web_search is read-only and cheap, so every task can look things up.
  const names = new Set(['memory_write','capability_search','web_search']);
  if (TOOL_KEYWORDS.memory.test(t)) { names.add('memory_search'); names.add('memory_get'); names.add('memory_update'); names.add('memory_delete'); }
  if (TOOL_KEYWORDS.apps.test(t)) { names.add('composio_apps'); names.add('composio_tools'); names.add('composio_execute'); }
  if (TOOL_KEYWORDS.mail.test(t)) { names.add('mail_status'); names.add('mail_list'); names.add('mail_read'); names.add('mail_draft'); names.add('mail_send'); }
  if (TOOL_KEYWORDS.page.test(t)) names.add('build_page');
  if (TOOL_KEYWORDS.image.test(t)) names.add('image_generate');
  if (TOOL_KEYWORDS.browser.test(t)) { names.add('browser_open'); names.add('browser_action'); names.add('browser_submit'); names.add('computer_screenshot'); }
  if (TOOL_KEYWORDS.code.test(t)) { names.add('shell'); names.add('code_run'); names.add('canvas_show'); }
  if (TOOL_KEYWORDS.computer.test(t)) { names.add('computer_action'); names.add('computer_submit'); }
  if (TOOL_KEYWORDS.vault.test(t)) { names.add('vault_list'); names.add('browser_fill_secret'); names.add('computer_fill_secret'); }
  if (TOOL_KEYWORDS.history.test(t)) names.add('history_search');
  if (TOOL_KEYWORDS.triggers.test(t)) { names.add('trigger_list'); names.add('trigger_create'); }
  const shopRequest = TOOL_KEYWORDS.shop.test(t);
  if (shopRequest) { names.add('shop_status'); names.add('shop_search'); names.add('shop_product'); names.add('shop_checkout'); names.add('shop_purchase'); names.add('shop_order'); }
  if (!shopRequest && TOOL_KEYWORDS.wallet.test(t)) { names.add('wallet_status'); names.add('wallet_transfer'); names.add('wallet_purchase'); }
  return [...names].map((n) => TOOLS[n]);
}

async function runParallel(calls, ctx) {
  return Promise.all(calls.map((c) => TOOLS[c.tool].run(c.args || {}, ctx)));
}

module.exports = { TOOLS, pickTools, runParallel };
