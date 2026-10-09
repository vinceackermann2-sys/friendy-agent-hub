const assert = require('node:assert/strict');
const { pickTools } = require('../server/agents/tools');
const mail = require('../server/mail');

async function main() {
  assert.equal(mail.slugifyName('Agrippa'), 'agrippa');
  assert.equal(mail.slugifyName('Åsa Lind'), 'asa-lind');
  assert.equal(mail.slugifyName('!!!'), 'agent');
  assert.ok(mail.isReserved('hej'));
  assert.ok(mail.isReserved('noreply'));
  assert.ok(!mail.isReserved('agrippa'));
  assert.equal(mail.addressFor('agrippa'), 'agrippa@mail.belna.se');

  const names = pickTools('send a mail to the landlord').map((t) => t.name);
  assert.ok(names.includes('mail_status'));
  assert.ok(names.includes('mail_send'));
  assert.equal(pickTools('skriv ett mejl').find((t) => t.name === 'mail_send').approval, true);

  try {
    await mail.send('user_test', { to: 'a@b.co', subject: 'Hi', body: 'x', confirm: false });
    assert.fail('expected confirm gate');
  } catch (e) {
    assert.equal(e.code, 'NEED_CONFIRM');
  }

  try {
    await mail.send('user_test', { to: 'not-an-email', subject: 'Hi', body: 'x', confirm: true });
    assert.fail('expected bad input');
  } catch (e) {
    assert.equal(e.code, 'BAD_INPUT');
  }

  const parsed = mail.parseAddressList(['Agrippa <agrippa@mail.belna.se>', 'human@example.com']);
  assert.equal(parsed[0].email, 'agrippa@mail.belna.se');
  assert.equal(parsed[0].name, 'Agrippa');
  assert.equal(parsed[1].email, 'human@example.com');

  const branded = mail.brandEmailHtml({
    agentName: 'Alva & Co',
    agentAddress: 'alva@mail.belna.se',
    bodyText: 'Hello <team>,\n\nThe report is ready.',
  });
  assert.match(branded, /belna/);
  assert.match(branded, /Alva &amp; Co/);
  assert.match(branded, /Hello &lt;team&gt;/);
  assert.match(branded, /alva@mail\.belna\.se/);
  assert.doesNotMatch(branded, /Hello <team>/);
  // Agent mail reads like a personal note: no banner or automated-message framing,
  // and a short signature that still says it comes from an AI agent.
  assert.doesNotMatch(branded, /Message from a Belna agent|automated|email-logo\.png/i);
  assert.match(branded, /Personal AI agent/);
  assert.match(branded, /Hello &lt;team&gt;,<\/p><p style="margin:0 0 16px;">The report is ready\./);
  assert.equal(mail.brandEmailText({ bodyText: 'Hi Sam,\n\nThanks!', agentName: 'Alva', agentAddress: 'alva@mail.belna.se' }),
    'Hi Sam,\n\nThanks!\n\n-- \nAlva\nalva@mail.belna.se\nPersonal AI agent · belna.se');

  assert.equal(mail.verifyWebhook('{}', {}), false);
  // A correctly signed delivery is accepted only within five minutes of its timestamp.
  {
    const previous = process.env.RESEND_WEBHOOK_SECRET;
    const key = require('node:crypto').randomBytes(24);
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + key.toString('base64');
    const signed = (ts, body = '{"type":"email.received"}') => ({ 'svix-id': 'msg_1', 'svix-timestamp': String(ts),
      'svix-signature': 'v1,' + require('node:crypto').createHmac('sha256', key).update('msg_1.' + ts + '.' + body).digest('base64') });
    const now = Math.floor(Date.now() / 1000);
    try {
      assert.equal(mail.verifyWebhook('{"type":"email.received"}', signed(now)), true);
      assert.equal(mail.verifyWebhook('{"type":"email.received"}', signed(now - 3600)), false, 'an old delivery cannot be replayed');
      assert.equal(mail.verifyWebhook('{"type":"email.received"}', signed(now + 3600)), false);
      assert.equal(mail.verifyWebhook('{"type":"other"}', signed(now)), false);
    } finally { previous === undefined ? delete process.env.RESEND_WEBHOOK_SECRET : process.env.RESEND_WEBHOOK_SECRET = previous; }
  }

  const store = require('../server/store');
  const old = {
    fetch: global.fetch,
    key: process.env.RESEND_API_KEY,
    getMailboxByUser: store.getMailboxByUser,
    countOutboundMailToday: store.countOutboundMailToday,
    insertMailMessage: store.insertMailMessage,
  };
  try {
    process.env.RESEND_API_KEY = 'test-resend-key';
    store.getMailboxByUser = async () => ({ address: 'alva@mail.belna.se', displayName: 'Alva' });
    store.countOutboundMailToday = async () => 0;
    store.insertMailMessage = async (_userId, row) => ({ id: 'msg_1', ...row, at: Date.now() });
    let sentTo;
    global.fetch = async (_url, init) => {
      sentTo = JSON.parse(init.body).to;
      return Response.json({ id: 'resend_1' });
    };
    const sent = await mail.send('user_test', { to: 'new.person@example.com', subject: 'Hello', body: 'Hello there', confirm: true });
    assert.deepEqual(sentTo, ['new.person@example.com']);
    assert.deepEqual(sent.to, ['new.person@example.com']);

    // Files from the Mail panel go to Resend as base64, with safe names and checked sizes.
    let sentBody;
    global.fetch = async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return Response.json({ id: 'resend_2' });
    };
    const withFiles = (attachments) => mail.send('user_test', { to: 'a@example.com', subject: 'Files', body: 'See attached', confirm: true, attachments });
    const pdf = Buffer.from('%PDF-1.4').toString('base64');
    await withFiles([{ filename: 'a/b.pdf', content: pdf, contentType: 'application/pdf' }, { filename: 'notes.txt', content: pdf, contentType: 'bad type' }]);
    assert.deepEqual(sentBody.attachments, [{ filename: 'a_b.pdf', content: pdf, content_type: 'application/pdf' }, { filename: 'notes.txt', content: pdf }]);
    await mail.send('user_test', { to: 'a@example.com', subject: 'No files', body: 'Plain', confirm: true });
    assert.equal(sentBody.attachments, undefined);
    await assert.rejects(withFiles([{ filename: 'x.txt', content: 'not base64!' }]), /could not be read/);
    await assert.rejects(withFiles(Array.from({ length: 11 }, (_, i) => ({ filename: i + '.txt', content: pdf }))), /up to 10 files/);
    await assert.rejects(withFiles([{ filename: 'big.bin', content: Buffer.alloc(8 * 1024 * 1024 + 3).toString('base64') }]), /8 MB/);
  } finally {
    global.fetch = old.fetch;
    old.key === undefined ? delete process.env.RESEND_API_KEY : process.env.RESEND_API_KEY = old.key;
    store.getMailboxByUser = old.getMailboxByUser;
    store.countOutboundMailToday = old.countOutboundMailToday;
    store.insertMailMessage = old.insertMailMessage;
  }

  // The address is the agent's saved name, and follows it when the agent is renamed.
  {
    const saved = {};
    for (const k of ['getAgentContext', 'getMailboxByUser', 'getMailboxByAddress', 'upsertMailbox', 'mailLocalPartTaken', 'mailAddressPastOwner', 'getMailMessageByResendId', 'insertMailMessage']) saved[k] = store[k];
    const boxes = new Map(), names = new Map(), used = new Map(), inserted = [];
    store.getAgentContext = async (userId) => ({ agent: { name: names.get(userId) || 'Your agent' } });
    store.getMailboxByUser = async (userId) => boxes.get(userId) || null;
    store.getMailboxByAddress = async (addr) => [...boxes.values()].find((b) => b.address === addr) || null;
    store.upsertMailbox = async (userId, patch) => { const next = { ...(boxes.get(userId) || {}), ...patch, userId }; boxes.set(userId, next); return next; };
    store.mailLocalPartTaken = async (part, userId) => [...boxes.values()].some((b) => b.localPart === part && b.userId !== userId);
    store.mailAddressPastOwner = async (addr) => used.get(addr) || null;
    store.getMailMessageByResendId = async () => null;
    store.insertMailMessage = async (userId, row) => { inserted.push({ userId, ...row }); return { id: 'in_' + inserted.length, ...row }; };
    try {
      // Before the owner picks a name the mailbox has a neutral address, never your-agent@.
      const unnamed = await mail.ensureMailbox('u1');
      assert.match(unnamed.address, /^agent-[0-9a-f]{4}@mail\.belna\.se$/);
      names.set('u1', 'Alva');
      assert.equal((await mail.ensureMailbox('u1')).address, 'alva@mail.belna.se', 'naming the agent moves the address to its name');
      assert.equal(boxes.get('u1').displayName, 'Alva');
      // A name passed by a request or the model is ignored; only the saved name counts.
      assert.equal((await mail.agentStatus('u1', 'Hacker')).address, 'alva@mail.belna.se');
      assert.equal((await mail.ensureMailbox('u1', 'Your agent')).address, 'alva@mail.belna.se', 'a placeholder keeps the named address');

      // Another owner who also picks Alva gets the closest free form of the name.
      names.set('u2', 'Alva');
      const second = await mail.ensureMailbox('u2');
      assert.match(second.address, /^alva-[0-9a-f]{4}@mail\.belna\.se$/);
      assert.equal((await mail.ensureMailbox('u2')).address, second.address, 'a suffixed address is stable');

      // Renaming moves the address; the old one, once used for mail, is never handed on.
      used.set('alva@mail.belna.se', 'u1');
      names.set('u1', 'Åsa Berg');
      assert.equal((await mail.ensureMailbox('u1')).address, 'asa-berg@mail.belna.se');
      names.set('u3', 'Alva');
      assert.notEqual((await mail.ensureMailbox('u3')).address, 'alva@mail.belna.se');
      names.set('u1', 'Alva');
      assert.equal((await mail.ensureMailbox('u1')).address, 'alva@mail.belna.se', 'an owner can take back their own old address');

      // With every form of the name taken, the fallback address is kept rather than redrawn on each read.
      const taken = store.mailLocalPartTaken;
      store.mailLocalPartTaken = async () => true;
      try {
        names.set('u4', 'Alva');
        const fallback = (await mail.ensureMailbox('u4')).address;
        assert.match(fallback, /^agent-[0-9a-f]{8}@mail\.belna\.se$/);
        assert.equal((await mail.ensureMailbox('u4')).address, fallback, 'a fallback address is stable');
      } finally { store.mailLocalPartTaken = taken; }

      // Mail to the address an agent had before a rename still reaches that agent.
      names.set('u1', 'Bo');
      assert.equal((await mail.ensureMailbox('u1')).address, 'bo@mail.belna.se');
      const previous = process.env.RESEND_WEBHOOK_SECRET;
      const crypto = require('node:crypto'), key = crypto.randomBytes(24);
      process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + key.toString('base64');
      try {
        const body = JSON.stringify({ type: 'email.received', data: { email_id: 'r1', from: 'Sam <sam@example.com>', to: ['alva@mail.belna.se'], subject: 'Hi', text: 'Hello' } });
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = 'v1,' + crypto.createHmac('sha256', key).update('w1.' + ts + '.' + body).digest('base64');
        const out = await mail.ingestWebhook(body, { 'svix-id': 'w1', 'svix-timestamp': ts, 'svix-signature': sig });
        assert.equal(out.address, 'bo@mail.belna.se');
        assert.equal(inserted.at(-1).userId, 'u1');
      } finally { previous === undefined ? delete process.env.RESEND_WEBHOOK_SECRET : process.env.RESEND_WEBHOOK_SECRET = previous; }
    } finally {
      Object.assign(store, saved);
    }
  }

  console.log('agent mail: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
