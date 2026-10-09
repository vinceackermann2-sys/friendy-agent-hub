// Apple apps the owner connected in the Belna app: what the agent is told about them, the
// approval card the owner reads, and how Connectors shows them outside the Apple app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { appleNote } = require('../server/agents/apple-tools');
const { approvalCard } = require('../server/agents/cards');

const device = (capabilities, online = true) => ({ id: crypto.randomUUID(), name: 'iPhone', platform: 'ios', capabilities, online, last_seen_at: new Date(Date.now() - (online ? 5e3 : 3 * 3600e3)).toISOString() });

// A fixed "connect the needed scope" note made the chat tell owners to connect apps that were connected.
const ready = appleNote([device({ calendar: true, health: true })]);
assert.match(ready, /ready now: Calendar, Health/);
assert.match(ready, /Not connected: Reminders, Contacts/);
assert.doesNotMatch(ready, /closed/);
assert.match(appleNote([device({ health: true }, false)]), /Belna is closed on the device: Health/);
assert.match(appleNote([]), /Not connected: Calendar, Reminders, Contacts, Health.*Connectors, Apple apps/);
// One open device is enough, even when another one with the same app is closed.
assert.match(appleNote([device({ calendar: true }, false), device({ calendar: true })]), /ready now: Calendar\./);

for (const file of ['server/agents/conversation.js', 'src/lingon-server/agents/conversation.js']) {
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /Apple Calendar, Reminders, Contacts and Health are on the owner's iPhone, iPad or Mac \(appleDevices\), never a connect_app card/, `${file} routes connected Apple apps to tasks`);
}
for (const file of ['server/agents/tools.js', 'src/lingon-server/agents/tools.js']) assert.match(fs.readFileSync(file, 'utf8'), /appleNote: appleNote\(apple\)/, `${file} describes the owner's Apple devices`);

// The owner approves in words, never "apple_execute" and raw JSON.
const card = (action, args) => approvalCard('apple_execute', { action, args }, `Apple ${action}: ${JSON.stringify(args)}`, {}, 'k');
const event = card('calendar.create', { title: 'Dentist', start: '2026-10-09T15:00:00+02:00', end: '2026-10-09T16:00:00+02:00' });
assert.equal(event.title, 'Add “Dentist” to Apple Calendar');
assert.equal(event.view.kind, 'apple');
assert.equal(event.view.app, 'apple_calendar');
assert.deepEqual(event.view.fields.map((f) => f.k), ['Starts', 'Ends']);
assert.match(event.view.note, /asks once more/);
const health = card('health.summary', { purpose: 'wellness', days: 3 });
assert.equal(health.title, 'Share a wellness summary from Apple Health');
assert.equal(health.view.fields[0].v, 'The last 3 days');
// "Today" is since local midnight, never older than a week.
const { validateAppleAction } = require('../server/apple-devices');
const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
assert.equal(validateAppleAction('health.summary', { purpose: 'wellness', start: midnight.toISOString() }).scope, 'health');
assert.throws(() => validateAppleAction('health.summary', { purpose: 'wellness', start: new Date(Date.now() - 8 * 864e5).toISOString() }), /last 7 days/);
assert.throws(() => validateAppleAction('health.summary', { purpose: 'wellness', start: 'yesterday' }), /last 7 days/);
assert.equal(card('health.summary', { purpose: 'wellness', start: midnight.toISOString() }).view.fields[0].k, 'Since');
assert.equal(card('reminders.complete', { id: 'r1' }).title, 'Complete a reminder in Apple Reminders');
assert.equal(card('reminders.complete', { id: 'r1', completed: false }).title, 'Reopen a reminder in Apple Reminders');
assert.equal(card('contacts.delete', { id: 'c1' }).title, 'Delete a contact from Apple Contacts');
assert.equal(card('contacts.search', { query: 'Sara' }).title, 'Search Apple Contacts for “Sara”');
assert.equal(card('calendar.list', { start: '2026-10-08T00:00:00Z', end: '2026-10-09T00:00:00Z' }).title, 'Read Apple Calendar');
assert.equal(card('calendar.update', { id: 'e1', title: 'Dentist (moved)' }).title, 'Change “Dentist (moved)” in Apple Calendar');
for (const c of [event, health]) assert.doesNotMatch(c.title, /apple_execute|\{/);

(async () => {
  const { chromium } = require('playwright');
  const appDir = path.resolve('app'), userId = crypto.randomUUID();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const name = ['/', '/app'].includes(pathname) ? 'index.html' : path.basename(pathname);
    const file = pathname.startsWith('/lingon/') ? path.resolve('public', '.' + pathname) : path.join(appDir, name);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.jpg') ? 'image/jpeg' : 'text/html'); res.end(fs.readFileSync(file));
  });
  server.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [393, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 852 } });
      await context.addInitScript(({ userId, card }) => {
        if (localStorage.getItem('lingon.v1')) return;
        localStorage.setItem('lingon.session', JSON.stringify({ access_token: 'web-fixture', user: { id: userId, email: 'web@example.invalid' } }));
        localStorage.setItem('lingon.v1', JSON.stringify({ ownerId: userId, onboarded: true, agent: { name: 'Belna', color: 'lingon', pers: 'Calm' }, view: 'apps', activeChat: 'c1',
          chats: [{ id: 'c1', title: 'Apple approval', messages: [{ id: 'm1', kind: 'card', card: { ...card, managedCallId: 'call_1', taskId: 't1' } }], trace: [] }], vault: { secrets: [], apps: [], approvals: [], mode: 'default' } }));
      }, { userId, card: event });
      const deviceCalls = [];
      await context.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        let value = {};
        if (url.pathname === '/api/apple/devices') { deviceCalls.push(route.request().method()); value = { devices: [device({ calendar: true, reminders: false, contacts: false, health: true }), { ...device({ calendar: true }, false), name: 'Mac', platform: 'mac' }] }; }
        else if (url.pathname === '/api/composio/apps') value = { apps: [{ toolkit: 'gmail', name: 'Gmail', connected: false, authConfigId: 'ac_1' }] };
        else if (url.pathname === '/api/connectors') value = { connectors: [], available: true };
        else if (url.pathname === '/api/client-state') value = { profile: null, chats: [], durable: true };
        else if (url.pathname === '/api/auth/me') value = { user: { id: userId, email: 'web@example.invalid' } };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/app`);
      await page.locator('[data-apple-scope="health"]').waitFor({ timeout: 15000 });
      assert.deepEqual(await page.locator('.apple-connector').evaluateAll((nodes) => nodes.map((n) => n.dataset.appleScope)), ['calendar', 'health'], 'only the Apple apps connected on a device are listed');
      assert.match(await page.locator('[data-apple-scope="calendar"] .conn-meta').innerText(), /Connected on iPhone, Mac/);
      assert.equal(await page.locator('.apple-connector [data-act="apple-apps"]').count(), 0, 'no Connect or Manage button that only works in the Apple app');
      assert.match(await page.locator('.apps-filter [data-f="connected"]').innerText(), /Connected 2/, 'connected count includes the Apple apps');
      await page.locator('[data-apple-scope="calendar"] .conn-head').click();
      const body = await page.locator('[data-apple-scope="calendar"] .conn-body').innerText();
      assert.match(body, /Belna is open there: ready now/);
      assert.match(body, /Last open 3h ago/);
      assert.match(body, /open Belna there and go to Connectors/);
      await page.locator('[data-act="refresh-apps"]').click();
      await page.waitForTimeout(300);
      assert.ok(deviceCalls.length >= 2, 'refresh reloads the device list');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `fits ${width}px`);
      // The approval card in chat: headline, Apple icon and readable times, no tool name.
      if (width <= 760) await page.locator('.mobile-nav-toggle').click();
      await page.getByText('Apple approval', { exact: true }).first().click();
      const approval = page.locator('.cv-approval').first();
      await approval.waitFor();
      const text = await approval.innerText();
      assert.match(text, /Add “Dentist” to Apple Calendar/);
      assert.doesNotMatch(text, /apple_execute|2026-10-09T15/);
      assert.equal(await approval.locator('img[src="/lingon/connectors/apple/calendar.jpg"]').count(), 1);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Apple connections: agent device notes, readable approval cards, and Apple apps on the web Connectors page passed');
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
