const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const {PGlite} = require('@electric-sql/pglite');
const {createAzureAccountErasure} = require('../server/agents/azure-erasure');
const {eraseLibraryStorage,accountDeletionPending} = require('../server/account-deletion');
const {createAppleAccountCleanup} = require('../server/apple-auth');

const owner = crypto.randomUUID(), other = crypto.randomUUID();
const hash = id => crypto.createHash('sha256').update(id).digest('hex').slice(0,24);
const cfg={subscriptionId:'subscription',resourceGroup:'sandbox'};
const root='/subscriptions/subscription/resourceGroups/sandbox';
const name='lingon-sb-'+hash(owner), disk=`${root}/providers/Microsoft.Compute/disks/${name}_OsDisk_1`;
const machine=`${root}/providers/Microsoft.Compute/virtualMachines/${name}`;
const nic=`${root}/providers/Microsoft.Network/networkInterfaces/${name}-nic`;
const prefix=hash(owner)+'/';

(async()=>{
  let vmPresent=true, diskPresent=true, failDisk=false, retained=false, wrongBlob=false;
  const calls=[], blobs=new Map([['agent-state',[prefix+'workspace-v1.tar.gz',hash(other)+'/workspace-v1.tar.gz']],['browser-shots',[prefix+'shot.jpg',hash(other)+'/shot.jpg']]]);
  const arm=async(config,method,path)=>{
    calls.push({method,path});
    if(method==='GET' && path===machine){if(!vmPresent)throw Object.assign(new Error('missing'),{code:'AZURE_NOT_FOUND'});return{tags:{lingon:'sandbox',user:hash(owner)},properties:{storageProfile:{osDisk:{managedDisk:{id:disk}}},networkProfile:{networkInterfaces:[{id:nic}]}}};}
    if(path.endsWith('/listKeys'))return {keys:[{value:Buffer.from('test-private-key').toString('base64')}]};
    if(method==='DELETE' && path===machine){vmPresent=false;return{};}
    if(method==='DELETE' && path===disk){if(failDisk)throw new Error('private Azure details');diskPresent=false;return{};}
    if(path===machine+'/deallocate' || path===nic)return{};
    throw new Error('Unexpected resource: '+path);
  };
  const fetchImpl=async(value,options)=>{
    const url=new URL(value), parts=url.pathname.slice(1).split('/'), container=parts.shift();
    assert.equal(url.hostname,'belnatest.blob.core.windows.net');
    if(options.method==='DELETE'){
      const target=parts.map(decodeURIComponent).join('/');assert.ok(target.startsWith(prefix));
      if(!retained)blobs.set(container,blobs.get(container).filter(x=>x!==target));
      return new Response(null,{status:202});
    }
    assert.equal(url.searchParams.get('prefix'),prefix);
    const rows=wrongBlob?[hash(other)+'/injected.jpg']:blobs.get(container).filter(x=>x.startsWith(prefix));
    return new Response('<EnumerationResults><Blobs>'+rows.map(x=>'<Blob><Name>'+x+'</Name>'+(retained?'<Deleted>true</Deleted>':'')+'</Blob>').join('')+'</Blobs><NextMarker/></EnumerationResults>');
  };
  const eraser=createAzureAccountErasure({config:()=>cfg,arm,userHash:hash,vmNameForUser:id=>'lingon-sb-'+hash(id),storageAccountName:()=> 'belnatest',fetchImpl});
  const manifest=await eraser.plan(owner);
  assert.deepEqual(manifest,{diskIds:[disk]});
  failDisk=true;await assert.rejects(eraser.erase(owner,manifest));
  assert.equal(vmPresent,false);assert.equal(diskPresent,true);
  failDisk=false;
  const retry=await eraser.plan(owner,manifest);assert.deepEqual(retry,manifest,'retry retains detached disk after VM removal');
  await eraser.erase(owner,retry);assert.equal(diskPresent,false);
  assert.deepEqual(blobs.get('agent-state'),[hash(other)+'/workspace-v1.tar.gz']);
  assert.deepEqual(blobs.get('browser-shots'),[hash(other)+'/shot.jpg']);
  assert.ok(calls.findIndex(x=>x.path===machine+'/deallocate')<calls.findIndex(x=>x.method==='DELETE' && x.path===machine));
  assert.ok(calls.every(x=>!x.path.includes('virtualNetworks') && !x.path.includes('networkSecurityGroups')));
  await assert.rejects(eraser.plan(owner,{diskIds:[disk.replace(name,'another-account')]}),/ownership/);
  wrongBlob=true;await assert.rejects(eraser.erase(owner,manifest),/ownership/);wrongBlob=false;
  retained=true;blobs.set('agent-state',[prefix+'retained.tar.gz']);await assert.rejects(eraser.erase(owner,manifest),/retention/);

  const files=new Set([`${owner}/lib_one/1-a`,`${owner}/lib_one/2-b`,`${other}/lib_one/1-a`]);
  const bucket={list:async path=>({data:[...new Set([...files].filter(x=>x.startsWith(path+'/')).map(x=>x.slice(path.length+1).split('/')[0]))].map(part=>({name:part,id:files.has(path+'/'+part)?'file':null}))}),remove:async paths=>{for(const path of paths)files.delete(path);return{};}};
  await eraseLibraryStorage({storage:{from:name=>{assert.equal(name,'library-private');return bucket;}}},owner);
  assert.deepEqual([...files],[`${other}/lib_one/1-a`]);
  await assert.rejects(eraseLibraryStorage({storage:{from:()=>({list:async()=>({error:new Error('private')})})}},owner),/unavailable/);
  assert.equal(await accountDeletionPending(owner,{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{user_id:owner}})})})})}),true);

  // A real PostgreSQL marker/trigger test protects other users and late writes.
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create table profiles(id text primary key); create table agent_vm_leases(user_id text); create table agent_chat_tasks(user_id text); create table library_items(user_id text,content text);');
    await db.exec(fs.readFileSync('supabase/migrations/20261004153143_account_deletion_fence.sql','utf8'));
    await db.query('insert into profiles values($1),($2)',[owner,other]);
    await db.query('insert into account_deletions(user_id) values($1)',[owner]);
    for(const table of ['agent_vm_leases','agent_chat_tasks','library_items']){
      await assert.rejects(db.query(`insert into ${table}(user_id) values($1)`,[owner]),/deletion/);
      await db.query(`insert into ${table}(user_id) values($1)`,[other]);
    }
    await db.query('delete from profiles where id=$1',[owner]);
    await assert.rejects(db.query('insert into profiles values($1)',[owner]),/deletion/);
    assert.equal((await db.query("select has_table_privilege('authenticated','account_deletions','SELECT') ok")).rows[0].ok,false);
    assert.equal((await db.query('select count(*)::int n from account_deletions')).rows[0].n,1,'fence survives profile deletion');
  }finally{await db.close();}

  // An unavailable cleanup must prevent auth/database purge and allow a retry.
  const cleanupCalls=[];
  const builder=table=>{const q={upsert:()=>{cleanupCalls.push('fence');return q;},update:()=>q,delete:()=>q,select:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>q,then:resolve=>resolve({data:table==='account_deletions'?{workspace_resources:manifest}:[],error:null})};return q;};
  const cleanup=createAppleAccountCleanup({adminClient:()=>({from:builder,storage:{from:()=>bucket}}),tasks:{control:async()=>{}},composio:{configured:()=>false},azure:{isAzureConfigured:()=>true,planAccountErasure:async()=>manifest,eraseAccountWorkspace:async()=>{cleanupCalls.push('cloud');throw new Error('retention');}}});
  await assert.rejects(cleanup(owner),/retention/);assert.deepEqual(cleanupCalls,['fence','cloud']);

  // Exercise the production edge route's actual dependency binding. A partial
  // Azure facade previously omitted plan/erase and made all live deletions fail.
  cleanupCalls.length=0;
  let edgeCleanup;
  const edgeSource=fs.readFileSync('src/lingon-server/index.js','utf8');
  const installLine=edgeSource.split(/\r?\n/).find(line=>line.startsWith('installAppleAuthRoutes(app,'));
  const azureFixture={isAzureConfigured:()=>true,planAccountErasure:async()=>manifest,eraseAccountWorkspace:async()=>{cleanupCalls.push('cloud');}};
  vm.runInNewContext(installLine,{
    app:{},requireAuth:()=>{},rateLimit:()=>{},pubClient:()=>{},store:{},stripeMod:{},chatTasks:{control:async()=>{}},
    adminClient:()=>({from:builder,storage:{from:()=>bucket}}),composio:{configured:()=>false},
    azure:azureFixture,isAzureConfigured:azureFixture.isAzureConfigured,deallocateVm:async()=>{},createAppleAccountCleanup,
    installAppleAuthRoutes:(_app,options)=>{edgeCleanup=options.beforeDelete;},
  });
  await edgeCleanup(owner);
  assert.deepEqual(cleanupCalls,['fence','cloud'],'deployed edge route must invoke full cloud erasure');

  // Production VM operations read the durable fence before provisioning or work.
  const src=fs.readFileSync('server/agents/azure-vm.js','utf8'), mod={exports:{}};
  const env={SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
  const providerRequire=require('node:module').createRequire(require('node:path').resolve('server/agents/azure-vm.js'));
  vm.runInNewContext(src,{module:mod,require:providerRequire,process:{env},Buffer,URLSearchParams,AbortSignal,setTimeout,clearTimeout,console,fetch:async()=>new Response(JSON.stringify([{user_id:owner}]))});
  await assert.rejects(mod.exports.assertAccountActive(owner),error=>error.code==='ACCOUNT_DELETING');

  let pending=true, readBody=false, handled=false;
  const authModule={exports:{}};
  const fakeClient={auth:{getUser:async()=>({data:{user:{id:owner}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:pending?{user_id:owner}:null})})})})};
  vm.runInNewContext(fs.readFileSync('server/auth.js','utf8'),{module:authModule,process:{env:{SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'}},require:name=>name==='@supabase/supabase-js'?{createClient:()=>fakeClient}:require('../server/account-deletion')});
  const req={headers:{authorization:'Bearer fixture.jwt.token'},readBody:async()=>{readBody=true;}};
  let status=200;const res={status:code=>{status=code;return res;},json:()=>{}};
  await authModule.exports.requireAuth(async()=>{handled=true;})(req,res,error=>{throw error;});
  assert.equal(status,409);assert.equal(handled,false);assert.equal(readBody,false,'locked account cannot start an upload');
  await authModule.exports.requireAuth(async()=>{handled=true;},{allowDeleting:true})(req,res,error=>{throw error;});
  assert.equal(handled,true,'pending deletion can be retried with verified identity');
  pending=false;handled=false;status=200;
  await authModule.exports.requireAuth(async()=>{handled=true;})(req,res,error=>{throw error;});assert.equal(handled,true);
  console.log('Account erasure: scoped disks/blobs/library, retained-archive failure, detached-disk retry, SQL fences and VM deletion gate passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
