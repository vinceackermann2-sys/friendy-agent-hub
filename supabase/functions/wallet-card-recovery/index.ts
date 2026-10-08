// Invoke every minute from Supabase Cron. This worker never receives card
// credentials and remains disabled until its server secrets are configured.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { createLegacyBelnaWallet } from '../../../src/lingon-server/belna-wallet.js';
import { createBelnaWalletStore } from '../../../src/lingon-server/belna-wallet-store.js';

async function equal(a:string,b:string) {
  const digest = (value:string) => crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  const [one,two] = await Promise.all([digest(a),digest(b)]);
  let mismatch=0;
  new Uint8Array(one).forEach((value,i)=>{ mismatch |= value ^ new Uint8Array(two)[i]; });
  return mismatch===0;
}
Deno.serve(async req => {
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  const url=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('Wallet recovery is not configured',{status:503});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:secret,error:secretError}=await db.rpc('get_server_secret',{p_name:'wallet_recovery_secret'});
  if(secretError || typeof secret!=='string' || secret.length<32)return new Response('Wallet recovery is not configured',{status:503});
  if(!(await equal(req.headers.get('authorization') || '','Bearer '+secret)))return new Response('Unauthorized',{status:401});
  const store={ ...createBelnaWalletStore({supa:()=>db,ensureProfile:async()=>{}}),supaConfigured:()=>true };
  // App and worker share the service-only connected-wallet configuration.
  const wallet=createLegacyBelnaWallet({store,env:{ WHOP_COMPANY_API_KEY:Deno.env.get('WHOP_COMPANY_API_KEY'),
    WHOP_SANDBOX:'false',WHOP_PLATFORM_ACCOUNT_ID:Deno.env.get('WHOP_PLATFORM_ACCOUNT_ID') }});
  let stage='provider';
  async function recordHealth(ok:boolean, providerStatus?:number) {
    const connection=await wallet.connectionInfo();
    const {error}=await db.rpc('put_server_secret',{p_name:'wallet_recovery_health',
      p_secret:JSON.stringify({ok,checkedAt:new Date().toISOString(),...connection,
        stage, ...(Number.isInteger(providerStatus) ? {providerStatus} : {})})});
    if(error)throw error;
  }
  try {
    // Validate live provider authentication even when there are no wallets or
    // cards to recover. Empty queues alone do not prove that the key works.
    await wallet.checkProviderConnection();
    stage='queue';
    const { data:events,error }=await db.rpc('claim_belna_wallet_webhook_events',{batch_size:5});
    if(error)throw error;
    const outcomes=await Promise.allSettled((events||[]).map(async event=>{
      await wallet.reconcilePurchaseCard(event.account_id,event.card_id);
      const {error:markError}=await db.from('belna_wallet_webhook_events')
        .update({processed_at:new Date().toISOString(),locked_until:null})
        .eq('id',event.id).is('processed_at',null);
      if(markError)throw markError;
    }));
    const failedEvents=outcomes.filter(x=>x.status==='rejected').length;
    stage='recovery';
    const [result,connections]=await Promise.all([
      wallet.reconcilePurchases(),wallet.reconcileConnectionCards()
    ]);
    const healthy = !result.unresolved && !connections.unresolved && !failedEvents;
    await recordHealth(healthy);
    return Response.json({ ...result,connectionsChecked:connections.checked,
      unresolvedConnections:connections.unresolved,eventsChecked:outcomes.length,failedEvents },
      {status:healthy ? 200 : 503});
  } catch (error) {
    await recordHealth(false,error?.providerStatus).catch(()=>{});
    return new Response('Wallet recovery needs attention',{status:503});
  }
});
