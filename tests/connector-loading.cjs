const assert = require('node:assert/strict');
process.env.COMPOSIO_API_KEY = 'test-key';
const slugs = Array.from({ length: 14 }, (_, i) => 'app' + i);
let active = 0, peak = 0, metadataCalls = 0;
global.fetch = async url => {
  const path = new URL(url).pathname;
  if (path.endsWith('/auth_configs')) return Response.json({ items: slugs.map((slug, i) => ({ id: 'ac_' + i, status: 'ENABLED', toolkit: { slug }, auth_scheme: 'OAUTH2' })) });
  if (path.endsWith('/connected_accounts')) return Response.json({ items: [
    { id: 'mine', user_id: 'belna:owner', toolkit: { slug: 'app0' }, status: 'ACTIVE' },
    { id: 'other', user_id: 'belna:other', toolkit: { slug: 'app1' }, status: 'ACTIVE' },
  ] });
  assert.match(path, /\/toolkits\/app\d+$/);
  metadataCalls++; active++; peak = Math.max(peak, active);
  await new Promise(resolve => setTimeout(resolve, 15));
  active--;
  return Response.json({ name: path.split('/').at(-1) });
};
(async () => {
  const { appsForUser } = require('../server/composio');
  const apps = await appsForUser('owner');
  assert.equal(peak, 6, 'cold connector metadata loads concurrently with a bounded batch');
  assert.deepEqual(apps.map(app => app.toolkit), [...slugs].sort(), 'parallel completion preserves catalogue order');
  assert.equal(apps[0].connected, true);
  assert.equal(apps[1].connected, false, 'parallel metadata does not mix owner connections');
  await appsForUser('owner');
  assert.equal(metadataCalls, slugs.length, 'subsequent lists reuse public metadata');
  console.log('Connector loading: bounded parallel metadata, stable order, caching and owner isolation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
