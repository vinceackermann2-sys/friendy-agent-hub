// The owner's own connectors: remote MCP servers (Streamable HTTP and the older
// HTTP+SSE transport) and REST APIs, with vault-held credentials and permissions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');

for (const key of ['SUPABASE_URL', 'LINGON_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'COMPOSIO_API_KEY']) delete process.env[key];
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// Public names resolve to a public address; private.example.com to a private one.
dns.promises.lookup = async (host) => [{ address: /^private\./.test(host) ? '10.0.0.5' : '93.184.216.34', family: 4 }];

const TOKEN = 'mcp-token-123456';
const API_KEY = 'key-abcdef-7890';
let apiKeyExpected = API_KEY;
const calls = [];
const sessions = new Set();
const legacy = { stream: null, sessionId: 'legacy-1' };
const TOOLS = [
  { name: 'search_docs', description: 'Search the docs.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words to find.' } }, required: ['query'] } },
  { name: 'create_ticket', description: 'Open a ticket.', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  { name: 'whoami', description: 'Echo the caller.', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {} } },
  { name: 'bad name!', description: 'Not a valid tool name.' },
];
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
const sse = (messages, headers = {}) => new Response(messages.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } });
function rpcResult(msg, auth) {
  if (msg.method === 'initialize') return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Docs MCP', version: '2.1' } };
  if (msg.method === 'tools/list') return msg.params?.cursor ? { tools: TOOLS.slice(2) } : { tools: TOOLS.slice(0, 2), nextCursor: 'page2' };
  if (msg.method === 'tools/call') {
    if (msg.params.name === 'whoami') return { content: [{ type: 'text', text: `You sent ${auth}` }] };
    if (msg.params.name === 'create_ticket' && !msg.params.arguments.title) return { isError: true, content: [{ type: 'text', text: 'title is required' }] };
    return { content: [{ type: 'text', text: `${msg.params.name}: ${JSON.stringify(msg.params.arguments)}` }], structuredContent: { ok: true } };
  }
  return null;
}

global.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  calls.push({ url: url.href, method, headers, body: init.body });
  // Some public APIs (including GitHub) reject unidentified server requests.
  if (url.host === 'identified.example.com') return headers['user-agent']
    ? json({ repository: 'nodejs/node' }) : new Response('User-Agent required', { status: 403 });
  // Streamable HTTP MCP server; answers tools/call as an SSE stream.
  if (url.host === 'mcp.example.com') {
    if (headers.authorization !== `Bearer ${TOKEN}`) return new Response('no', { status: 401 });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    const msg = JSON.parse(init.body);
    if (msg.method === 'initialize') { const id = `s${sessions.size + 1}`; sessions.add(id); return json({ jsonrpc: '2.0', id: msg.id, result: rpcResult(msg) }, { headers: { 'mcp-session-id': id } }); }
    if (!sessions.has(headers['mcp-session-id'])) return new Response('unknown session', { status: 404 });
    assert.equal(headers['mcp-protocol-version'], '2025-06-18');
    if (!('id' in msg)) return new Response(null, { status: 202 });
    const result = rpcResult(msg, headers.authorization);
    if (msg.method === 'tools/call') return sse([{ jsonrpc: '2.0', method: 'notifications/progress', params: {} }, { jsonrpc: '2.0', id: msg.id, result }]);
    return json({ jsonrpc: '2.0', id: msg.id, result });
  }
  // Older HTTP+SSE MCP server with the key in the query string.
  if (url.host === 'legacy.example.com') {
    if (url.searchParams.get('key') !== TOKEN) return new Response('no', { status: 403 });
    if (url.pathname === '/sse' && method === 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (url.pathname === '/sse' && method === 'GET') {
      let controller;
      const stream = new ReadableStream({ start(c) { controller = c; } });
      legacy.stream = { push: (text) => controller.enqueue(new TextEncoder().encode(text)) };
      legacy.stream.push(`event: endpoint\ndata: /messages?sessionId=${legacy.sessionId}\n\n`);
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.pathname === '/messages' && method === 'POST') {
      assert.equal(url.searchParams.get('sessionId'), legacy.sessionId);
      const msg = JSON.parse(init.body);
      if ('id' in msg) setTimeout(() => legacy.stream.push(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: rpcResult(msg, 'query key') })}\n\n`), 5);
      return new Response('Accepted', { status: 202 });
    }
  }
  // A REST API with an X-API-Key header.
  if (url.host === 'api.example.com') {
    if (headers['x-api-key'] !== apiKeyExpected) return json({ error: 'bad key' }, { status: 401 });
    if (url.pathname === '/v1/me') return json({ id: 'u1', name: 'Owner', echo: API_KEY });
    if (url.pathname === '/v1/moved') return new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/v1/file' } });
    if (url.pathname === '/v1/inside') return new Response(null, { status: 302, headers: { location: 'https://private.example.com/admin' } });
    return json({ path: url.pathname, query: Object.fromEntries(url.searchParams), method, body: init.body ? JSON.parse(init.body) : null });
  }
  // An MCP server that signs in only through the browser (OAuth).
  if (url.host === 'oauth.example.com') return new Response('unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://oauth.example.com/.well-known/oauth-protected-resource"' } });
  // Debug endpoints that echo the request back: its Authorization header and its URL.
  if (url.host === 'echo.example.com') return json({ authorization: headers.authorization || null, url: url.href });
  if (url.host === 'cdn.example.com') return new Response(`cdn saw key=${headers['x-api-key'] || 'none'}`, { status: 200, headers: { 'content-type': 'text/plain' } });
  return new Response('not found', { status: 404 });
};

const dataFile = path.join(__dirname, '../server/data.json');
let prev = null;
try { prev = fs.readFileSync(dataFile, 'utf8'); } catch {}

async function main() {
  const store = require('../server/store');
  const connectors = require('../server/connectors');
  // In the app a connector request connects only to the address it checked (pinnedFetch); here the stub above answers.
  connectors.useTransport((...args) => global.fetch(...args));
  // That transport connects to the address it checked: a name answering with a private address
  // at connect time (DNS rebinding after a public answer) is refused.
  const { pinnedFetch } = require('../server/agents/sandbox');
  const realLookup = dns.lookup;
  dns.lookup = (host, options, callback) => callback(null, [{ address: '10.0.0.5', family: 4 }]);
  await assert.rejects(pinnedFetch('https://rebind.example.com/'), (e) => e.code === 'HOST_BLOCKED');
  dns.lookup = realLookup;
  const { permissionDecision } = require('../server/agents/permission-policy');
  const { TOOLS: AGENT_TOOLS, pickTools } = require('../server/agents/tools');
  const { approvalCard } = require('../server/agents/cards');
  const ctx = { userId: 'user-a', trace: () => {} };

  const identified = await connectors.create('user-a', { kind: 'api', name: 'Identified API', url: 'https://identified.example.com', auth: { type: 'none' }, testPath: '/repo' });
  assert.equal((await AGENT_TOOLS.connector_call.run({ connector: identified.connector.id, method: 'GET', path: '/repo' }, ctx)).data.repository, 'nodejs/node');
  await connectors.remove('user-a', identified.connector.id);

  // Input checks: https, public, and a key unless there is no authentication.
  assert.throws(() => connectors.cleanInput({ kind: 'mcp', name: 'x', url: 'http://mcp.example.com/mcp', auth: { type: 'none' } }), /must start with https/);
  assert.throws(() => connectors.cleanInput({ kind: 'mcp', name: 'x', url: 'https://localhost/mcp', auth: { type: 'none' } }), /not a public internet address/);
  assert.throws(() => connectors.cleanInput({ kind: 'api', name: 'x', url: 'https://10.1.2.3/v1', auth: { type: 'none' } }), /not a public internet address/);
  assert.throws(() => connectors.cleanInput({ kind: 'api', name: 'x', url: 'https://api.example.com', auth: { type: 'bearer' } }), /Paste the API key/);
  assert.throws(() => connectors.cleanInput({ kind: 'api', name: 'x', url: 'https://api.example.com', auth: { type: 'header', header: 'Cookie' }, secret: 's' }), /header name/);
  assert.throws(() => connectors.cleanInput({ kind: 'ftp', name: 'x', url: 'https://api.example.com' }), /API or MCP/);

  // A wrong token saves nothing.
  await assert.rejects(() => connectors.create('user-a', { kind: 'mcp', name: 'Docs', url: 'https://mcp.example.com/mcp', auth: { type: 'bearer' }, secret: 'wrong' }), (e) => e.code === 'AUTH_FAILED' && /refused access \(HTTP 401\)\. Check the key/.test(e.message));
  assert.equal((await store.listSecrets('user-a')).length, 0);
  assert.equal((await store.listCustomConnectors('user-a')).length, 0);
  // A server that allows only browser sign-in says so.
  await assert.rejects(() => connectors.create('user-a', { kind: 'mcp', name: 'Notes', url: 'https://oauth.example.com/mcp', auth: { type: 'bearer' }, secret: 'token-x' }), /signing in through the browser \(OAuth\)/);
  // A private address is refused before any request.
  await assert.rejects(() => connectors.create('user-a', { kind: 'mcp', name: 'Inside', url: 'https://private.example.com/mcp', auth: { type: 'none' } }), /private address/);

  // Streamable HTTP MCP: tools are discovered over two pages and classified.
  const made = await connectors.create('user-a', { kind: 'mcp', name: 'Docs', url: 'https://mcp.example.com/mcp', auth: { type: 'bearer' }, secret: TOKEN, description: 'Company docs and tickets' });
  const docs = made.connector;
  assert.equal(docs.slug, 'docs');
  assert.equal(docs.status, 'connected');
  assert.equal(docs.transport, 'http');
  assert.equal(docs.server.name, 'Docs MCP');
  assert.deepEqual(docs.permissions.map((p) => [p.slug, p.kind, p.enabled]), [['search_docs', 'read', true], ['create_ticket', 'write', true], ['whoami', 'read', true]]);
  assert.equal(JSON.stringify(made).includes(TOKEN), false, 'the token never comes back from the API');
  const vault = await store.listSecrets('user-a');
  assert.deepEqual(vault.map((s) => s.name), ['Docs MCP token']);
  assert.equal(docs.secretId, vault[0].id);
  assert.equal(await store.revealSecret('user-a', docs.secretId), TOKEN);
  // Another owner sees none of it.
  assert.deepEqual(await connectors.list('user-b'), []);
  await assert.rejects(() => connectors.call('user-b', { connector: 'docs', tool: 'whoami' }), /No connector named docs/);

  // The agent finds it through composio_apps and sees no credentials.
  const apps = await AGENT_TOOLS.composio_apps.run({}, ctx);
  assert.deepEqual(apps.custom, [{ connector: 'docs', name: 'Docs', kind: 'MCP server', host: 'mcp.example.com', about: 'Company docs and tickets' }]);
  assert.match(apps.note, /connector_tools/);
  const described = await AGENT_TOOLS.connector_tools.run({ connector: 'docs', query: 'ticket' }, ctx);
  assert.equal(described.tools[0].name, 'create_ticket', 'the query ranks matching tools first');
  assert.match(described.tools[0].arguments.title, /string \(required\)/);
  assert.ok(pickTools('use my docs mcp').some((t) => t.name === 'connector_call'));

  // Reads run when asked; writes and unknown tools ask; "always ask" asks for all.
  assert.equal((await permissionDecision('user-a', 'connector_call', { connector: 'docs', tool: 'search_docs' }, AGENT_TOOLS.connector_call)).required, false);
  assert.equal((await permissionDecision('user-a', 'connector_call', { connector: 'docs', tool: 'create_ticket' }, AGENT_TOOLS.connector_call)).required, true);
  assert.equal((await permissionDecision('user-a', 'connector_call', { connector: 'docs', tool: 'nope' }, AGENT_TOOLS.connector_call)).required, true);
  await store.setAgentPermissions('user-a', { connectors: 'always_ask' });
  assert.equal((await permissionDecision('user-a', 'connector_call', { connector: 'docs', tool: 'search_docs' }, AGENT_TOOLS.connector_call)).required, true);
  await store.setAgentPermissions('user-a', { connectors: 'ask_some' });

  // The approval card names the connector and the exact arguments.
  const detail = await AGENT_TOOLS.connector_call.approvalDetail({ connector: 'docs', tool: 'create_ticket', arguments: { title: 'Printer broken' } }, { userId: 'user-a' });
  const card = approvalCard('connector_call', { connector: 'docs', tool: 'create_ticket', arguments: { title: 'Printer broken' } }, detail, AGENT_TOOLS.connector_call);
  assert.equal(card.title, 'Create ticket in Docs');
  assert.deepEqual(card.view.fields, [{ k: 'Title', v: 'Printer broken' }]);

  // Calls: SSE answers are read, the credential is added and scrubbed from results.
  const found = await AGENT_TOOLS.connector_call.run({ connector: 'docs', tool: 'search_docs', arguments: { query: 'vpn' } }, ctx);
  assert.equal(found.text, 'search_docs: {"query":"vpn"}');
  assert.deepEqual(found.data, { ok: true });
  const who = await AGENT_TOOLS.connector_call.run({ connector: 'Docs', tool: 'whoami' }, ctx);
  assert.equal(who.text, 'You sent Bearer [protected]');
  await assert.rejects(() => AGENT_TOOLS.connector_call.run({ connector: 'docs', tool: 'create_ticket', arguments: {} }, ctx), /title is required/);

  // A tool turned off is refused, and permissions survive a re-check.
  await connectors.setPermissions('user-a', docs.id, ['create_ticket', 'not-a-tool']);
  assert.deepEqual((await store.listCustomConnectors('user-a'))[0].disabled, ['create_ticket']);
  await assert.rejects(() => connectors.call('user-a', { connector: 'docs', tool: 'create_ticket', arguments: { title: 'x' } }), (e) => e.code === 'PERMISSION_OFF');
  assert.equal((await AGENT_TOOLS.connector_tools.run({ connector: 'docs' }, ctx)).tools.some((t) => t.name === 'create_ticket'), false);
  const rechecked = await connectors.refresh('user-a', docs.id);
  assert.equal(rechecked.status, 'connected');
  assert.equal(rechecked.permissions.find((p) => p.slug === 'create_ticket').enabled, false);

  // A new token replaces the old one in the vault; a wrong one changes nothing.
  await assert.rejects(() => connectors.replaceSecret('user-a', docs.id, 'wrong-again'), /refused/);
  const oldSecret = docs.secretId;
  const replaced = await connectors.replaceSecret('user-a', docs.id, TOKEN);
  assert.notEqual(replaced.connector.secretId, oldSecret);
  assert.deepEqual((await store.listSecrets('user-a')).map((s) => s.id), [replaced.connector.secretId]);

  // The older HTTP+SSE transport, with the key in the query string.
  const old = (await connectors.create('user-a', { kind: 'mcp', name: 'Old Docs', url: 'https://legacy.example.com/sse', auth: { type: 'query', param: 'key' }, secret: TOKEN })).connector;
  assert.equal(old.transport, 'sse');
  assert.equal(old.permissions.length, 3);
  const legacyOut = await connectors.call('user-a', { connector: 'old-docs', tool: 'whoami' });
  assert.equal(legacyOut.result.text, 'You sent query key');

  // A REST API: requests stay under the base path and carry the key only there.
  const api = (await connectors.create('user-a', { kind: 'api', name: 'Acme API', url: 'https://api.example.com/v1', auth: { type: 'header', header: 'X-API-Key' }, secret: API_KEY, testPath: '/me', docsUrl: 'https://docs.example.com/api' })).connector;
  assert.equal(api.status, 'connected');
  assert.ok(api.checkedAt);
  assert.deepEqual(api.permissions.map((p) => [p.slug, p.kind]), [['GET', 'read'], ['POST', 'write'], ['PUT', 'write'], ['PATCH', 'write'], ['DELETE', 'write']]);
  assert.equal(connectors.apiUrl('https://api.example.com/v1', '/v1/items', { page: 2 }), 'https://api.example.com/v1/items?page=2');
  assert.equal(connectors.apiUrl('https://api.example.com/v1?version=3', 'items'), 'https://api.example.com/v1/items?version=3');
  assert.throws(() => connectors.apiUrl('https://api.example.com/v1', '../admin'), /only reaches/);
  assert.throws(() => connectors.apiUrl('https://api.example.com/v1', 'https://evil.example.com/v1/x'), /only reaches/);
  const me = await AGENT_TOOLS.connector_call.run({ connector: 'acme-api', method: 'GET', path: '/me' }, ctx);
  assert.deepEqual(me, { status: 200, ok: true, data: { id: 'u1', name: 'Owner', echo: '[protected]' } });
  const posted = await connectors.call('user-a', { connector: 'acme-api', method: 'POST', path: 'items', query: { draft: true }, body: { name: 'Box' } });
  assert.deepEqual(posted.result.data, { path: '/v1/items', query: { draft: 'true' }, method: 'POST', body: { name: 'Box' } });
  await assert.rejects(() => connectors.call('user-a', { connector: 'acme-api', method: 'GET', path: '/me', headers: { Authorization: 'x' } }), /cannot be set/);
  assert.equal((await permissionDecision('user-a', 'connector_call', { connector: 'acme-api', method: 'GET' }, AGENT_TOOLS.connector_call)).required, false);
  assert.equal((await permissionDecision('user-a', 'connector_call', { connector: 'acme-api', method: 'DELETE' }, AGENT_TOOLS.connector_call)).required, true);
  const apiCard = approvalCard('connector_call', { connector: 'acme-api', method: 'POST', path: '/items', body: { name: 'Box' } }, await connectors.approvalDetail('user-a', { connector: 'acme-api', method: 'POST', path: '/items', body: { name: 'Box' } }), AGENT_TOOLS.connector_call);
  assert.equal(apiCard.title, 'Send to API in Acme API');
  assert.deepEqual(apiCard.view.fields, [{ k: 'Request', v: 'POST /v1/items' }, { k: 'Body', v: '{"name":"Box"}' }]);
  // A redirect to another site loses the key; one into a private network is refused.
  const moved = await connectors.call('user-a', { connector: 'acme-api', path: '/moved' });
  assert.equal(moved.result.text, 'cdn saw key=none');
  await assert.rejects(() => connectors.call('user-a', { connector: 'acme-api', path: '/inside' }), /private address/);
  // A server that echoes the request back shows no form of the credential: not the Basic
  // auth pair, and not a query key as the URL encodes it.
  const basicSecret = 'pa ss~word!(1)';
  const echoBasic = await connectors.create('user-a', { kind: 'api', name: 'Echo Basic', url: 'https://echo.example.com/basic', auth: { type: 'basic', username: 'me' }, secret: basicSecret });
  const basicEcho = JSON.stringify((await connectors.call('user-a', { connector: 'echo-basic', path: '/who' })).result);
  assert.ok(basicEcho.includes('Basic [protected]'), basicEcho);
  assert.ok(!basicEcho.includes(Buffer.from('me:' + basicSecret).toString('base64')));
  const echoQuery = await connectors.create('user-a', { kind: 'api', name: 'Echo Query', url: 'https://echo.example.com/query', auth: { type: 'query', param: 'key' }, secret: basicSecret });
  const queryEcho = JSON.stringify((await connectors.call('user-a', { connector: 'echo-query', path: '/who' })).result);
  assert.ok(!queryEcho.includes(new URLSearchParams({ k: basicSecret }).toString().slice(2)), queryEcho);
  assert.ok(!queryEcho.includes(basicSecret));
  for (const added of [echoBasic, echoQuery]) await connectors.remove('user-a', added.connector.id);
  // GET turned off is refused.
  await connectors.setPermissions('user-a', api.id, ['GET']);
  await assert.rejects(() => connectors.call('user-a', { connector: 'acme-api', path: '/me' }), (e) => e.code === 'PERMISSION_OFF');
  await connectors.setPermissions('user-a', api.id, []);

  // A key the service stops accepting marks the connector for the owner, and the agent
  // is told what happened; a later success clears it.
  apiKeyExpected = 'rotated-on-the-service';
  const refused = await connectors.call('user-a', { connector: 'acme-api', path: '/me' });
  assert.equal(refused.result.status, 401);
  assert.match(refused.result.note, /refused the saved credential/);
  let acme = (await connectors.list('user-a')).find((c) => c.slug === 'acme-api');
  assert.equal(acme.status, 'error');
  assert.match(acme.lastError, /refused/);
  assert.equal((await connectors.forAgent('user-a')).find((c) => c.connector === 'acme-api').problem, acme.lastError);
  apiKeyExpected = API_KEY;
  await connectors.call('user-a', { connector: 'acme-api', path: '/me' });
  acme = (await connectors.list('user-a')).find((c) => c.slug === 'acme-api');
  assert.equal(acme.status, 'connected');

  // Deleting the key from the vault removes its connector.
  await store.delSecret('user-a', acme.secretId);
  assert.equal((await connectors.list('user-a')).some((c) => c.slug === 'acme-api'), false);

  // Removing a connector removes its vault key too.
  await connectors.remove('user-a', old.id);
  assert.equal((await store.listSecrets('user-a')).some((s) => s.name === 'Old Docs MCP token'), false);
  assert.deepEqual((await connectors.list('user-a')).map((c) => c.slug), ['docs']);

  // An API with no authentication needs no vault key.
  const open = (await connectors.create('user-a', { kind: 'api', name: 'Open data', url: 'https://api.example.com/v1', auth: { type: 'none' } })).connector;
  assert.equal(open.secretId, null);
  assert.equal(open.checkedAt, null, 'an API without a test path is checked on first use');

  // The agent sets one up from chat: the card shows where the key goes, and the tool then finds
  // the connector the card added. An address already connected needs no card.
  const setup = { kind: 'mcp', name: 'Docs', url: 'https://mcp.example.com/mcp', auth: 'bearer', key_url: 'https://mcp.example.com/settings/tokens', reason: 'To read your docs' };
  assert.equal(await AGENT_TOOLS.connector_setup.needsApproval(setup, { userId: 'user-a' }), false);
  assert.equal(await AGENT_TOOLS.connector_setup.needsApproval({ ...setup, url: 'https://mcp.example.com/other' }, { userId: 'user-a' }), true);
  assert.equal(await AGENT_TOOLS.connector_setup.needsApproval(setup, { userId: 'user-b' }), true, 'another owner gets their own card');
  const setupCard = approvalCard('connector_setup', setup, await AGENT_TOOLS.connector_setup.approvalDetail(setup), AGENT_TOOLS.connector_setup);
  assert.deepEqual(setupCard, { type: 'connector', status: 'pending', kind: 'mcp', name: 'Docs', url: 'https://mcp.example.com/mcp', host: 'mcp.example.com', auth: { type: 'bearer' },
    testPath: '', description: '', docsUrl: '', keyUrl: 'https://mcp.example.com/settings/tokens', note: 'To read your docs', warning: '' });
  // A key made on one site and sent to another is how a key is phished: the card says so.
  const phish = connectors.setupCard({ kind: 'mcp', name: 'GitHub', url: 'https://mcp.github-tools.dev/mcp', auth: 'bearer', key_url: 'https://github.com/settings/tokens' });
  assert.match(phish.warning, /on github\.com, but it is sent to mcp\.github-tools\.dev/);
  assert.equal(connectors.setupCard({ kind: 'api', name: 'Acme', url: 'https://api.acme.co.uk/v1', auth: 'bearer', key_url: 'https://www.acme.co.uk/keys' }).warning, '', 'same site under co.uk');
  assert.equal(connectors.setupCard({ kind: 'mcp', name: 'Open', url: 'https://mcp.open.dev/mcp', auth: 'none', key_url: 'https://other.dev/' }).warning, '', 'no key, nothing to send');
  const setupOut = await AGENT_TOOLS.connector_setup.run(setup, ctx);
  assert.equal(setupOut.connector, 'docs');
  assert.deepEqual(setupOut.tools, ['search_docs', 'whoami'], 'only the tools the owner left on');
  await assert.rejects(() => AGENT_TOOLS.connector_setup.run({ ...setup, url: 'https://mcp.example.com/other' }, ctx), /was not added/);
  await assert.rejects(() => AGENT_TOOLS.connector_setup.approvalDetail({ ...setup, url: 'http://mcp.example.com/mcp' }), /must start with https/);
  await assert.rejects(() => AGENT_TOOLS.connector_setup.approvalDetail({ ...setup, url: 'https://192.168.1.4/mcp' }), /not a public internet address/);
  assert.throws(() => connectors.setupArgs({ ...setup, auth: 'oauth' }), /auth must be/);
  assert.equal(connectors.setupArgs({ ...setup, key_url: 'javascript:alert(1)' }).keyUrl, '', 'only an https key page is linked');
  assert.ok(pickTools('connect our linear mcp server').some((t) => t.name === 'connector_setup'));
  // Adding the same address again replaces its key; nothing shows twice.
  const again = await connectors.create('user-a', { kind: 'mcp', name: 'Docs again', url: 'https://mcp.example.com/mcp', auth: { type: 'bearer' }, secret: TOKEN });
  assert.equal(again.connector.id, docs.id);
  assert.equal((await connectors.list('user-a')).filter((c) => c.url === 'https://mcp.example.com/mcp').length, 1);
  assert.equal((await store.listSecrets('user-a')).filter((s) => s.name === 'Docs MCP token').length, 1);

  // Parsing SSE frames split across chunks.
  const chunks = ['event: endpoint\r\nda', 'ta: /m?x=1\r\n\r\n: comment\n\ndata: {"a":', '1}\n\n'];
  const body = new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk)); c.close(); } });
  const events = [];
  for await (const event of connectors.sseEvents(body)) events.push(event);
  assert.deepEqual(events, [{ event: 'endpoint', data: '/m?x=1' }, { event: 'message', data: '' }, { event: 'message', data: '{"a":1}' }]);

  // Tool names of the older kind stay read or write by their verbs.
  assert.equal(connectors.mcpToolKind({ name: 'listRepos' }), 'read');
  assert.equal(connectors.mcpToolKind({ name: 'deleteRepo' }), 'write');
  assert.equal(connectors.mcpToolKind({ name: 'frobnicate' }), 'write');
  assert.equal(connectors.mcpToolKind({ name: 'create_x', annotations: { readOnlyHint: true } }), 'read');

  console.log('custom connectors: ok');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (prev != null) fs.writeFileSync(dataFile, prev);
  else try { fs.unlinkSync(dataFile); } catch {}
});
