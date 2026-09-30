const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');

(async()=>{
  const source=fs.readFileSync('supabase/.temp/wallet-card-recovery/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal(compiled.diagnostics.length,0,'dashboard bundle must compile');
  let handler,failedQueue=false,failedHealth=false,failedProvider=false,health,providerCalls=0;
  const secrets={wallet_recovery_secret:'a'.repeat(64)};
  const query=new Proxy({then:resolve=>resolve({data:[],error:null})},{get:(target,key)=>key==='then'?target.then:()=>query});
  const db={from:()=>query,rpc:async(name,args)=>{
    if(name==='get_server_secret')return {data:secrets[args.p_name]};
    if(name==='claim_belna_wallet_webhook_events')return failedQueue?{error:{code:'DB_ERROR'}}:{data:[]};
    if(name==='put_server_secret'){
      if(failedHealth)return {error:{code:'DB_ERROR'}};
      assert.equal(args.p_name,'wallet_recovery_health');health=JSON.parse(args.p_secret);return {data:'health-id'};
    }
    throw Error('Unexpected RPC');
  }};
  const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only',WHOP_COMPANY_API_KEY:'server-only',WHOP_PLATFORM_ACCOUNT_ID:'biz_CpeJbprflNa2ju'};
  vm.runInNewContext(compiled.outputText,{Deno:{env:{get:name=>env[name]},serve:fn=>handler=fn},
    createClient:()=>db,crypto:globalThis.crypto,TextEncoder,Response,Date,AbortSignal,URL,
    fetch:async(url,options)=>{
      providerCalls++;
      assert.equal(url,'https://api.whop.com/api/v1/accounts/biz_CpeJbprflNa2ju');
      assert.equal(options.method,'GET');
      if(failedProvider)throw Error('Provider unavailable');
      return {ok:true,json:async()=>({id:'biz_CpeJbprflNa2ju'})};
    }});
  const req=token=>new Request('https://example.test/recovery',{method:'POST',headers:{authorization:token}});
  assert.equal((await handler(req('Bearer bad'))).status,401);
  assert.equal(health,undefined,'unauthorized callers cannot change health');
  assert.equal(providerCalls,0,'unauthorized callers cannot reach issuer');
  const ok=await handler(req('Bearer '+secrets.wallet_recovery_secret));assert.equal(ok.status,200);
  assert.equal((await ok.json()).unresolved,0);assert.equal(health.ok,true);
  assert.equal(health.platformAccountId,'biz_CpeJbprflNa2ju');assert.equal(health.environment,'live');
  assert.ok(!JSON.stringify(health).includes('server-only'),'health never includes credentials');
  failedProvider=true;assert.equal((await handler(req('Bearer '+secrets.wallet_recovery_secret))).status,503);
  assert.equal(health.ok,false,'invalid provider credentials block checkout even with empty queues');failedProvider=false;
  failedQueue=true;assert.equal((await handler(req('Bearer '+secrets.wallet_recovery_secret))).status,503);
  assert.equal(health.ok,false,'failed worker invalidates checkout health');
  failedQueue=false;failedHealth=true;assert.equal((await handler(req('Bearer '+secrets.wallet_recovery_secret))).status,503,'heartbeat write failure cannot report healthy');
  console.log('Wallet recovery deployment bundle: compiles, authenticates, records health, fails closed and excludes secrets');
})().catch(error=>{console.error(error);process.exitCode=1;});
