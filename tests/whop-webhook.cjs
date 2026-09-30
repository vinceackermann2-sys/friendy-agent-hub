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
  // Exercise the deployed ingress: human cardholders must not replace the
  // connected business account used to recover an approved purchase.
  const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
  const source=fs.readFileSync('supabase/functions/whop-wallet-webhook/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
  let handler;const queued=[];
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
    Deno:{env:{get:name=>({WHOP_WEBHOOK_SECRET:secret,SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'}[name])},serve:fn=>handler=fn},
    verifyWhopWebhook,Response,createClient:()=>({from:()=>({insert:async record=>{queued.push(record);return {error:null};}})})
  });
  const deliver=async payload=>{const raw=JSON.stringify(payload),signed=createHmac('sha256',secret).update(`${id}.${timestamp}.${raw}`).digest('base64');return handler(new Request('https://example.test/whop-wallet-webhook',{method:'POST',headers:{...headers,'webhook-signature':`v1,${signed}`},body:raw}));};
  assert.equal((await deliver({...event,user_id:'user_owner',data:{card_id:'icrd_test',cardholder_id:'user_owner'}})).status,200);
  assert.equal(queued[0].account_id,'biz_test');
  assert.equal((await deliver({...event,account_id:null,company_id:'biz_fallback',data:{card_id:'icrd_test',user_id:'user_owner'}})).status,200);
  assert.equal(queued[1].account_id,'biz_fallback');
  assert.equal((await deliver({...event,account_id:'user_owner'})).status,400);assert.equal(queued.length,2);
  assert.equal((await deliver({...event,type:'card_application.approved'})).status,200);assert.equal(queued.length,2);
  console.log('Whop webhook: valid signature, tamper, replay and wrong secret checks passed');
})().catch(error => { console.error(error); process.exit(1); });
