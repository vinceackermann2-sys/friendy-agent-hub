import {createWhopUserAuth} from './whop-user-auth.js';
import {createWalletPurchases} from './wallet-purchases.js';
function createPersonalWallet({store,env=process.env,fetchImpl=(...a)=>fetch(...a),secureCheckout,legacy}) {
  env={...env};
  let configuration;
  async function loadConfiguration(){
    if(configuration)return configuration;
    configuration=(async()=>{
      if(!store.getPersonalWalletConfiguration)return;
      const saved=await store.getPersonalWalletConfiguration();
      if(!saved)return;
      for(const key of ['WHOP_OAUTH_CLIENT_ID','WHOP_OAUTH_REDIRECT_URI','WHOP_OAUTH_SCOPES','WHOP_WALLET_ENCRYPTION_KEY'])if(typeof saved[key]==='string' && saved[key].trim())env[key]=saved[key].trim();
    })();
    try{await configuration;}catch(e){configuration=null;throw e;}
  }
  const auth=createWhopUserAuth({store,env,fetchImpl});
  const setting=n=>String(env[n]||'').trim();
  const environment=()=>setting('WHOP_SANDBOX')==='false'?'live':'sandbox';
  const fail=(message,code='BAD_INPUT')=>Object.assign(new Error(message),{code});
  const personal=id=>/^user_[A-Za-z0-9]+$/.test(id||'');
  const configured=()=>auth.configured();
  const cardProgramAvailable=()=>setting('WHOP_PERSONAL_CARD_APPLICATIONS_ENABLED')==='true';
  const checkoutAvailable=async()=>environment()==='live' && setting('WHOP_PERSONAL_CARD_ISSUING_ENABLED')==='true' && typeof secureCheckout==='function' &&
    await store.walletRecoveryReady(setting('WHOP_PLATFORM_ACCOUNT_ID'),environment(),'personal') && (!secureCheckout.available || await secureCheckout.available());
  async function owned(userId){
    const row=await store.getBelnaWallet(userId);
    if(!row || row.user_id!==userId || row.wallet_kind!=='personal' || !personal(row.account_id) || row.owner_provider_id!==row.account_id || row.environment!==environment())throw fail('Connect your personal Whop wallet first.','RECONNECT');
    return row;
  }
  async function request(path,{userId,ownerId,method='GET',body,key}={}){
    const row=await owned(userId);
    if(ownerId && ownerId!==row.account_id)throw fail('This payment belongs to a different wallet.','PROVIDER');
    const credentials=await auth.credentials(userId);
    if(credentials.userId!==row.account_id)throw fail('Your personal wallet owner could not be confirmed.','PROVIDER');
    // Caller IDs are server-derived, never supplied by an owner/model API.
    const query=new URL(path,'https://api.whop.com');
    if(query.searchParams.has('account_id') || body?.account_id || body?.assigned_user_id || query.searchParams.get('user_id') && query.searchParams.get('user_id')!==row.account_id || body?.user_id && body.user_id!==row.account_id || body?.origin_id && body.origin_id!==row.account_id || body?.destination && body.destination!==row.account_id)throw fail('Your personal wallet request could not be confirmed.','PROVIDER');
    let res;try{res=await fetchImpl((environment()==='live'?'https://api.whop.com':'https://sandbox-api.whop.com')+'/api/v1'+path,{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+credentials.token,'Content-Type':'application/json','Api-Version-Date':'2026-09-29',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw fail('Your personal wallet could not be reached. Try again.','PROVIDER');}
    const data=await res.json().catch(()=>null);
    if(!res.ok){
      const message=String(data?.error?.message||'').toLowerCase();
      if(res.status===400 && method==='GET' && path.startsWith('/cards?') && /^no rain account found\b/.test(message))return {data:[]};
      const unsupportedCard=path==='/cards' && method==='POST' && res.status===400 && message.includes('card applications are only supported for accounts, not user wallets');
      const error=fail(unsupportedCard?'Whop does not currently support issuing cards from personal user wallets.':res.status===401?'Reconnect your personal Whop wallet.':res.status===403?'Whop has not granted this wallet permission. Reconnect your personal wallet or ask Belna to finish its OAuth setup.':/verification|identity/.test(message)?'Complete the personal identity check to continue.':/application|approved/.test(message)?'The card issuer has not approved your personal card application yet.':'Your personal wallet request could not be completed. Try again.',unsupportedCard?'PERSONAL_CARDS_UNSUPPORTED':res.status===401?'RECONNECT':'PROVIDER');
      error.providerStatus=res.status;throw error;
    }
    if(!data || typeof data!=='object')throw fail('Your personal wallet returned an incomplete response.','PROVIDER');
    return data;
  }
  async function getAccount(userId){const row=await owned(userId),me=await request('/users/me?include_balance=true',{userId});if(me.id!==row.account_id)throw fail('Your personal balance owner could not be confirmed.','PROVIDER');return me;}
  function balanceView(me){
    const cash=me.balance?.cash?.find(x=>String(x.currency).toLowerCase()==='usd');
    const amount=x=>x==null || !Number.isFinite(Number(x))?null:Number(x);
    // Company and crypto totals in the user profile are not personal USD.
    const emptyCash=Array.isArray(me.balance?.cash) && me.balance.cash.length===0 && amount(me.balance.cash_usd)===0;
    return {currency:'USD',available:emptyCash?0:amount(cash?.total_withdrawable_balance),pending:emptyCash && amount(me.balance.pending_usd)===0?0:amount(cash?.pending_balance_usd)};
  }
  const cardName=row=>'Belna personal card '+row.setup_key;
  async function cardFor(userId){const row=await owned(userId),cards=await request('/cards?user_id='+row.account_id,{userId});return (cards.data||[]).find(c=>c.user_id===row.account_id && c.type==='virtual' && (row.card_id?c.id===row.card_id:c.name===cardName(row))) || null;}
  const cardReady=async userId=>(await cardFor(userId))?.status==='active';
  async function activity(userId){
    const row=await owned(userId),feed=await request('/financial_activity?user_id='+row.account_id+'&include_owned_accounts=false&include_resource=false&exclude_internal_movements=true&limit=20',{userId});
    if(!Array.isArray(feed.data))throw fail('Your wallet activity could not be loaded.','PROVIDER');
    return feed.data.filter(x=>String(x.currency?.code||x.currency).toLowerCase()==='usd' && x.usd_amount!=null && Number.isFinite(Number(x.usd_amount))).map(x=>{
      const type=String(x.line_type||'');
      const title=/refund/.test(type)?'Refund':/fee/.test(type)?'Payment fee':/card_spend/.test(type)?'Purchase':/deposit|topup|bank_transfer|treasury_payin/.test(type)?'Deposit':/transfer.*outgoing/.test(type)?'Sent money':/transfer.*incoming/.test(type)?'Received money':/withdrawal/.test(type)?'Withdrawal':/payment_gross|earning|reward|cashback/.test(type)?'Payment received':'Balance activity';
      return {id:x.id,title,amount:Number(x.usd_amount),currency:'USD',at:x.posted_at,status:'recorded'};
    });
  }
  async function nextCardKey(previous){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('belna:personal-card-next:'+previous))),b=>b.toString(16).padStart(2,'0')).join('');}
  async function snapshot(userId){
    const row=await store.getBelnaWallet(userId);
    const empty=status=>({wallet:{kind:'personal',configured:configured(),status,legacyWallet:!!(row?.legacy_account_id || row?.account_id?.startsWith('biz_')),cardProgramAvailable:cardProgramAvailable(),card:null,balance:null},transactions:[]});
    if(row && row.wallet_kind!=='personal')return empty('personal_connection_required');
    if(!row?.account_id)return empty(configured()?'not_created':'unavailable');
    let me,card;
    try{[me,card]=await Promise.all([getAccount(userId),cardFor(userId)]);}catch(e){if(e.code==='RECONNECT')return empty('personal_connection_required');throw e;}
    if(card){await store.saveBelnaWallet(userId,{card_id:card.id,card_last4:/^\d{4}$/.test(card.last4||'')?card.last4:null,...(row.card_status==='frozen'?{}:{card_status:card.status}),...(card.status==='active'?{application_status:'approved'}:{})});}
    const ready=card?.status==='active' || card?.status==='frozen';
    const verification=me.verification?.individual?.status || 'not_started';
    const application=row.application_status || null;
    const status=ready?'ready':['denied','locked','canceled'].includes(application)?'denied':['needs_verification','needs_information','card_invitation'].includes(application)?'card_action_required':application?'review':verification==='approved'?'card_required':'verification_required';
    let movements=[],activityError=null;try{movements=await activity(userId);}catch{activityError='Wallet activity is temporarily unavailable. Check again shortly.';}
    return {activity:movements,activityError,wallet:{kind:'personal',configured:configured(),status,legacyWallet:!!row.legacy_account_id,verificationStatus:verification,identityVerified:verification==='approved',cardApplicationStatus:application,cardProgramAvailable:ready || application!=='unsupported_personal_wallet' && cardProgramAvailable(),cardReady:ready,
      sandbox:environment()==='sandbox',withdrawalsAvailable:setting('WHOP_WITHDRAWALS_ENABLED')==='true',dailyCardLimitUsd:Number(row.daily_card_limit),paused:row.card_status==='frozen' || card?.status==='frozen',country:row.country,
      card:card?{last4:/^\d{4}$/.test(card.last4||'')?card.last4:null,status:card.status,dailyLimitUsd:Number(row.daily_card_limit)}:null,balance:balanceView(me),agentCardPayments:card?.status==='active' && row.card_status!=='frozen' && await checkoutAvailable()},
      purchases:(await store.listWalletPurchases(userId)).filter(x=>x.account_id===row.account_id).map(purchases.view),transactions:[],
      transfers:(await store.listBelnaWalletTransfers(userId)).filter(x=>x.origin_id===row.account_id).map(x=>({quoteId:x.id,recipient:x.recipient_email,amount:Number(x.amount),currency:'USD',status:x.status,at:x.created_at}))};
  }
  async function setup(user,input){return auth.start(user,input);}
  async function finishConnect(user,input){await auth.finish(user,input);return snapshot(user.id);}
  function hostedUrl(value){try{const u=new URL(value);if(u.protocol==='https:' && !u.username && !u.password && !u.port && (u.hostname==='whop.com' || u.hostname.endsWith('.whop.com') || u.hostname==='sumsub.com' || u.hostname.endsWith('.sumsub.com') || u.hostname==='verify.raincards.xyz'))return u.href;}catch{}throw fail('Your private verification link could not be confirmed.','PROVIDER');}
  async function verify(userId){const row=await owned(userId),me=await getAccount(userId);if(me.verification?.individual?.status==='approved')return snapshot(userId);const result=await request('/verifications?user_id='+row.account_id,{userId,method:'POST',body:{kind:'individual'}});return result.status==='approved'?snapshot(userId):{url:hostedUrl(result.session_url)};}
  async function connectCard(userId){
    if(!cardProgramAvailable())throw fail('Personal card issuing is not available yet.','NOT_SET_UP');
    const row=await owned(userId),existing=await cardFor(userId);
    if(existing || row.application_status==='card_provisioning')return snapshot(userId);
    if(row.application_status==='unsupported_personal_wallet')return snapshot(userId);
    if(['denied','locked','canceled'].includes(row.application_status))return snapshot(userId);
    let result;
    try{result=await request('/cards',{userId,method:'POST',key:row.card_request_key,body:{user_id:row.account_id,name:cardName(row),spend_limit:Number(row.daily_card_limit),spend_limit_frequency:'daily'}});}
    catch(error){
      if(error.code==='PERSONAL_CARDS_UNSUPPORTED'){
        await store.saveBelnaWallet(userId,{application_status:'unsupported_personal_wallet'});
        return snapshot(userId);
      }
      // A confirmed refusal issued no card; a later approved application must
      // not replay that refusal forever. Transport/5xx retries keep the key.
      if(error.providerStatus>=400 && error.providerStatus<500)await store.saveBelnaWallet(userId,{card_request_key:await nextCardKey(row.card_request_key)});
      throw error;
    }
    if(result.object==='card'){
      if(!/^icrd_[A-Za-z0-9]+$/.test(result.id||'') || result.user_id!==row.account_id || result.type!=='virtual' || Number(result.limit?.amount)!==Number(row.daily_card_limit) || result.limit?.frequency!=='daily')throw fail('Your personal card owner or limit could not be confirmed.','PROVIDER');
      await store.saveBelnaWallet(userId,{card_id:result.id,card_last4:/^\d{4}$/.test(result.last4||'')?result.last4:null,card_status:result.status,application_status:result.status==='active'?'approved':result.status==='denied'?'denied':'card_invitation'});
    }else if(['card_application','card_invitation','card_provisioning'].includes(result.object)){
      const status=result.object==='card_application' && ['approved','pending','manual_review','needs_verification','needs_information','denied','locked','canceled'].includes(result.status)?result.status:result.object;
      // Rotate only after a confirmed 202. A lost response retries the same
      // key; a later approval must not replay yesterday's application response.
      await store.saveBelnaWallet(userId,{application_status:status,...(result.object==='card_application'?{card_request_key:await nextCardKey(row.card_request_key)}:{})});
      if(result.hosted_url)return {url:hostedUrl(result.hosted_url)};
    }else throw fail('Whop returned an unknown card setup state. Check again shortly.','PROVIDER');
    return snapshot(userId);
  }
  async function elementSession(userId,kind){
    const row=await owned(userId);
    if(kind==='withdraw' && setting('WHOP_WITHDRAWALS_ENABLED')!=='true')throw fail('Withdrawals are not available yet.','NOT_SET_UP');
    const scoped_actions=kind==='card'?['payout:account:read','identity:write']:kind==='withdraw'?['payout:withdraw_funds','payout:destination:read','payout:create_destination']:['payout:account:read','payout:account:update','identity:write'];
    const expiresAt=new Date(Date.now()+15*60000).toISOString();
    // OAuth derives the caller; do not mint a company impersonation token.
    const result=await request('/access_tokens',{userId,method:'POST',body:{expires_at:expiresAt,scoped_actions}});
    const expires=Date.parse(result.expires_at);
    if(typeof result.token!=='string' || result.token.length<32 || !Number.isFinite(expires) || expires<=Date.now() || expires>Date.parse(expiresAt)+1000)throw fail('Your private wallet session could not be started.','PROVIDER');
    return {accountId:row.account_id,accessToken:result.token,expiresAt:result.expires_at,...(kind==='card' && row.card_id?{cardId:row.card_id}:{}),...(kind==='withdraw'?{availableBalance:balanceView(await getAccount(userId)).available,payoutCountry:row.country}:{})};
  }
  const limit=amount=>{if(typeof amount!=='number' || !Number.isFinite(amount) || amount<1 || amount>2000 || Math.abs(amount*100-Math.round(amount*100))>1e-8)throw fail('Choose an amount between $1 and $2,000, with at most two decimals.');return amount;};
  async function updateCard(userId,input){const row=await owned(userId),fields={};
    if(input.frozen!=null){if(typeof input.frozen!=='boolean')throw fail('Choose a valid card state.');fields.card_status=input.frozen?'frozen':'active';}
    if(input.dailyLimitUsd!=null)fields.daily_card_limit=limit(input.dailyLimitUsd);
    if(fields.card_status==='frozen')await store.saveBelnaWallet(userId,fields);
    if(row.card_id){const result=await request('/cards/'+row.card_id,{userId,method:'PATCH',body:{user_id:row.account_id,...(input.frozen!=null?{frozen:input.frozen}:{}),...(input.dailyLimitUsd!=null?{spend_limit:fields.daily_card_limit,spend_limit_frequency:'daily'}:{})}});if(result.id!==row.card_id || result.user_id!==row.account_id || input.dailyLimitUsd!=null && (Number(result.limit?.amount)!==fields.daily_card_limit || result.limit?.frequency!=='daily') || input.frozen!=null && result.status!==(input.frozen?'frozen':'active'))throw fail('Your card controls could not be confirmed.','PROVIDER');}
    await store.saveBelnaWallet(userId,fields);if(input.frozen)await purchases.cancelOwner(userId);return snapshot(userId);
  }
  const publicQuote=q=>({quoteId:q.id,recipient:q.recipient_email,amount:Number(q.amount),currency:'USD',fees:'Payment partner fees may apply in addition to this amount.'});
  async function transferQuote(userId,{recipient,amount,paymentRequestId}={}){
    const row=await owned(userId);amount=limit(amount);
    let payment,previous;
    if(paymentRequestId){payment=await store.getWalletPaymentRequest(paymentRequestId);if(!payment || payment.environment!==environment() || Date.parse(payment.created_at)<Date.now()-7*86400000)throw fail('This payment request expired. Ask for a new link.');const target=await store.getBelnaWallet(payment.user_id);if(!target || target.account_id!==payment.destination_id || target.wallet_kind!=='personal')throw fail('The recipient’s personal wallet is no longer connected.');recipient=target.owner_email;amount=Number(payment.amount);previous=await store.getWalletTransferByRequest(paymentRequestId);if(previous){if(previous.user_id!==userId)throw fail('This payment request has already been reviewed by another payer.');return publicQuote(previous);}}
    if(amount>50)throw fail('Transfers are limited to $50 in 24 hours.');
    recipient=String(recipient||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))throw fail('Enter the recipient’s Belna email.');
    const target=await store.findBelnaWalletRecipient(recipient);
    if(target?.wallet_kind!=='personal' || !personal(target.account_id) || target.environment!==environment() || target.user_id===userId || target.account_id===row.account_id)throw fail('The recipient needs their own personal Belna Wallet.');
    if(payment && payment.destination_id!==target.account_id)throw fail('The recipient’s wallet changed. Ask for a new link.');
    const available=balanceView(await getAccount(userId)).available;if(available==null || available<amount)throw fail('Your personal dollar balance is too low for this transfer.');
    const quote=await store.addBelnaWalletQuote(userId,{id:crypto.randomUUID(),origin_id:row.account_id,destination_id:target.account_id,recipient_email:recipient,amount,...(payment?{payment_request_id:paymentRequestId}:{})});return publicQuote(quote);
  }
  async function send(userId,{quoteId,approvedDetail}){
    const row=await owned(userId),quote=await store.getBelnaWalletQuote(userId,quoteId);
    if(!quote || quote.origin_id!==row.account_id || !personal(quote.destination_id) || quote.destination_id===row.account_id || approvedDetail!==JSON.stringify(publicQuote(quote)))throw fail('Review and approve this exact personal-wallet transfer first.');
    const reserved=await store.beginBelnaWalletTransfer(userId,quoteId);
    if(['succeeded','failed'].includes(reserved.status))return {...publicQuote(quote),status:reserved.status};
    const result=reserved.provider_id?await request('/transfers/'+reserved.provider_id,{userId}):await request('/transfers',{userId,method:'POST',key:quoteId,body:{type:'ledger',origin_id:row.account_id,destination_id:quote.destination_id,currency:'usd',amount:Number(quote.amount),idempotence_key:quoteId}});
    if(result.object!=='transfer' || result.origin?.id!==row.account_id || result.destination?.id!==quote.destination_id || result.currency!=='usd' || Number(result.amount)!==Number(quote.amount) || !/^ctt_[A-Za-z0-9]+$/.test(result.id||'') || !['processing','succeeded','failed'].includes(result.status))throw fail('Your transfer is awaiting confirmation. Check this same transfer again.','PROVIDER');
    await store.saveBelnaWalletTransfer(userId,quoteId,{provider_id:result.id,status:result.status});return {...publicQuote(quote),status:result.status};
  }
  async function confirmTransfer(userId,{quoteId,confirm}){if(confirm!==true)throw fail('Review and confirm this transfer.');const q=await store.getBelnaWalletQuote(userId,quoteId);if(!q)throw fail('Transfer not found.');return send(userId,{quoteId,approvedDetail:JSON.stringify(publicQuote(q))});}
  async function receive(userId,{amount,title,requestKey}){const row=await owned(userId);amount=limit(amount);if(amount>50)throw fail('Personal payment requests are limited to $50.');title=String(title||'').trim();if(!title || title.length>120 || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey||''))throw fail('Describe your payment and try again.');const saved=await store.saveWalletPaymentRequest(userId,{id:requestKey,destination_id:row.account_id,environment:environment(),amount,title});if(saved.destination_id!==row.account_id || Number(saved.amount)!==amount || saved.title!==title)throw fail('Create a new payment request for the changed details.');const url=new URL(auth.redirectUri());url.searchParams.set('wallet_request',saved.id);return {url:url.href,amount,currency:'USD',title};}
  async function paymentRequest(userId,id){if(!/^[a-zA-Z0-9_-]{16,100}$/.test(id||''))throw fail('Payment request not found.');const p=await store.getWalletPaymentRequest(id),recipient=p?await store.getBelnaWallet(p.user_id):null;if(!p || p.environment!==environment() || Date.parse(p.created_at)<Date.now()-7*86400000 || recipient?.account_id!==p.destination_id || recipient.wallet_kind!=='personal')throw fail('Payment request not found or expired.');return {requestId:p.id,title:p.title,amount:Number(p.amount),currency:'USD',recipient:recipient.owner_email};}
  const purchaseStore={...store,listPendingWalletPurchases:async env=>(await store.listPendingWalletPurchases(env)).filter(p=>personal(p.account_id))};
  const purchases=createWalletPurchases({store:purchaseStore,request,owned,balanceView,environment,secureCheckout,getAccount,cardReady});
  const methods={snapshot,setup,finishConnect,verify,connectCard,updateCard,
    cardSession:userId=>elementSession(userId,'card'),withdrawalSession:userId=>elementSession(userId,'withdraw'),deposit:userId=>elementSession(userId,'deposit'),
    receive,paymentRequest,transferQuote,send,confirmTransfer,
    executePurchase:async(...args)=>{if(!await checkoutAvailable())throw fail('Secure personal card checkout is not available yet.','NOT_SET_UP');return purchases.execute(...args);},
    reconcilePersonalPurchases:purchases.reconcile,reconcilePersonalPurchaseCard:purchases.reconcileCard};
  return {...legacy,configured,...Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,async(...args)=>{await loadConfiguration();return method(...args);}]))};
}
export {createPersonalWallet};
