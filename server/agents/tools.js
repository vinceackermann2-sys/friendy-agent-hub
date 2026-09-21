/* Tool registry — Agents API shape adapted to our stack.
   Each tool: { name, type, description, approval, run(args, ctx) }.
   - Tool search: pickTools(task) loads only relevant definitions (saves tokens).
   - Programmatic calling: runParallel executes independent calls concurrently.
   ctx: { userId, sessionId, trace (push fn), signal }
   App actions run through Composio (per-user OAuth) — never via vault PATs.
*/
const { fetchAllowlisted } = require('./sandbox');
const { entry } = require('./tracing');
const composio = require('../composio');
const store = require('../store');
const azure = require('./azure-vm');
const live = require('./live');
const pc = require('./pc');
const browserResult = (s) => ({ url:s.url, title:s.title, text:s.text, links:s.links, screenshot:s.screenshot, liveId:s.id, transport:s.relay ? 'cdp-screencast' : 'compatibility' });
const computerResult = (out, ctx) => {
  const session = pc.getOrCreate(ctx.userId, ctx.sessionId);
  const lines = [out.stdout, out.stderr].filter(Boolean).map(String);
  pc.report(session, { lines, who:'agent' });
  return { ...out, pcId:session.pcId };
};

const CAPABILITY_ALIASES = {
  mejl:'email mail inbox', epost:'email mail inbox', kalender:'calendar schedule',
  minne:'memory remember', glom:'forget memory', webb:'web browser search',
  sok:'search find', fil:'file workspace', kod:'code script', kop:'buy shop purchase',
  betala:'pay payment shop', automatisera:'automation schedule trigger',
};
function capabilityTerms(query) {
  const raw=String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
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
    description: 'Search the public web or fetch allowlisted public sources.',
    run: async ({ query, urls = [] }, ctx) => {
      const targets = query ? [`https://api.duckduckgo.com/?q=${encodeURIComponent(String(query).slice(0,300))}&format=json&no_html=1&skip_disambig=1`] : urls;
      if (!targets.length) throw Object.assign(new Error('A search query or URL is required.'), { code:'BAD_INPUT' });
      return Promise.all(targets.slice(0, 4).map(async (u) => {
        const t0 = Date.now();
        try {
          const r = await fetchAllowlisted(u, { signal: ctx.signal });
          const text = (await r.text()).slice(0, 12000);
          ctx.trace(entry('globe', `web_search: ${new URL(u).hostname} · ${Date.now() - t0}ms`));
          return { url: u, ok: true, text };
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
    description: 'Open and display the live interactive page in the user Azure VM browser (Chromium).',
    run: async ({ url }, ctx) => {
      const { hostAllowed } = require('./sandbox');
      const u = String(url || '');
      if (!hostAllowed(u)) throw Object.assign(new Error('host blocked by sandbox allowlist'), { code: 'HOST_BLOCKED' });
      const session = await live.forTool(ctx.userId, ctx.sessionId, ctx.trace);
      const out = browserResult(await live.navigate(session, u, ctx.trace));
      ctx.trace(entry('globe', `computer_screenshot: ${new URL(u).hostname}`));
      return out;
    },
  },
  browser_open: {
    name: 'browser_open', type: 'browser', approval: false,
    description: 'Open one allowlisted URL in the user Azure VM browser (Chromium). Disabled until the VM boundary is configured.',
    run: async ({ url }, ctx) => {
      const { hostAllowed } = require('./sandbox');
      const u = String(url || '');
      if (!hostAllowed(u)) throw Object.assign(new Error('host blocked by sandbox allowlist'), { code: 'HOST_BLOCKED' });
      if (ctx.signal?.aborted) throw Object.assign(new Error('Task interrupted'), { name: 'AbortError' });
      if (process.env.BROWSER_TOOL === 'off') throw Object.assign(new Error('browser tool disabled'), { code: 'DISABLED' });
      const session = await live.forTool(ctx.userId, ctx.sessionId, ctx.trace);
      const out = browserResult(await live.navigate(session, u, ctx.trace));
      ctx.trace(entry('globe', `browser_open: ${new URL(u).hostname}`));
      return out;
    },
  },
  browser_action: {
    name: 'browser_action', type: 'browser', approval: false,
    description: 'Click or scroll the current Azure VM browser page.',
    run: async (args, ctx) => {
      const type = String(args.type || '');
      if (!['click', 'click_text', 'scroll', 'type', 'key'].includes(type)) throw Object.assign(new Error('Unsupported browser action.'), { code: 'BAD_INPUT' });
      const event = { type };
      if (type === 'click') {
        if (!Number.isFinite(args.x) || !Number.isFinite(args.y) || args.x < 0 || args.x > 1280 || args.y < 0 || args.y > 900) throw Object.assign(new Error('Click coordinates must be inside the browser viewport.'), { code: 'BAD_INPUT' });
        event.x = args.x; event.y = args.y;
      } else if (type === 'scroll') {
        if (!Number.isFinite(args.dy) || Math.abs(args.dy) > 3000) throw Object.assign(new Error('Invalid scroll distance.'), { code: 'BAD_INPUT' });
        event.dy = args.dy;
      } else if (type === 'click_text') {
        event.text = String(args.text || '').slice(0, 200);
        if (!event.text) throw Object.assign(new Error('Browser action text required.'), { code: 'BAD_INPUT' });
      } else if (type === 'type') {
        event.text = String(args.text || '').slice(0, 1000);
        if (!event.text) throw Object.assign(new Error('Text required.'), { code:'BAD_INPUT' });
      } else if (type === 'key') {
        event.key = String(args.key || 'Escape').slice(0, 40);
      }
      const session = await live.forTool(ctx.userId, ctx.sessionId, ctx.trace, false);
      const out = browserResult(await live.agentInput(session, event, ctx.trace));
      ctx.trace(entry('globe', `browser_action: ${type}`));
      return out;
    },
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
function pickTools(task) {
  const t = String(task || '').toLowerCase();
  const names = new Set(['memory_write','capability_search']);
  if (/(remember|memory|memories|forget|forgot|correct that|actually|used to|no longer)/.test(t)) { names.add('memory_search'); names.add('memory_get'); names.add('memory_update'); names.add('memory_delete'); }
  if (/(research|investigat|social|poll|sentiment|news|search|find)/.test(t)) names.add('web_search');
  if (/(gmail|slack|calendar|notion|drive|sheet|github|\bpr\b|pull request|repo|diff|code review|tweet|linkedin|hubspot|stripe|calendar|task|issue|ticket)/.test(t)) { names.add('composio_apps'); names.add('composio_tools'); names.add('composio_execute'); }
  if (/(email|e-mail|inbox|mailbox|mail |reply to|send (a |an )?mail|skriv (ett )?mejl|mejl)/.test(t)) { names.add('mail_status'); names.add('mail_list'); names.add('mail_read'); names.add('mail_draft'); names.add('mail_send'); }
  if (/(build|landing|page|site|website|dashboard)/.test(t)) names.add('build_page');
  if (/(browse|browser|website|web page|fill|form|book|reservation|sign in|log in)/.test(t)) { names.add('browser_open'); names.add('browser_action'); names.add('computer_screenshot'); }
  if (/(code|script|terminal|shell|file|workspace|python|javascript|debug|compile|install)/.test(t)) { names.add('shell'); names.add('code_run'); names.add('canvas_show'); }
  if (/(earlier|yesterday|last (week|time|chat)|we (talked|discussed)|discussed|previous)/.test(t)) names.add('history_search');
  if (/(trigger|watch|schedule|recurring|every (?:hour|day|week)|sub.?agent|automation)/.test(t)) { names.add('trigger_list'); names.add('trigger_create'); }
  const shopRequest = /(shop pay|shopify|shop_pay|\bshop\b|catalog|checkout|order|merchant)/.test(t);
  if (shopRequest) { names.add('shop_status'); names.add('shop_search'); names.add('shop_product'); names.add('shop_checkout'); names.add('shop_purchase'); names.add('shop_order'); }
  if (!shopRequest && /(wallet|pay|payment|transfer|usdc|\beth\b|invoice|payout|spend|debit card|virtual card|buy |purchase)/.test(t)) { names.add('wallet_status'); names.add('wallet_transfer'); names.add('wallet_purchase'); }
  if (names.size === 2) names.add('web_search'); // default research capability
  return [...names].map((n) => TOOLS[n]);
}

async function runParallel(calls, ctx) {
  return Promise.all(calls.map((c) => TOOLS[c.tool].run(c.args || {}, ctx)));
}

module.exports = { TOOLS, pickTools, runParallel };
