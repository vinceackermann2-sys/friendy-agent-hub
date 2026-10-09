const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// When Supabase is configured but refuses a request, both stores report it instead of
// answering from their local fallback copy: a permission list must not read as "nothing
// disabled", and inbound mail must not be acknowledged without being saved. Inbound mail
// is matched to a mailbox by exact address, never as a LIKE pattern.
(async () => {
  let mode = 'down';
  const queries = [];
  const server = http.createServer((req, res) => {
    queries.push(decodeURIComponent(req.url));
    req.resume();
    req.on('end', () => {
      if (mode === 'down') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'database unavailable', code: 'XX000' })); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  try {
    const node = require('../server/store.js');
    const edge = await import(pathToFileURL(path.join(__dirname, '../src/lingon-server/store.js')).href);
    for (const [name, store] of [['Node', node], ['edge', edge]]) {
      mode = 'down';
      await assert.rejects(store.getConnectorPermissions('owner', 'gmail'), (e) => e != null, `${name}: an unreadable permission list is an error`);
      await assert.rejects(store.setConnectorPermissions('owner', 'gmail', ['GMAIL_SEND_EMAIL']), (e) => e != null, `${name}: an unsaved permission change is an error`);
      await assert.rejects(store.getMailboxByAddress('ada@mail.belna.se'), { code: 'PERSISTENCE' }, `${name}: a mailbox lookup failure is not "no mailbox"`);
      await assert.rejects(store.insertMailMessage('owner', { direction: 'inbound', subject: 'Hello' }), { code: 'PERSISTENCE' }, `${name}: unsaved mail is an error`);
      await assert.rejects(store.upsertMailDraft('owner', { subject: 'Draft' }), { code: 'PERSISTENCE' }, `${name}: an unsaved draft is an error`);
      mode = 'up';
      queries.length = 0;
      assert.equal(await store.getMailboxByAddress('A_ent%@Mail.Belna.se'), null);
      const lookup = queries.find((q) => q.startsWith('/rest/v1/agent_mailboxes'));
      assert.match(lookup, /address=eq\.a_ent%@mail\.belna\.se/, `${name}: exact, lowercase address match`);
      assert.doesNotMatch(lookup, /ilike/, `${name}: no pattern match on a sender-chosen address`);
    }
    console.log('store fail-closed: permissions, mailbox, mail and drafts report storage failures; mailbox match is exact (Node + edge): ok');
  } finally {
    server.close();
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
