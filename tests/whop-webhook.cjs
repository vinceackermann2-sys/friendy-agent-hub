const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { verifyWhopWebhook } = require('../server/whop-webhook');

(async () => {
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const id = 'msg_verified123';
  const secret = 'ws_testsecret';
  const event = { id, api_version:'v1', type:'card_transaction.completed', account_id:'biz_test', data:{ card_id:'icrd_test' } };
  const body = JSON.stringify(event);
  const signature = createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64');
  const headers = { 'webhook-id':id, 'webhook-timestamp':timestamp, 'webhook-signature':`v1,${signature}` };
  assert.deepEqual(await verifyWhopWebhook(body,headers,secret,now),event);
  await assert.rejects(verifyWhopWebhook(body+' ',headers,secret,now),/Invalid Whop webhook/);
  await assert.rejects(verifyWhopWebhook(body,{...headers,'webhook-timestamp':String(Number(timestamp)-301)},secret,now),/Invalid Whop webhook/);
  const mismatchedBody = JSON.stringify({...event,id:'msg_other'});
  const mismatchedSignature = createHmac('sha256',secret).update(`${id}.${timestamp}.${mismatchedBody}`).digest('base64');
  await assert.rejects(verifyWhopWebhook(mismatchedBody,{...headers,'webhook-signature':`v1,${mismatchedSignature}`},secret,now),/Invalid Whop webhook/);
  await assert.rejects(verifyWhopWebhook(body,headers,'ws_wrongsecret',now),/Invalid Whop webhook/);
  console.log('Whop webhook: valid signature, tamper, replay and wrong secret checks passed');
})().catch(error => { console.error(error); process.exit(1); });
