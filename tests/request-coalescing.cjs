const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
const start = app.indexOf('let composioRefreshPending = null;');
const end = app.indexOf('async function connectComposioApp', start);
assert.ok(start >= 0 && end > start);

(async () => {
  let appCalls = 0;
  let optionCalls = 0;
  let customCalls = 0;
  const state = { view: 'apps', composioApps: [], composioLoading: false, triggerOptions: {} };
  const context = vm.createContext({
    Date, Promise, state,
    billingIdentity: () => 'user-a',
    $: () => ({}),
    save: () => {},
    toast: () => {},
    refreshCustomConnectors: () => { customCalls++; return Promise.resolve(); },
    paintApps: () => {
      if (!state.composioApps.length && !state.composioLoading) context.refreshComposioApps();
    },
    window: { LingonAuth: { api: async (url) => {
      if (url === '/api/composio/apps') { appCalls++; return { apps: [] }; }
      if (url === '/api/trigger-options') { optionCalls++; return {}; }
      throw new Error('Unexpected URL: ' + url);
    } } },
  });
  vm.runInContext(app.slice(start, end) + '\nthis.refreshComposioApps = refreshComposioApps;', context);
  await context.refreshComposioApps();
  context.paintApps();
  await Promise.resolve();
  assert.equal(appCalls, 1, 'empty Apps page must not refetch on every paint');
  assert.equal(optionCalls, 0, 'ordinary Apps load must not refetch trigger options');
  assert.equal(customCalls, 1, "the owner's own connectors load with the apps, not on every paint");
  await context.refreshComposioApps(true);
  assert.equal(appCalls, 2, 'manual Refresh must still fetch');
  assert.equal(optionCalls, 1, 'manual Refresh updates app triggers');
  assert.equal(customCalls, 2, "manual Refresh reloads the owner's own connectors too");

  const syncStart = app.indexOf('let backendSyncPending = null;');
  const syncEnd = app.indexOf('let subAgentsPending = null;', syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  let syncOwner = 'user-a';
  let now = 100000;
  let syncCalls = 0;
  let mailboxCalls = 0;
  const syncState = { memory: [], vault: { secrets: [] }, chats: [], triggerOptions: {} };
  const syncContext = vm.createContext({
    Date: { now: () => now }, Promise,
    state: syncState,
    billingIdentity: () => syncOwner,
    ensureMailbox: async () => { mailboxCalls++; },
    save: () => {},
    window: { LingonAuth: { api: async () => { syncCalls++; return {}; } } },
  });
  vm.runInContext(app.slice(syncStart, syncEnd) + '\nthis.syncFromBackend = syncFromBackend;', syncContext);
  const synced = await Promise.all([syncContext.syncFromBackend(), syncContext.syncFromBackend()]);
  assert.equal(syncCalls, 4, 'simultaneous account syncs must share four GETs');
  assert.equal(mailboxCalls, 1);
  assert.deepEqual(synced, [true, true]);
  assert.equal(await syncContext.syncFromBackend(), false, 'recent account sync should reuse cached state');
  assert.equal(syncCalls, 4);
  await syncContext.syncFromBackend(true);
  assert.equal(syncCalls, 8, 'forced sync should fetch fresh data');
  syncOwner = 'user-b';
  await syncContext.syncFromBackend();
  assert.equal(syncCalls, 12, 'a different account must not reuse sync state');

  const agentsEnd = app.indexOf('/* ---------------- Belna Apps', syncEnd);
  assert.ok(agentsEnd > syncEnd);
  let agentsOwner = 'user-a';
  let agentsCalls = 0;
  const agentsState = { subAgentComposer: false, canvasOpen: false, subAgents: [], triggerOptions: {} };
  const agentsContext = vm.createContext({
    Date: { now: () => now }, Promise,
    state: agentsState,
    billingIdentity: () => agentsOwner,
    save: () => {}, toast: () => {},
    window: { LingonAuth: { api: async (url) => {
      agentsCalls++;
      return url === '/api/sub-agents' ? { subAgents: [] } : { schedules: [], apps: [] };
    } } },
  });
  vm.runInContext(app.slice(syncEnd, agentsEnd) + '\nthis.refreshSubAgents = refreshSubAgents;', agentsContext);
  await Promise.all([agentsContext.refreshSubAgents(), agentsContext.refreshSubAgents()]);
  assert.equal(agentsCalls, 2, 'automation panel reads must share one pair of requests');
  await agentsContext.refreshSubAgents();
  assert.equal(agentsCalls, 2, 'a recent panel load should use its cache');
  now += 30001;
  await agentsContext.refreshSubAgents();
  assert.equal(agentsCalls, 4, 'automation panel should refresh after the cache expires');
  agentsOwner = 'user-b';
  await agentsContext.refreshSubAgents();
  assert.equal(agentsCalls, 6, 'another account must get its own automation data');

  const authSource = fs.readFileSync(path.join(__dirname, '../app/auth.js'), 'utf8');
  const storage = new Map();
  let refreshCalls = 0;
  let apiCalls = 0;
  const authContext = vm.createContext({
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    window: { LingonConfig: { apiBase: '' } },
    fetch: async (url, opts) => {
      if (url === '/api/auth/refresh') {
        refreshCalls++;
        return { ok: true, status: 200, json: async () => ({ access_token: 'token-b', refresh_token: 'refresh-b', user: { id: 'user-a' } }) };
      }
      apiCalls++;
      const valid = opts.headers.Authorization === 'Bearer token-b';
      return { ok: valid, status: valid ? 200 : 401, json: async () => valid ? { ok: true } : { error: 'Expired' } };
    },
  });
  vm.runInContext(authSource, authContext);
  const auth = authContext.window.LingonAuth;
  auth.set({ access_token: 'token-a', refresh_token: 'refresh-a', user: { id: 'user-a' } });
  const results = await Promise.all([
    auth.api('/api/one'), auth.api('/api/two'), auth.apiStream('/api/chat/stream'),
  ]);
  assert.equal(refreshCalls, 1, 'parallel 401s must share one token refresh');
  assert.equal(apiCalls, 6, 'each request should retry once with the new token');
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, true);
  assert.equal(results[2].status, 200);
  console.log('request coalescing: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
