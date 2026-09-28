// Read-only production inspection plus an authenticated recovery run. Never
// creates an account, issues a card, sends money or submits a merchant order.
// Credentials are read from the server environment and never printed.
import 'dotenv/config';
import {createClient} from '@supabase/supabase-js';

const url=String(process.env.SUPABASE_URL||'').trim();
const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||'').trim();
try {
  if(!url || !key)throw Error('Server database credentials are unavailable');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const secret=await db.rpc('get_server_secret',{p_name:'wallet_recovery_secret'});
  if(secret.error || typeof secret.data!=='string' || secret.data.length<32)throw Error('Recovery authentication unavailable');
  const response=await fetch(url+'/functions/v1/wallet-card-recovery',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
    headers:{Authorization:'Bearer '+secret.data,'Content-Type':'application/json'},body:'{}'
  });
  const [healthResult,enabledResult,wallets,purchases,events]=await Promise.all([
    db.rpc('get_server_secret',{p_name:'wallet_recovery_health'}),
    db.rpc('get_server_secret',{p_name:'wallet_recovery_enabled'}),
    db.from('belna_wallets').select('user_id',{count:'exact',head:true}).eq('environment','live').not('account_id','is',null),
    db.from('belna_wallet_purchases').select('id',{count:'exact',head:true}).eq('environment','live').is('canceled_at',null),
    db.from('belna_wallet_webhook_events').select('id',{count:'exact',head:true}).is('processed_at',null)
  ]);
  let health;try{health=JSON.parse(healthResult.data);}catch{}
  const counts=result=>result.error?null:result.count;
  const report={recoveryHttpStatus:response.status,
    recoveryHealthy:!healthResult.error && health?.ok===true,
    checkedAt:typeof health?.checkedAt==='string'?health.checkedAt:null,
    stage:['provider','queue','recovery'].includes(health?.stage)?health.stage:null,
    providerHttpStatus:Number.isInteger(health?.providerStatus)?health.providerStatus:null,
    scheduleEnabled:!enabledResult.error && enabledResult.data==='true',
    connectedLiveWallets:counts(wallets),pendingLivePurchases:counts(purchases),pendingWebhookEvents:counts(events)};
  console.log(JSON.stringify(report,null,2));
  if(response.status!==200 || !report.recoveryHealthy)process.exitCode=1;
} catch {
  console.error('Wallet production inspection failed. Check server configuration and recovery deployment. No credentials were printed.');
  process.exitCode=1;
}
