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
  console.log('composio security: ok');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
