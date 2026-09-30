// Explicit real-cloud check. Creates one temporary account and cleans only its data.
// Run with server environment configured; never included in npm test.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {createClient}=require('@supabase/supabase-js');
const store=require('../server/store');
const {configureGoalWork}=require('../server/agents/goal-work');
(async()=>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  assert.ok(url && key,'Server database configuration required');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const email='lingon-release-'+crypto.randomUUID()+'@example.invalid';
  const created=await db.auth.admin.createUser({email,password:crypto.randomUUID()+'aA1!',email_confirm:true});
  if(created.error)throw created.error;const userId=created.data.user.id,files=[];let agentId;
  const report={checkedAt:new Date().toISOString(),checks:[]};
  try{
    const original=await store.saveLibraryItem(userId,{title:'Release.md',mime:'text/markdown',content:'Original evidence',source:'upload'});files.push(original.id);
    assert.equal((await store.getLibraryItem(userId,original.id)).content,'Original evidence');
    const raw=await db.from('library_items').select('content,storage_path').eq('id',original.id).eq('user_id',userId).single();if(raw.error)throw raw.error;
    assert.equal(raw.data.content,'');assert.ok(raw.data.storage_path);
    const publicRead=await fetch(url+'/storage/v1/object/public/library-private/'+raw.data.storage_path);assert.ok(!publicRead.ok,'Original is private');
    const edited=await store.saveLibraryItem(userId,{id:original.id,revision:1,title:'Release.md',mime:'text/markdown',content:'Revised evidence'});
    assert.equal(edited.revision,2);assert.equal((await store.getLibraryItem(userId,original.id,1)).content,'Original evidence');
    await assert.rejects(store.saveLibraryItem(userId,{id:original.id,revision:1,content:'Stale'}),{code:'CONFLICT'});
    assert.equal(await store.getLibraryItem('foreign-release-account',original.id),null);assert.equal((await store.listLibraryVersions(userId,original.id)).length,2);
    report.checks.push('private cloud upload/download, version history, stale edit rejection, owner isolation');
    const {zipSync,strToU8}=await import('fflate');const bytes=zipSync({'word/document.xml':strToU8('<w:document><w:body><w:p><w:r><w:t>All three requirements</w:t></w:r></w:p></w:body></w:document>')});
    const doc=await store.saveLibraryItem(userId,{title:'Requirements.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',content:'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'+Buffer.from(bytes).toString('base64')});files.push(doc.id);
    assert.match((await store.getLibraryItem(userId,doc.id)).extractedText,/All three requirements/);report.checks.push('document extraction persisted with original cloud file');
    const grant=await store.createPermissionGrant(userId,{tool:'composio_execute',effect:'allow',match:{tool:'GMAIL_FETCH_EMAILS',connectedAccountId:'ca_release',args:{label:'INBOX'}},expiresAt:new Date(Date.now()+86400000).toISOString()});
    assert.equal((await store.listPermissionGrants(userId)).length,1);await store.revokePermissionGrant('foreign-release-account',grant.id);assert.equal((await store.listPermissionGrants(userId)).length,1);
    await store.revokePermissionGrant(userId,grant.id);assert.equal((await store.listPermissionGrants(userId)).length,0);report.checks.push('cloud grant persistence, foreign revoke blocked, owner revocation');
    const goal=await store.createGoal(userId,{title:'Release test goal'}),configured=await configureGoalWork(store,userId,goal.id,{successCriteria:'Verified release checks',nextAction:'Compare evidence',maxRuns:2,intervalMinutes:1440});agentId=configured.work.agentId;
    assert.equal((await store.getSubAgent(userId,agentId)).trigger.goalId,goal.id);
    await store.recordGoalActivity(userId,goal.id,{runId:'old',status:'done'},'old-config','Stale action',null);assert.equal((await store.getGoal(userId,goal.id)).work.nextAction,'Compare evidence');
    await store.recordGoalActivity(userId,goal.id,{runId:'current',status:'done'},configured.work.configurationId,'Verified action',null);
    await store.recordGoalActivity(userId,goal.id,{runId:'current',status:'done'},configured.work.configurationId,'Duplicate action',null);assert.equal((await store.getGoal(userId,goal.id)).activity.length,2);
    const run=()=>store.beginAutomationRun(userId,agentId,configured.work.chatId,crypto.randomUUID(),{});
    const first=await run();await assert.rejects(run(),e=>/already active/.test(e.message));await store.finishAutomationRun(userId,first.id,'done',{},null);
    const second=await run();await store.finishAutomationRun(userId,second.id,'done',{},null);await assert.rejects(run(),e=>/budget reached/.test(e.message));
    await configureGoalWork(store,userId,goal.id,{enabled:false});assert.equal((await store.getSubAgent(userId,agentId)).enabled,false);report.checks.push('real linked schedule, atomic activity, overlap prevention, run cap, pause');
    for(const id of files)await store.deleteLibraryItem(userId,id);await store.sweepLibraryStorage(userId);
    const removed=await db.storage.from('library-private').download(raw.data.storage_path);assert.ok(removed.error);report.checks.push('cloud originals deleted with revision cleanup');
    report.passed=true;
  } finally {
    if(agentId)await db.from('sub_agents').update({enabled:false}).eq('id',agentId).eq('user_id',userId);
    for(const id of files)await store.deleteLibraryItem(userId,id).catch(()=>{});
    await store.sweepLibraryStorage(userId).catch(()=>{});
    const profile=await db.from('profiles').delete().eq('id',userId);if(profile.error)throw profile.error;
    const auth=await db.auth.admin.deleteUser(userId);if(auth.error)throw auth.error;report.temporaryAccountRemoved=true;
  }
  fs.mkdirSync('artifacts/devday-release',{recursive:true});fs.writeFileSync('artifacts/devday-release/cloud-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error('Cloud verification failed:',e.message);process.exitCode=1;});
