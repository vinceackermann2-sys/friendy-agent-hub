// Opt-in production verification. Uses disposable accounts and public services only.
// The model, connector requests and Apple command broker are real; Apple OS data
// is explicitly a browser bridge fixture. Real EventKit/HealthKit need an iPhone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');

assert.equal(process.env.LIVE_CONNECTOR_TEST, '1', 'Set LIVE_CONNECTOR_TEST=1 for disposable production verification.');
const base = process.env.VERIFY_BASE || 'https://belna.se';
const out = process.env.VERIFY_OUT || 'artifacts/connectors-verification';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const users = [], chats = [], report = { checkedAt: new Date().toISOString(), base, checks: [], samples: [],
  appleData: 'Explicit native bridge fixtures; not physical EventKit, Contacts or HealthKit verification.', cleanup: false };
fs.mkdirSync(out, { recursive: true });
const save = () => fs.writeFileSync(out + '/production.json', JSON.stringify(report, null, 2));
async function api(session, path, method = 'GET', body, status = 200) {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json',
    ...(session ? { authorization: 'Bearer ' + session.access_token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const value = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${response.status} ${value.error || ''}`);
  return value;
}
async function account() {
  const email = 'connectors-qa-' + crypto.randomUUID() + '@example.invalid', password = crypto.randomUUID() + 'aA1!';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const entry = { id: created.data.user.id }; users.push(entry);
  entry.session = await api(null, '/api/auth/signin', 'POST', { email, password });
  return entry.session;
}
async function check(name, run) {
  if (process.env.VERIFY_FILTER && !name.includes(process.env.VERIFY_FILTER)) return;
  try { await run(); report.checks.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (error) { report.checks.push({ name, pass: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
  save();
}
async function converse(session, prompt, { approveHealth = false } = {}) {
  const chatId = 'connectors_qa_' + crypto.randomUUID(); chats.push({ session, chatId });
  const response = await fetch(base + '/api/agent/conversation', { method: 'POST', headers: {
    'content-type': 'application/json', authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({
    chatId, requestId: crypto.randomUUID(), prompt, context: { timeZone: 'Europe/Stockholm' } }), signal: AbortSignal.timeout(120000) });
  assert.equal(response.status, 200);
  const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.deepEqual(events.filter(e => e.type === 'error'), []);
  const all = [...events], traces = [];
  const taskIds = [...new Set(events.filter(e => e.type === 'task').map(e => e.task?.id || e.id).filter(Boolean))];
  for (const taskId of taskIds) {
    let task;
    const deadline = Date.now() + 180000;
    do {
      task = (await api(session, '/api/agent/tasks/advance', 'POST', { chatId, taskId, after: task?.sequence || 0 })).task;
      all.push(...task.events || []);
      if (task.status === 'waiting_approval' && approveHealth) {
        const card = all.filter(e => e.type === 'card' && e.card?.tool === 'apple_execute').at(-1)?.card;
        assert.ok(card && card.detail.includes('health.summary'), 'only the disposable Health fixture can be approved');
        await api(session, '/api/agent/tasks/control', 'POST', { chatId, taskId, action: 'decide',
          version: task.version, callId: card.managedCallId || card.key, allow: true });
        continue;
      }
      if (!['queued', 'running', 'waiting_peers', 'stopping'].includes(task.status)) break;
    } while (Date.now() < deadline);
    const trace = (await api(session, '/api/agent/tasks/trace?chatId=' + chatId + '&taskId=' + taskId)).task;
    traces.push(trace);
    // Save failed samples too, so a claimed pass can be audited against tool evidence.
    report.samples.push({ prompt, status: task.status, trace }); save();
    assert.equal(task.status, 'completed', 'agent stopped at ' + task.status);
  }
  const text = all.filter(e => e.type === 'message' && ['final_answer', 'task_answer'].includes(e.phase)).map(e => e.text).join('\n');
  const cards = all.filter(e => e.type === 'card').map(e => e.card);
  report.samples.push({ prompt, text, cards }); save();
  return { text, cards, steps: traces.flatMap(t => t.steps || []) };
}
async function nativeFixture(browser, session) {
  const nonce = crypto.randomBytes(6).toString('hex');
  const fixtures = {
    'calendar.list': { events: [{ id: 'qa-event', title: 'Calendar-' + nonce, start: '2026-10-06T12:00:00Z', end: '2026-10-06T12:30:00Z' }], hasMore: false },
    'reminders.list': { reminders: [{ id: 'qa-reminder', title: 'Reminder-' + nonce, completed: false }], hasMore: false },
    'contacts.search': { contacts: [{ id: 'qa-contact', givenName: 'Contact-' + nonce, familyName: 'QA', emails: [], phones: [] }], hasMore: false },
    'health.summary': { purpose: 'wellness', start: '2026-10-06T00:00:00Z', end: '2026-10-06T12:00:00Z', steps: 7319,
      distanceMeters: null, exerciseMinutes: null, sleepHours: null, note: 'Explicit QA wellness fixture shared by the bridge.' },
  };
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  await context.addInitScript(({ session, fixtures }) => {
    window.__appleExecutions = [];
    window.BelnaNative = { platform: 'ios', request: async body => {
      if (body.method === 'status') return { name: 'QA iPhone bridge fixture', capabilities: { calendar: true, reminders: true, contacts: true, health: true } };
      if (body.method === 'execute') {
        if (!(await window.BelnaApple.commandActive(body.commandId))) throw new Error('Command is not active');
        if (!fixtures[body.action]) throw new Error('QA fixture only permits reads');
        window.__appleExecutions.push({ id: body.commandId, action: body.action });
        return fixtures[body.action];
      }
      return {};
    } };
    localStorage.setItem('lingon.session', JSON.stringify(session));
    localStorage.setItem('lingon.v1', JSON.stringify({ ownerId: session.user.id, onboarded: true, agent: { name: 'QA', color: 'lingon', pers: 'Precise' },
      view: 'chat', activeChat: 'qa-phone', chats: [{ id: 'qa-phone', title: 'QA', messages: [], trace: [] }], vault: { secrets: [], apps: [], approvals: [], mode: 'default' } }));
  }, { session, fixtures });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/app'); await page.locator('#cprompt').waitFor();
  await page.waitForFunction(() => window.BelnaApple?.connectionStatus()?.capabilities.calendar === true);
  return { context, page, errors, nonce };
}
(async () => {
  let browser, owner, foreign, phone;
  try {
    owner = await account(); foreign = await account();
    await check('authenticated live OAuth catalog and hosted Gmail sign-in link', async () => {
      const apps = (await api(owner, '/api/composio/apps')).apps;
      assert.ok(apps.some(a => a.toolkit === 'gmail'), 'Gmail is offered');
      const link = await api(owner, '/api/composio/connect', 'POST', { toolkit: 'gmail' });
      assert.equal(new URL(link.redirectUrl).protocol, 'https:');
      report.oauth = { catalogCount: apps.length, signInHost: new URL(link.redirectUrl).hostname,
        completed: false, reason: 'Hosted link created; a real account owner must complete provider consent.' };
    });
    await check('live REST/MCP setup, discovery and account isolation', async () => {
      const rest = (await api(owner, '/api/connectors', 'POST', { kind: 'api', name: 'QA GitHub API', url: 'https://api.github.com',
        auth: { type: 'none' }, testPath: '/repos/nodejs/node', description: 'Public repository metadata. GET only for QA.' })).connector;
      await api(owner, '/api/connectors/' + rest.id + '/permissions', 'PUT', { disabled: ['POST', 'PUT', 'PATCH', 'DELETE'] });
      const mcp = (await api(owner, '/api/connectors', 'POST', { kind: 'mcp', name: 'QA DeepWiki', url: 'https://mcp.deepwiki.com/mcp', auth: { type: 'none' } })).connector;
      assert.ok(mcp.permissions.some(p => p.slug === 'read_wiki_structure'));
      assert.equal((await api(owner, '/api/connectors')).connectors.length, 2);
      assert.deepEqual((await api(foreign, '/api/connectors')).connectors, []);
      await api(foreign, '/api/connectors/' + rest.id + '/check', 'POST', {}, 400);
      const repository = await (await fetch('https://api.github.com/repos/nodejs/node', { headers: { 'User-Agent': 'Belna-QA/1.0' } })).json();
      report.repository = { fullName: repository.full_name, spdxId: repository.license.spdx_id };
    });
    await check('real agent calls the public REST API', async () => {
      const result = await converse(owner, 'Use my QA GitHub API connector to read /repos/nodejs/node with GET. Tell me its full_name and license spdx_id from the API response. Read only; do not use web search.');
      assert.ok(result.steps.some(s => s.name === 'connector_call'), 'actual connector tool was called');
      assert.match(result.text + JSON.stringify(result.cards), /nodejs\/node/);
      assert.ok((result.text + JSON.stringify(result.cards)).includes(report.repository.spdxId), 'license matches the live API, not a guessed fixture');
    });
    await check('real agent discovers and calls the remote MCP server', async () => {
      const result = await converse(owner, 'Use my QA DeepWiki MCP connector to read the wiki structure for nodejs/node. Return only the first section title. Read only; do not use web search.');
      assert.ok(result.steps.some(s => s.name === 'connector_tools'));
      assert.ok(result.steps.some(s => s.name === 'connector_call'));
      assert.ok(result.text.length > 0);
    });
    browser = await chromium.launch(); phone = await nativeFixture(browser, owner);
    await check('393px mobile connectors with real backend metadata', async () => {
      await phone.page.locator('.mobile-nav-toggle').click();
      await phone.page.locator('[data-act="usermenu"]').click();
      await phone.page.locator('[data-act="nav"][data-view="apps"]').click();
      await phone.page.locator('.apple-connector').first().waitFor();
      await phone.page.waitForFunction(() => document.querySelector('#main')?.textContent.includes('QA DeepWiki'));
      assert.equal(await phone.page.locator('.apple-connector').count(), 4);
      assert.ok(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await phone.page.screenshot({ path: out + '/mobile-connectors.png', fullPage: true });
      assert.deepEqual(phone.errors, []);
      assert.deepEqual((await api(foreign, '/api/apple/devices')).devices, []);
    });
    const cases = [
      ['calendar.list', 'Read Apple Calendar on my connected QA iPhone for October 6, 2026 (00:00 to 23:59 Europe/Stockholm). Return only the first event title.', 'Calendar-' + phone.nonce],
      ['reminders.list', 'Read Apple Reminders on my connected QA iPhone. Return only the first reminder title.', 'Reminder-' + phone.nonce],
      ['contacts.search', 'Search Apple Contacts on my connected QA iPhone for QA. Return only the first given name.', 'Contact-' + phone.nonce],
      ['health.summary', 'Read my Apple Health step count for today from my connected QA iPhone. Use my native Apple Health connection for this wellness request and ask for the required approval. Do not save the result to memory.', '7319'],
    ];
    for (const [action, prompt, marker] of cases) await check('live agent/broker/phone transport: ' + action + ' (OS fixture)', async () => {
      const result = await converse(owner, prompt, { approveHealth: action === 'health.summary' });
      assert.ok(result.steps.some(s => s.name === 'apple_execute'));
      assert.ok(result.steps.some(s => s.name === 'apple_result'));
      const delivered = (result.text + JSON.stringify(result.cards)).replace(/(\d)[, ](?=\d{3}\b)/g, '$1');
      assert.ok(delivered.includes(marker), 'agent returns data only learned from the phone bridge');
      const executed = await phone.page.evaluate(() => window.__appleExecutions);
      assert.ok(executed.some(c => c.action === action));
      assert.equal(new Set(executed.map(c => c.id)).size, executed.length, 'no duplicate native executions');
      const rows = await admin.from('apple_device_commands').select('status,payload,result').eq('user_id', owner.user.id).eq('action', action);
      if (rows.error) throw rows.error;
      assert.ok(rows.data.some(r => r.status === 'consumed' && r.payload === null && r.result === null), 'private result erased after agent retrieval');
    });
  } finally {
    if (browser) await browser.close();
    for (const { session, chatId } of chats) {
      for (const task of (await api(session, '/api/agent/tasks?chatId=' + chatId)).tasks) {
        if (['queued', 'running', 'waiting_approval', 'waiting_peers'].includes(task.status))
          await api(session, '/api/agent/tasks/control', 'POST', { chatId, taskId: task.id, action: 'stop' });
      }
    }
    for (const user of users) {
      // Normal account deletion removes the broker rows, connectors and provider links.
      if (user.session) await api(user.session, '/api/auth/delete-account', 'POST', { confirmation: 'DELETE' });
      else { const deleted = await admin.auth.admin.deleteUser(user.id); if (deleted.error) throw deleted.error; }
      const remaining = await admin.auth.admin.getUserById(user.id);
      assert.ok(remaining.error, 'disposable account removed');
    }
    report.cleanup = true; report.passed = report.checks.length > 0 && report.checks.every(c => c.pass); save();
  }
  if (!report.passed) process.exitCode = 1;
})().catch(error => { report.fatal = error.message; save(); console.error(error.message); process.exitCode = 1; });
