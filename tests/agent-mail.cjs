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

  assert.equal(mail.verifyWebhook('{}', {}), false);

  console.log('agent mail: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
