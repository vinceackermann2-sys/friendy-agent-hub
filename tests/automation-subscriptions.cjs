const assert=require('node:assert/strict');
process.env.COMPOSIO_API_KEY='test-composio-key';
process.env.COMPOSIO_WEBHOOK_SECRET='test-webhook-secret';
const calls=[];
let subscriptionReady=true;
global.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;
  calls.push({path,method:options.method || 'GET',body:options.body && JSON.parse(options.body)});
  let body;
  if(path.endsWith('/triggers_types'))body={items:[
    {slug:'GITHUB_NEW_ISSUE',toolkit:{slug:'github'},config:{}},
    {slug:'GITHUB_COMMIT',toolkit:{slug:'github'},config:{repo:{type:'string',required:true}}},
  ]};
  else if(path.endsWith('/webhook_subscriptions'))body={items:subscriptionReady?[{webhook_url:'https://belna.se/api/composio/webhook',enabled_events:['composio.trigger.message']}]:[]};
  else if(path.endsWith('/connected_accounts/ca_test'))body={id:'ca_test',user_id:'belna:owner-a',toolkit:{slug:'github'},status:'ACTIVE'};
  else if(path.endsWith('/trigger_instances/GITHUB_NEW_ISSUE/upsert'))body={trigger_id:'ti_test'};
  else throw new Error(`Unexpected Composio request: ${path}`);
  return {ok:true,text:async()=>JSON.stringify(body)};
};
const composio=require('../server/composio');
(async()=>{
  const created=await composio.ensureAppTrigger('owner-a','github','github_new_issue');
  assert.equal(created.trigger_id,'ti_test');
  assert.deepEqual(calls.at(-1),{
    path:'/api/v3.1/trigger_instances/GITHUB_NEW_ISSUE/upsert',method:'POST',
    body:{user_id:'belna:owner-a',trigger_config:{}},
  });
  await assert.rejects(()=>composio.ensureAppTrigger('owner-a','github','github_commit'),/additional setup/);
  await composio.ensureAppTrigger('owner-a','github','github_new_issue','ca_test');
  assert.equal(calls.at(-1).body.connected_account_id,'ca_test');
  subscriptionReady=false;
  await assert.rejects(()=>composio.ensureAppTrigger('owner-a','github','github_new_issue'),/delivery is not configured/);
  assert.equal(calls.filter(call=>call.path.includes('/upsert')).length,2,'no false subscription is created');
  console.log('automation connected-app registration and delivery checks: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
