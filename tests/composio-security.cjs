const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.COMPOSIO_API_KEY = 'test-project-key';
process.env.COMPOSIO_WEBHOOK_SECRET = 'test-webhook-secret';
delete process.env.SITE_URL;
delete process.env.LINGON_SITE_URL;

const calls = [];
global.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), method: options.method || 'GET' });
  if (String(url).includes('/auth_configs')) {
    return new Response(JSON.stringify({ items: [{
      id: 'ac_enabled', status: 'ENABLED', name: 'Gmail', toolkit: { slug: 'gmail' }, auth_scheme: 'OAUTH2',
    }] }), { status: 200 });
  }
  if (String(url).includes('/connected_accounts/ca_owner')) {
    return new Response(JSON.stringify({ id: 'ca_owner', user_id: 'belna:user-a', status: 'ACTIVE', toolkit: { slug: 'gmail' } }), { status: 200 });
  }
  if (String(url).includes('/connected_accounts/ca_other')) {
    return new Response(JSON.stringify({ id: 'ca_other', user_id: 'belna:user-b', status: 'ACTIVE', toolkit: { slug: 'github' } }), { status: 200 });
  }
  if (String(url).includes('/connected_accounts/ca_github_owner')) {
    return new Response(JSON.stringify({ id: 'ca_github_owner', user_id: 'belna:user-a', status: 'ACTIVE', toolkit: { slug: 'github' } }), { status: 200 });
  }
  if (String(url).includes('/tools/GMAIL_SEND_EMAIL')) {
    return new Response(JSON.stringify({ slug: 'GMAIL_SEND_EMAIL', toolkit: { slug: 'gmail' } }), { status: 200 });
  }
  if (String(url).includes('/tools?')) {
    return new Response(JSON.stringify({ items: [{
      slug: 'GMAIL_SEND_EMAIL', name: 'Send email', toolkit: { slug: 'gmail' },
      input_parameters: { recipient_email: { type: 'string', required: true }, subject: { type: 'string', required: true } },
    }] }), { status: 200 });
  }
  if (String(url).includes('/connected_accounts')) {
    return new Response(JSON.stringify({ items: [
      { id: 'ca_owner', user_id: 'belna:user-a', status: 'ACTIVE', toolkit: { slug: 'gmail' }, data: { email: 'jane@gmail.com', name: 'Jane', picture: 'https://example.com/j.png' } },
      { id: 'ca_work', user_id: 'belna:user-a', status: 'ACTIVE', toolkit: { slug: 'gmail' }, data: { email: 'work@company.com' } },
      { id: 'ca_other', user_id: 'belna:user-b', status: 'ACTIVE', toolkit: { slug: 'github' }, data: { email: 'other@x.com' } },
    ] }), { status: 200 });
  }
  return new Response(JSON.stringify({ redirect_url: 'https://connect.example/link' }), { status: 200 });
};

const composio = require('../server/composio');

async function main() {
  assert.equal(composio.siteOrigin({ headers: { host: 'belna.se', origin: 'https://evil.example' }, protocol: 'https' }), 'https://belna.se');
  assert.equal(composio.siteOrigin({ headers: { host: 'belna.se', origin: 'https://belna.se' }, protocol: 'https' }), 'https://belna.se');

  await assert.rejects(
    () => composio.createLink('user-a', { authConfigId: 'ac_attacker', toolkit: 'gmail', callbackUrl: 'https://belna.se/' }),
    /not enabled/,
  );

  await assert.rejects(() => composio.deleteConnected('user-a', 'ca_other'), /not found on your account/);
  assert.equal(calls.some((call) => call.method === 'DELETE' && call.url.includes('ca_other')), false);
  await composio.deleteConnected('user-a', 'ca_owner');
  assert.equal(calls.some((call) => call.method === 'DELETE' && call.url.includes('ca_owner')), true);

  const raw = JSON.stringify({
    type: 'composio.trigger.message',
    metadata: { connected_account_id: 'ca_owner', user_id: 'belna:user-a', trigger_slug: 'GMAIL_NEW_EMAIL' },
    data: { id: 'mail-1' },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const id = 'msg_test';
  const signature = crypto.createHmac('sha256', process.env.COMPOSIO_WEBHOOK_SECRET)
    .update(`${id}.${timestamp}.${raw}`).digest('base64');
  const event = await composio.parseWebhook(raw, {
    'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}`,
  });
  assert.equal(event.ownerId, 'user-a');
  assert.equal(event.toolkit, 'gmail');
  assert.equal(event.trigger, 'GMAIL_NEW_EMAIL');

  await assert.rejects(
    () => composio.parseWebhook(raw, { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': 'v1,bad' }),
    /Bad webhook signature/,
  );

  const mine = await composio.listConnected('user-a');
  assert.equal(mine.length, 2);
  assert.equal(mine[0].email, 'jane@gmail.com');
  assert.equal(mine[0].picture, 'https://example.com/j.png');
  assert.equal(mine.some((a) => a.email === 'other@x.com'), false);

  const gmailTools = await composio.listTools('gmail', { query: 'send' });
  assert.equal(gmailTools[0].input_parameters.recipient_email.required, true,
    'connected-app discovery must preserve the action argument schema');
  const { TOOLS } = require('../server/agents/tools');
  const discovered = await TOOLS.composio_tools.run({ toolkit: 'gmail', query: 'send' }, { userId: 'user-a', trace: () => {} });
  assert.match(discovered.actions[0].arguments.recipient_email, /required/,
    'the agent must receive the required action arguments');

  const fs = require('node:fs');
  const path = require('node:path');
  const dataFile = path.join(__dirname, '../server/data.json');
  let prev = null;
  try { prev = fs.readFileSync(dataFile, 'utf8'); } catch {}
  try {
    const store = require('../server/store');
    await store.setConnectorPermissions('user-a', 'gmail', ['GMAIL_SEND_EMAIL']);
    await assert.rejects(
      () => composio.executeTool('user-a', { tool: 'GMAIL_SEND_EMAIL', connectedAccountId: 'ca_owner' }),
      /turned off/,
    );
    await assert.rejects(
      () => composio.executeTool('user-a', { tool: 'GMAIL_SEND_EMAIL', connectedAccountId: 'ca_github_owner' }),
      /cannot run this tool/,
    );
    const getPermissions = store.getConnectorPermissions;
    store.getConnectorPermissions = async () => { throw new Error('Permission database unavailable.'); };
    try {
      await assert.rejects(
        () => composio.executeTool('user-a', { tool: 'GMAIL_SEND_EMAIL', connectedAccountId: 'ca_owner' }),
        /Permission database unavailable/,
      );
    } finally {
      store.getConnectorPermissions = getPermissions;
    }
  } finally {
    if (prev != null) fs.writeFileSync(dataFile, prev);
    else try { fs.unlinkSync(dataFile); } catch {}
  }

  console.log('composio security: ok');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
