const assert = require('node:assert/strict');
const authEmail = require('../server/auth-email');

function harness({ users = [], linkError = null, resendOk = true } = {}) {
  const calls = { links: [], updates: [], sent: [] };
  const admin = { auth: { admin: {
    async generateLink(params) {
      calls.links.push(params);
      if (linkError && params.type === 'signup') return { data: null, error: { message: linkError } };
      return { data: { properties: { email_otp: '482913' } }, error: null };
    },
    async updateUserById(id, attrs) { calls.updates.push({ id, attrs }); return { data: {}, error: null }; },
  } } };
  global.fetch = async (url, init = {}) => {
    if (String(url).includes('/auth/v1/admin/users')) return Response.json({ users });
    calls.sent.push({ url, body: JSON.parse(init.body) });
    return resendOk ? Response.json({ id: 'email_1' }) : new Response('nope', { status: 500 });
  };
  return { admin, calls };
}

async function main() {
  const old = { fetch: global.fetch, env: { ...process.env }, error: console.error };
  Object.assign(process.env, { RESEND_API_KEY: 're_test_key_123', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' });
  console.error = () => {};
  try {
    assert.equal(authEmail.configured(), true);

    // Sign-in codes come from Belna's own sender and template, never Supabase's.
    let h = harness();
    await authEmail.sendAuthCode(h.admin, { email: ' New@Example.com ', kind: 'signin', data: { terms_version: 'v' } });
    assert.deepEqual(h.calls.links, [{ type: 'magiclink', email: 'new@example.com', options: { data: { terms_version: 'v' } } }]);
    const mail = h.calls.sent[0];
    assert.equal(mail.url, 'https://api.resend.com/emails');
    assert.equal(mail.body.from, 'Belna <hej@mail.belna.se>');
    assert.deepEqual(mail.body.to, ['new@example.com']);
    assert.equal(mail.body.subject, 'Your Belna sign-in code');
    assert.match(mail.body.html, /482913/);
    assert.match(mail.body.html, /belna\.se\/email-logo\.png/);
    assert.match(mail.body.text, /482913/);
    assert.doesNotMatch(mail.body.html + mail.body.text, /supabase/i);

    // One code a minute per address, like Supabase's own mailer.
    h = harness({ users: [{ id: 'u1', email: 'new@example.com', email_confirmed_at: '2026-01-01', recovery_sent_at: new Date().toISOString() }] });
    await assert.rejects(authEmail.sendAuthCode(h.admin, { email: 'new@example.com' }), (e) => e.status === 429 && e.code === 'COOLDOWN');
    assert.equal(h.calls.links.length, 0);
    assert.equal(authEmail.sentRecently({ recovery_sent_at: new Date(Date.now() - 61_000).toISOString() }), false);
    // The admin filter is a substring search; another address is not a match.
    h = harness({ users: [{ id: 'u2', email: 'xnew@example.com', recovery_sent_at: new Date().toISOString() }] });
    await authEmail.sendAuthCode(h.admin, { email: 'new@example.com' });
    assert.equal(h.calls.links.length, 1);

    // Password sign-up: a confirmation code, not a Supabase link.
    h = harness();
    const signup = await authEmail.sendAuthCode(h.admin, { email: 'a@example.com', kind: 'signup', password: 'longpassword' });
    assert.equal(signup.purpose, 'signup');
    assert.equal(h.calls.links[0].type, 'signup');
    assert.equal(h.calls.links[0].password, 'longpassword');
    assert.equal(h.calls.sent[0].body.subject, 'Confirm your Belna account');

    // An unconfirmed account takes the newest password, as Supabase sign-up does.
    h = harness({ users: [{ id: 'u3', email: 'a@example.com', email_confirmed_at: null }] });
    await authEmail.sendAuthCode(h.admin, { email: 'a@example.com', kind: 'signup', password: 'newpassword1' });
    assert.deepEqual(h.calls.updates, [{ id: 'u3', attrs: { password: 'newpassword1' } }]);

    // A confirmed account gets a sign-in code, so sign-up never reveals it exists.
    h = harness({ users: [{ id: 'u4', email: 'a@example.com', email_confirmed_at: '2026-01-01' }] });
    assert.equal((await authEmail.sendAuthCode(h.admin, { email: 'a@example.com', kind: 'signup', password: 'x'.repeat(9) })).purpose, 'signin');
    assert.equal(h.calls.links[0].type, 'magiclink');
    assert.equal(h.calls.updates.length, 0);
    h = harness({ linkError: 'A user with this email address has already been registered' });
    assert.equal((await authEmail.sendAuthCode(h.admin, { email: 'a@example.com', kind: 'signup', password: 'x'.repeat(9) })).purpose, 'signin');
    assert.deepEqual(h.calls.links.map((l) => l.type), ['signup', 'magiclink']);

    h = harness({ resendOk: false });
    await assert.rejects(authEmail.sendAuthCode(h.admin, { email: 'a@example.com' }), (e) => e.status === 503 && e.code === 'SEND_FAILED');

    assert.doesNotMatch(authEmail.codeEmailHtml({ code: '<b>12</b>' }), /<b>12/);
  } finally {
    global.fetch = old.fetch;
    console.error = old.error;
    for (const k of Object.keys(process.env)) if (!(k in old.env)) delete process.env[k];
    Object.assign(process.env, old.env);
  }
  console.log('auth email: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
