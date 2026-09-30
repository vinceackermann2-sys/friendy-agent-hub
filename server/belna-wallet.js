// Belna's owner-scoped Whop adapter. No provider response is returned wholesale.
// Owner/model APIs never return card credentials. The isolated purchase service
// can use them transiently; they are never persisted or given to the model.
const { createWalletPurchases } = require('./wallet-purchases');
function createBusinessWallet({ store, fetchImpl = (...args) => fetch(...args), env = process.env, secureCheckout, randomId = () => crypto.randomUUID() }) {
  env = {...env};
  let configuration;
  async function loadConfiguration() {
    if (!configuration) configuration = (async () => {
      const saved = await store.getConnectedWalletConfiguration?.();
      if (!saved) return;
      for (const name of ['WHOP_COMPANY_API_KEY','WHOP_PLATFORM_ACCOUNT_ID','WHOP_SANDBOX','WHOP_CARD_APPLICATIONS_ENABLED','WHOP_CARD_ISSUING_ENABLED','WHOP_WITHDRAWALS_ENABLED']) {
        if (typeof saved[name] === 'string') env[name] = saved[name].trim();
      }
    })();
    try { await configuration; } catch (error) { configuration = null; throw error; }
  }
  const setting = (name) => String(env[name] || '').trim();
  const environment = () => setting('WHOP_SANDBOX') === 'false' ? 'live' : 'sandbox';
  const platformAccountId = () => setting('WHOP_PLATFORM_ACCOUNT_ID');
  const configured = () => !!setting('WHOP_COMPANY_API_KEY') && /^biz_[A-Za-z0-9]+$/.test(platformAccountId()) && store.supaConfigured();
  const cardProgramAvailable = () => setting('WHOP_CARD_APPLICATIONS_ENABLED') === 'true' || setting('WHOP_CARD_ISSUING_ENABLED') === 'true';
  const withdrawalsAvailable = () => setting('WHOP_WITHDRAWALS_ENABLED') === 'true';
  const checkoutAvailable = async () => setting('WHOP_CARD_ISSUING_ENABLED') === 'true' && environment() === 'live' &&
    typeof secureCheckout === 'function' && typeof store.walletRecoveryReady === 'function' &&
    await store.walletRecoveryReady(platformAccountId(),environment()) &&
    (typeof secureCheckout.available!=='function' || await secureCheckout.available());
  const fail = (message, code = 'BAD_INPUT') => Object.assign(new Error(message), { code });
  async function request(path, { method='GET', body, key } = {}) {
    await loadConfiguration();
    if (!configured()) throw fail('Belna Wallet is not available yet.', 'NOT_SET_UP');
    const base = environment() === 'sandbox' ? 'https://sandbox-api.whop.com/api/v1' : 'https://api.whop.com/api/v1';
    let response;
    try {
      response = await fetchImpl(base + path, { method, redirect:'manual', signal:AbortSignal.timeout(20000),
        headers:{ Authorization:'Bearer ' + setting('WHOP_COMPANY_API_KEY'), 'Api-Version-Date':'2026-09-25', 'Content-Type':'application/json', ...(key ? { 'Idempotency-Key':key } : {}) },
        ...(body ? { body:JSON.stringify(body) } : {}) });
    } catch (error) {
      console.error('belna-wallet-provider-transport', {
        name: String(error?.name || '').slice(0, 40),
        causeCode: String(error?.cause?.code || '').slice(0, 40),
        message: String(error?.message || '').replaceAll(setting('WHOP_COMPANY_API_KEY'), '[redacted]').slice(0, 160),
      });
      throw fail('Your wallet could not be reached. Please try again.', 'PROVIDER');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      // Provider errors may contain account details; only classified, friendly copy leaves here.
      const message = String(data?.error?.message || '').toLowerCase();
      const rejected = (safeMessage, code='PROVIDER') => Object.assign(fail(safeMessage,code),{
        providerStatus:response.status,
        idempotentReplayed:response.headers?.get?.('Idempotent-Replayed') === 'true',
        cardNotApproved:method==='POST' && path==='/cards' && [400,409].includes(response.status) && /rain account is not approved|card application.*not approved/.test(message),
      });
      // Whop returns 400 before an owner has an issuer account. This specific
      // provider error on the card list means no cards exist yet.
      // Keep every other provider failure blocking recovery.
      if (response.status===400 && method==='GET' && path.startsWith('/cards?') && /^no rain account found\b/.test(message)) return {data:[]};
      const cardError=path==='/cards' && method==='POST';
      const providerCode=String(data?.error?.code || '');
      console.error('belna-wallet-provider-rejection', { status:response.status,
        reason:/no rain account found/.test(message)?'NO_CARD_ACCOUNT':/rain account is not approved|card.*not approved|application.*not approved/.test(message)?'CARD_NOT_APPROVED':/identity|verification/.test(message)?'IDENTITY_REQUIRED':/not authorized|permission/.test(message)?'PERMISSION':cardError && /idempotency|idempotent/.test(message)?'IDEMPOTENCY':cardError && /spend.limit|transaction.limit/.test(message)?'CARD_LIMIT':cardError && /assigned.user|user.id/.test(message)?'CARD_OWNER':'OTHER',
        ...(cardError ? {providerCode:/^[a-z0-9_.-]{1,64}$/i.test(providerCode)?providerCode:null} : {}) });
      if(response.status===403 && path==='/checkout_configurations')throw fail('Payment links need additional Whop permissions. Ask the app owner to finish connecting checkout links.','NOT_SET_UP');
      if (/verification|identity/.test(message)) throw rejected('Complete your identity check before creating your card.', 'VERIFY');
      if (/application|approved/.test(message)) throw rejected('The card issuer has not approved card issuing for this wallet.', 'REVIEW');
      throw rejected('Your wallet request could not be completed. Please try again.');
    }
    if (!data || typeof data !== 'object') throw fail('Your wallet returned an incomplete response. Please try again.', 'PROVIDER');
    return data;
  }
  async function record(userId) {
    await loadConfiguration();
    if (typeof userId !== 'string' || !userId) throw fail('Sign in to use your wallet.');
    const row = await store.getBelnaWallet(userId);
    // The server key manages children of the platform account. It is never
    // an owner's funding source, even if a stored mapping is misconfigured.
    if (row && (row.user_id !== userId || row.account_id &&
        (!/^biz_[A-Za-z0-9]+$/.test(row.account_id) || row.account_id === platformAccountId() || !/^user_[A-Za-z0-9]+$/.test(row.owner_provider_id || ''))))
      throw fail('Your wallet connection could not be confirmed.', 'PROVIDER');
    if (row && row.environment !== environment()) throw fail('Your wallet is unavailable in this environment.', 'NOT_SET_UP');
    return row;
  }
  const cardView = (row) => row.card_id ? { last4:/^\d{4}$/.test(row.card_last4 || '') ? row.card_last4 : null, status:row.card_status || 'pending', dailyLimitUsd:Number(row.daily_card_limit) } : null;
  function balanceView(account) {
    // Do not present crypto holdings or another currency as dollars.
    const usd = (account.balances || []).find(x => x.symbol === 'USD');
    const amount = (value) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    return { currency:'USD', available:amount(usd?.breakdown?.available), pending:amount(usd?.breakdown?.pending) };
  }
  function identityVerification(account) {
    // KYC and issuer approval are independent. Read the individual profile,
    // never infer successful verification from a card application or balance.
    // The account includes a status-only summary under the existing account
    // read scope. GET /verifications requires access to private identity data.
    const profile = account.verification?.individual;
    const status = ['approved','pending','manual_review','rejected','action_required','not_started'].includes(profile?.status) ? profile.status : 'not_started';
    return { status };
  }
  function cardApplicationStatus(account, row) {
    const saved = String(row.application_status || '').replace(/^connection_application_/, '');
    const status = account.cards?.status || saved;
    return ['approved','pending','manual_review','denied','locked','canceled','needs_verification','needs_information'].includes(status) ? status : null;
  }
  async function snapshot(userId) {
    await loadConfiguration();
    if (!configured()) return { wallet:{ configured:false, status:'unavailable', cardProgramAvailable:false, card:null, balance:null }, transactions:[] };
    const row = await record(userId);
    if (!row?.account_id) {
      // Check the live server key before offering setup. Merely having an
      // environment value is not evidence that the provider accepts it.
      await checkProviderConnection();
      return { wallet:{ kind:'connected', configured:true, status:row ? 'setup_pending' : 'not_created', cardProgramAvailable:cardProgramAvailable(), card:null, balance:null }, transactions:[] };
    }
    const account = await request('/accounts/' + encodeURIComponent(row.account_id));
    if (account.parent_account?.id !== platformAccountId()) throw fail('Your wallet account does not belong to this Belna connection.', 'PROVIDER');
    const verification = identityVerification(account);
    if(String(row.application_status||'').startsWith('connection_')){
      const connectionCards=await request('/cards?account_id='+encodeURIComponent(row.account_id));
      for(const card of connectionCards.data || []){
        if(card.name==='Belna card connection' && card.user_id===row.owner_provider_id && card.status!=='canceled'){
          const closed=await request('/cards/'+encodeURIComponent(card.id),{method:'PATCH',body:{account_id:row.account_id,canceled:true}});
          if(closed.id!==card.id || closed.status!=='canceled')throw fail('Card connection is pending. Refresh to check it safely.','PROVIDER');
        }
      }
    }
    // Only list cards: GET /cards/:id exposes live credentials and is deliberately unused.
    if (row.card_id || ['card_provisioning','card_invitation'].includes(row.application_status)) {
      const cards = await request('/cards?account_id=' + encodeURIComponent(row.account_id));
      const card = (cards.data || []).find(x => x.user_id === row.owner_provider_id && (row.card_id ? x.id === row.card_id : x.name === 'Belna agent card'));
      if (card) { row.card_id=card.id; row.card_status = card.status; row.card_last4 = card.last4; await store.saveBelnaWallet(userId, { card_id:card.id, card_status:card.status, card_last4:card.last4 }); }
    }
    const application = cardApplicationStatus(account,row);
    const status = account.capabilities?.card_issuing === 'active' ? 'ready'
      : ['denied','locked','canceled'].includes(application) ? 'denied'
      : ['needs_verification','needs_information'].includes(application) ? 'card_action_required'
      : application ? 'review'
      : row.application_status === 'connection_refused' ? 'card_unavailable'
      : verification.status === 'approved' ? 'card_required' : 'verification_required';
    const transactions = row.card_id ? await request('/card_transactions?account_id=' + encodeURIComponent(row.account_id) + '&card_id=' + encodeURIComponent(row.card_id) + '&first=5') : { data:[] };
    const feed=await request('/financial_activity?account_id='+encodeURIComponent(row.account_id)+'&include_resource=false&exclude_internal_movements=true');
    const activity=(feed.data || []).filter(x=>String(x.currency?.code).toLowerCase()==='usd' && x.usd_amount!=null && Number.isFinite(Number(x.usd_amount))).slice(0,20).map(x=>{
      const type=String(x.line_type||'');
      const title=/refund/.test(type)?'Refund':/fee/.test(type)?'Payment fee':/card_spend/.test(type)?'Purchase':/deposit|topup|bank_transfer|treasury_payin/.test(type)?'Deposit':/transfer.*outgoing/.test(type)?'Sent money':/transfer.*incoming/.test(type)?'Received money':/withdrawal/.test(type)?'Withdrawal':/payment_gross|earning|reward|cashback/.test(type)?'Payment received':'Balance activity';
      const rawStatus=String(x.source?.status || '');
      const status=/pending|processing|review|requested|authorized/.test(rawStatus)?'pending':/failed|denied/.test(rawStatus)?'failed':/cancel|void|revers/.test(rawStatus)?'canceled':x.available_at && Date.parse(x.available_at)>Date.now()?'pending':'recorded';
      return {title,amount:Number(x.usd_amount),currency:'USD',status,at:x.posted_at || null};
    });
    return { activity, wallet:{ kind:'connected', configured:true, status, cardApplicationStatus:application, verificationStatus:verification.status, identityVerified:verification.status === 'approved', withdrawalsAvailable:withdrawalsAvailable(), cardReady:account.capabilities?.card_issuing === 'active', cardProgramAvailable:cardProgramAvailable(), sandbox:environment() === 'sandbox', card:cardView(row), balance:balanceView(account), dailyCardLimitUsd:Number(row.daily_card_limit),
      // Pausing works before a purchase card exists, so it is reported from the owner's record.
      paused:row.card_status==='frozen', country:/^[A-Z]{2}$/.test(row.country || '') ? row.country : null,
      // A secure merchant payment bridge must be integrated before agent card spending is enabled.
      agentCardPayments:status === 'ready' && row.card_status !== 'frozen' && await checkoutAvailable() },
      purchases:store.listWalletPurchases ? (await store.listWalletPurchases(userId)).map(purchases.view) : [],
      transfers:(await store.listBelnaWalletTransfers(userId)).map(x => ({ quoteId:x.id, recipient:x.recipient_email, amount:Number(x.amount), currency:'USD', status:x.status, at:x.created_at })),
      transactions:(transactions.data || []).slice(0,5).map(x => ({ title:String(x.merchant_name || 'Card payment'), amount:Number.isFinite(Number(x.usd_amount)) ? Number(x.usd_amount) : null, currency:'USD', status:String(x.status || 'pending'), at:x.created_at || null })) };
  }
  async function setup(user, { country, dailyLimitUsd=50 } = {}) {
    await loadConfiguration();
    country = String(country || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw fail('Enter your two-letter country code, for example SE or US.');
    if (!user?.id || !user.email) throw fail('Sign in with an email address to create your wallet.');
    // The email is the wallet's address for money sent to it, so it must be one the owner proved.
    if (!user.email_confirmed_at) throw fail('Confirm your email address before creating your wallet.');
    const limit = validateLimit(dailyLimitUsd);
    if (!configured()) throw fail('Belna Wallet is not available yet.', 'NOT_SET_UP');
    let row = await record(user.id);
    if (!row) row = await store.claimBelnaWallet(user.id, { country, owner_email:user.email.toLowerCase(), environment:environment(), setup_key:randomId(), card_request_key:randomId(), daily_card_limit:limit, wallet_kind:'business' });
    if (!row.account_id) {
      const account = await request('/accounts', { method:'POST', key:row.setup_key,
        body:{ email:user.email, country:row.country, title:'Belna Wallet ' + row.setup_key.slice(0,8), send_customer_emails:false, metadata:{ external_id:user.id } } });
      if (!/^biz_[a-zA-Z0-9]+$/.test(account.id || '') || account.id === platformAccountId() || !/^user_[a-zA-Z0-9]+$/.test(account.owner?.id || '') || account.parent_account?.id !== platformAccountId())
        throw fail('Your wallet setup could not be confirmed for Belna. Please try again.', 'PROVIDER');
      row = await store.saveBelnaWallet(user.id, { account_id:account.id, owner_provider_id:account.owner.id });
    }
    const result=await snapshot(user.id);
    if(!result.wallet || ['unavailable','not_created','setup_pending','personal_connection_required'].includes(result.wallet.status))throw fail('Your connected wallet setup could not be confirmed. Please try again.','WALLET_STORE');
    return result;
  }
  function validateLimit(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 2000 || Math.abs(Math.round(value * 100) - value * 100) > 1e-8) throw fail('Choose an amount between $1 and $2,000, with at most two decimals.');
    return value;
  }
  async function owned(userId) {
    const row = await record(userId);
    if (!row?.account_id) throw fail('Create your Belna Wallet first.');
    return row;
  }
  async function checkProviderConnection() {
    await loadConfiguration();
    const account = await request('/accounts/' + encodeURIComponent(platformAccountId()));
    if (account.id !== platformAccountId()) throw fail('Your wallet provider connection could not be confirmed.', 'PROVIDER');
    return {ok:true};
  }
  async function legacySnapshot(userId){
    const row=await record(userId);
    if(!row?.account_id)return {wallet:null};
    const account=await request('/accounts/'+encodeURIComponent(row.account_id));
    if(account.parent_account?.id!==platformAccountId())throw fail('Your previous wallet could not be confirmed.','PROVIDER');
    return {wallet:{kind:'business',balance:balanceView(account),withdrawalsAvailable:withdrawalsAvailable(),identityVerified:identityVerification(account).status==='approved'}};
  }
  function hostedUrl(value, verification = false) {
    try {
      const url = new URL(value);
      const whop = url.hostname === 'whop.com' || url.hostname.endsWith('.whop.com');
      const sumsub = verification && (url.hostname === 'sumsub.com' || url.hostname.endsWith('.sumsub.com'));
      const cardIssuer = verification && url.hostname === 'verify.raincards.xyz';
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port && (whop || sumsub || cardIssuer)) return url.href;
    } catch {}
    throw fail('Your secure wallet link is unavailable. Please try again.', 'PROVIDER');
  }
  async function verify(userId) {
    const row = await owned(userId);
    const account = await request('/accounts/' + encodeURIComponent(row.account_id));
    if (account.parent_account?.id !== platformAccountId()) throw fail('Your wallet connection could not be confirmed.', 'PROVIDER');
    const current = identityVerification(account);
    if (current.status === 'approved') return snapshot(userId);
    if (current.status === 'manual_review') return snapshot(userId);
    const result = await request('/verifications?account_id=' + encodeURIComponent(row.account_id), { method:'POST', body:{kind:'individual', ...(current.status === 'rejected' ? {restart:true} : {})} });
    // Approved profiles no longer have a session_url. Returning status lets
    // the UI advance without treating that valid response as a broken link.
    if (result.status === 'approved') return snapshot(userId);
    return { url:hostedUrl(result.session_url, true) };
  }
  async function connectCard(userId) {
    if (!cardProgramAvailable()) throw fail('Card payments are not available for your wallet yet.', 'NOT_SET_UP');
    const row=await owned(userId);
    const account=await request('/accounts/'+encodeURIComponent(row.account_id));
    if(account.parent_account?.id!==platformAccountId())throw fail('Your wallet connection could not be confirmed.','PROVIDER');
    if(account.capabilities?.card_issuing==='active')return snapshot(userId);
    const application=cardApplicationStatus(account,row);
    if(['pending','manual_review','denied','locked','canceled'].includes(application))return snapshot(userId);
    if(['connection_card','connection_card_provisioning','connection_issuance_provisioning','connection_card_invitation'].includes(row.application_status))return snapshot(userId);
    // The first request starts the human owner's card application. No reusable
    // card credentials or card number are exposed by this connection flow.
    // Persist the intent before the network call. A lost create response can
    // still leave an issued card, so recovery must know which account to poll.
    const issuing=application==='approved';
    const issuancePending=row.application_status==='connection_issuance_pending';
    const start=key=>request('/cards',{method:'POST',key,body:application==='approved'
      ? {account_id:row.account_id,assigned_user_id:row.owner_provider_id,name:'Belna card connection',spend_limit:1,spend_limit_frequency:'one_time'}
      : {account_id:row.account_id,assigned_user_id:row.owner_provider_id}});
    // Concurrent retries of the same refused operation must agree on one new
    // key, so they cannot issue separate cards if approval arrives meanwhile.
    const retryKey=async key=>'card-connect-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('card-refused:'+key))),b=>b.toString(16).padStart(2,'0')).join('');
    if(issuing && !issuancePending){
      // Whop's first POST filed the application. Approval requires a distinct
      // POST to issue a card; replaying the application key only returns 202.
      row.card_request_key=await retryKey(row.card_request_key);
      await store.saveBelnaWallet(userId,{card_request_key:row.card_request_key,application_status:'connection_issuance_pending',application_requested_at:new Date().toISOString()});
    }
    if(!issuing)await store.saveBelnaWallet(userId,{application_status:'connection_pending',application_requested_at:new Date().toISOString()});
    let result;
    try { result=await start(row.card_request_key); }
    catch(error) {
      // Whop caches 4xx responses for 24 hours too. A rejected first card
      // request may have been keyed with the old issuance payload, which Whop
      // declined before filing an application. Retry once with a distinct key
      // and only the account and owner required for an application. Keep the
      // original key on timeouts, 5xx and
      // conflicts from requests still processing: their outcome is unknown.
      if(!error.cardNotApproved && !(application==null && error.providerStatus===400))throw error;
      const freshKey=await retryKey(row.card_request_key);
      await store.saveBelnaWallet(userId,{card_request_key:freshKey,application_status:'connection_refused'});
      if(!error.idempotentReplayed && error.providerStatus!==400)return snapshot(userId);
      try { result=await start(freshKey); }
      catch(retryError) {
        if(!retryError.cardNotApproved && !(application==null && retryError.providerStatus===400))throw retryError;
        await store.saveBelnaWallet(userId,{card_request_key:await retryKey(freshKey),application_status:'connection_refused'});
        return snapshot(userId);
      }
    }
    if(!['card','card_application','card_provisioning','card_invitation'].includes(result.object))throw fail('Card connection is pending. Please refresh before trying again.','PROVIDER');
    await store.saveBelnaWallet(userId,{application_status:result.object==='card_application' && ['approved','pending','manual_review','denied','locked','canceled','needs_verification','needs_information'].includes(result.status)
      ? 'connection_application_'+result.status
      : result.object==='card_provisioning' ? application==='approved' ? 'connection_issuance_provisioning' : 'connection_application_pending'
      : 'connection_'+result.object});
    if(result.object==='card'){
      if(!/^icrd_[a-zA-Z0-9]+$/.test(result.id||''))throw fail('Card connection is pending. Please refresh.','PROVIDER');
      await request('/cards/'+encodeURIComponent(result.id),{method:'PATCH',body:{account_id:row.account_id,canceled:true}});
    }
    const status=await snapshot(userId);
    if(result.object==='card_application' && result.hosted_url)status.url=hostedUrl(result.hosted_url,true);
    return status;
  }
  async function reconcileConnectionCards() {
    await loadConfiguration();
    if (!store.listPendingWalletConnections) return { checked:0, unresolved:0 };
    const pending=await store.listPendingWalletConnections(environment());
    let unresolved=0;
    for (const row of pending) {
      try {
        const account=await request('/accounts/'+encodeURIComponent(row.account_id));
        if(account.parent_account?.id!==platformAccountId())throw fail('Your wallet connection could not be confirmed.','PROVIDER');
        const cards=await request('/cards?account_id='+encodeURIComponent(row.account_id));
        const matching=(cards.data || []).filter(card=>card.name==='Belna card connection' && card.user_id===row.owner_provider_id);
        for (const card of matching) {
          if(card.status==='canceled')continue;
          if(!/^icrd_[A-Za-z0-9]+$/.test(card.id || ''))throw fail('Invalid connection card.','PROVIDER');
          const closed=await request('/cards/'+encodeURIComponent(card.id),{method:'PATCH',body:{account_id:row.account_id,canceled:true}});
          if(closed.id!==card.id || closed.status!=='canceled')throw fail('Connection card cancellation is pending.','PROVIDER');
        }
        if(matching.length){
          const account=await request('/accounts/'+encodeURIComponent(row.account_id));
          if(account.capabilities?.card_issuing==='active')await store.saveBelnaWallet(row.user_id,{application_status:'approved'});
        }
      } catch (error) {
        unresolved++;
        console.error('belna-wallet-connection-recovery', { code:error?.code || 'STORE', providerStatus:error?.providerStatus || null });
      }
      finally {
        try { await store.saveBelnaWallet(row.user_id,{last_connection_check_at:new Date().toISOString()}); }
        catch { unresolved++; }
      }
    }
    return { checked:pending.length, unresolved };
  }
  async function updateCard(userId, input) {
    const row = await owned(userId);
    const change = typeof input.frozen === 'boolean' ? { frozen:input.frozen }
      : { spend_limit:validateLimit(input.dailyLimitUsd), spend_limit_frequency:'daily' };
    if(!row.card_id){
      await store.saveBelnaWallet(userId,change.spend_limit?{daily_card_limit:change.spend_limit}:{card_status:change.frozen?'frozen':'active'});
      if(change.frozen===true && store.listPendingWalletPurchases)await purchases.cancelOwner(userId);
      return snapshot(userId);
    }
    const card = await request('/cards/' + encodeURIComponent(row.card_id), { method:'PATCH', body:{ account_id:row.account_id, ...change } });
    if (card.id !== row.card_id) throw fail('Your card could not be updated.', 'PROVIDER');
    await store.saveBelnaWallet(userId, { card_status:card.status, ...(change.spend_limit ? { daily_card_limit:change.spend_limit } : {}) });
    if (change.frozen === true && store.listPendingWalletPurchases) await purchases.cancelOwner(userId);
    return snapshot(userId);
  }
  async function deposit(userId) {
    const row = await owned(userId);
    const result = await request('/deposits', { method:'POST', body:{ destination:row.account_id } });
    if (result.account_id !== row.account_id) throw fail('Your deposit destination could not be confirmed. Please try again.', 'PROVIDER');
    return { url:hostedUrl(result.hosted_url) };
  }
  // Owner UI only. Never register this method as an agent tool. The token is
  // child-account scoped, short lived and cannot read or issue payment cards.
  // Whop's embedded flow collects bank details, quotes fees and asks the owner
  // to confirm; Belna does not receive those details or submit the payout.
  async function withdrawalSession(userId) {
    if(!withdrawalsAvailable())throw fail('Bank withdrawals are being connected. Please try again shortly.','NOT_SET_UP');
    const row=await owned(userId);
    const account=await request('/accounts/'+encodeURIComponent(row.account_id));
    if(account.parent_account?.id!==platformAccountId())throw fail('Your wallet connection could not be confirmed.','PROVIDER');
    const expiresAt=new Date(Date.now()+15*60000).toISOString();
    const result=await request('/access_tokens',{method:'POST',body:{account_id:row.account_id,expires_at:expiresAt,
      scoped_actions:['payout:withdraw_funds','payout:destination:read','payout:create_destination']}});
    const expires=Date.parse(result.expires_at);
    if(typeof result.token!=='string' || result.token.length<32 || !Number.isFinite(expires) || expires<=Date.now() || expires>Date.parse(expiresAt)+1000)
      throw fail('Your bank connection session could not be started. Please try again.','PROVIDER');
    return {accountId:row.account_id,accessToken:result.token,expiresAt:result.expires_at,currency:'usd'};
  }
  // Consumer setup uses explicit individual KYC. Whop's Cards list starts KYB
  // and must never be used as the verification entry point for our consumers.
  async function cardSession(userId) {
    if(!cardProgramAvailable())throw fail('Card setup is not available for your wallet yet.','NOT_SET_UP');
    const row=await owned(userId);
    const account=await request('/accounts/'+encodeURIComponent(row.account_id));
    if(account.parent_account?.id!==platformAccountId())throw fail('Your wallet connection could not be confirmed.','PROVIDER');
    if(['denied','locked','canceled'].includes(cardApplicationStatus(account,row)))throw fail('The card issuer has not approved your application. Contact card support.','REVIEW');
    const expiresAt=new Date(Date.now()+15*60000).toISOString();
    const result=await request('/access_tokens',{method:'POST',body:{account_id:row.account_id,expires_at:expiresAt,
      scoped_actions:['identity:read','identity:write']}});
    const expires=Date.parse(result.expires_at);
    if(typeof result.token!=='string' || result.token.length<32 || !Number.isFinite(expires) || expires<=Date.now() || expires>Date.parse(expiresAt)+1000)
      throw fail('Your secure card setup could not be started. Please try again.','PROVIDER');
    return {accountId:row.account_id,accessToken:result.token,expiresAt:result.expires_at,verificationKind:'individual'};
  }
  async function receive(userId, { amount, title, requestKey }) {
    const row = await owned(userId);
    amount = validateLimit(amount);
    title = String(title || '').trim();
    if (!title || title.length > 120) throw fail('Describe what the payment is for, in 120 characters or less.');
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey || '')) throw fail('Refresh your wallet and try again.');
    const result = await request('/checkout_configurations', { method:'POST', key:requestKey,
      body:{ mode:'payment', plan:{ company_id:row.account_id, currency:'usd', initial_price:amount, plan_type:'one_time', title, release_method:'buy_now' } } });
    const paymentOwners = [result.account_id, result.company_id].filter(id => id != null);
    if(!paymentOwners.length || paymentOwners.some(id => id !== row.account_id) || result.plan?.currency!=='usd' || result.plan?.plan_type!=='one_time' || Number(result.plan?.initial_price)!==amount)
      throw fail('Your payment link could not be confirmed. Please try again.','PROVIDER');
    return { url:hostedUrl(result.purchase_url), amount, currency:'USD', title };
  }
  const publicQuote = (q) => ({ quoteId:q.id, recipient:q.recipient_email, amount:Number(q.amount), currency:'USD', fees:'Payment partner fees may apply in addition to this amount.' });
  async function transferQuote(userId, { recipient, amount }) {
    const row = await owned(userId);
    amount = validateLimit(amount);
    if (amount > 50) throw fail('Transfers are limited to $50 in 24 hours, separate from your card limit.');
    recipient = String(recipient || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw fail('Enter the recipient’s Belna account email.');
    const target = await store.findBelnaWalletRecipient(recipient);
    if (!/^biz_[A-Za-z0-9]+$/.test(target?.account_id || '') || target.account_id === platformAccountId() || target.account_id === row.account_id || target.environment !== environment() || target.user_id === userId) throw fail('The recipient needs their own Belna Wallet.');
    const account = await request('/accounts/' + encodeURIComponent(row.account_id));
    if(account.parent_account?.id!==platformAccountId())throw fail('Your wallet connection could not be confirmed.','PROVIDER');
    if (account.capabilities?.transfer !== 'active') throw fail('Sending money is not enabled for your wallet yet. Complete your identity check first.');
    const available = balanceView(account).available;
    if (available == null || available < amount) throw fail('Your available dollar balance is too low for this transfer.');
    const quote = await store.addBelnaWalletQuote(userId, { id:randomId(), recipient_email:recipient, destination_id:target.account_id, amount });
    return publicQuote(quote);
  }
  async function send(userId, { quoteId, approvedDetail }) {
    const row = await owned(userId);
    const quote = await store.getBelnaWalletQuote(userId, quoteId);
    if (!quote || approvedDetail !== JSON.stringify(publicQuote(quote))) throw fail('Review and approve this exact transfer first.');
    const reserved = await store.beginBelnaWalletTransfer(userId, quoteId);
    if (reserved.status === 'succeeded' || reserved.status === 'failed') return { ...publicQuote(quote), status:reserved.status };
    // Reserve before calling the provider. On a timeout keep the reservation and retry
    // the SAME key; never release money that might already have left the account.
    const result = reserved.provider_id ? await request('/transfers/' + encodeURIComponent(reserved.provider_id))
      : await request('/transfers', { method:'POST', key:quoteId, body:{ type:'ledger', currency:'usd', origin_id:row.account_id, destination_id:quote.destination_id, amount:Number(quote.amount), idempotence_key:quoteId } });
    if (result.object !== 'transfer' || !['processing','succeeded','failed'].includes(result.status)) throw fail('Transfer status is pending. Retry this same transfer to check it safely.', 'PROVIDER');
    await store.saveBelnaWalletTransfer(userId, quoteId, { status:result.status, provider_id:result.id });
    return { ...publicQuote(quote), status:result.status };
  }
  async function confirmTransfer(userId, { quoteId, confirm }) {
    if (confirm !== true) throw fail('Review and confirm your transfer first.');
    const quote = await store.getBelnaWalletQuote(userId, quoteId);
    if (!quote) throw fail('That transfer was not found.');
    return send(userId, { quoteId, approvedDetail:JSON.stringify(publicQuote(quote)) });
  }
  const purchaseStore={...store,listPendingWalletPurchases:async environment=>(await store.listPendingWalletPurchases(environment)).filter(p=>/^biz_/.test(p.account_id))};
  const purchases = createWalletPurchases({ store:purchaseStore, request, owned, balanceView, environment, secureCheckout });
  const addressView = a => ({ id:a.id,label:a.label,recipient:a.recipient,line1:a.line1,line2:a.line2,city:a.city,region:a.region,postalCode:a.postal_code,country:a.country,isDefault:a.is_default,
    formatted:[a.recipient,a.line1,a.line2,[a.postal_code,a.city].filter(Boolean).join(' '),a.region,a.country].filter(Boolean).join(', ') });
  // Addresses, payment selection and purchase history live only in Supabase. Without it a
  // purchase is checked as before Belna Wallet existed, instead of failing.
  const durable = () => typeof store.supaConfigured !== 'function' || store.supaConfigured();
  async function addresses(userId) { return {addresses:durable() ? (await store.listShippingAddresses(userId)).map(addressView) : []}; }
  async function saveAddress(userId,input) {
    const clean=(name,max,required=true)=>{const value=String(input[name]||'').replace(/\s+/g,' ').trim();if((required&&!value)||value.length>max||/[\x00-\x1f]/.test(value))throw fail('Enter a valid '+name+'.');return value;};
    const id=input.id || randomId();
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(id))throw fail('That address is invalid.');
    const country=clean('country',2).toUpperCase();if(!/^[A-Z]{2}$/.test(country))throw fail('Choose a country.');
    return {addresses:(await store.saveShippingAddress(userId,{id,label:clean('label',40),recipient:clean('recipient',80),line1:clean('line1',100),line2:clean('line2',60,false),city:clean('city',60),region:clean('region',60,false),postal_code:clean('postalCode',20),country,is_default:input.isDefault===true})).map(addressView)};
  }
  async function deleteAddress(userId,{id}) {
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(id||''))throw fail('That address is invalid.');
    return {addresses:(await store.deleteShippingAddress(userId,id)).map(addressView)};
  }
  // spendingMethod is what a purchase may use now. An owner who never chose keeps paying as
  // before Belna Wallet, with Shop Pay or a card saved at the merchant; a saved choice,
  // including none (paused), is respected.
  const prefView=p=>({activeMethod:p?.active_method || null,merchantEnabled:p?.merchant_enabled===true,selectionSaved:!!p,
    spendingMethod:p ? p.active_method || null : 'existing_card'});
  async function preferences(userId) {return prefView(durable() ? await store.getWalletPreferences(userId) : null);}
  async function savePreferences(userId,input) {
    const current=await store.getWalletPreferences(userId);
    const fields={active_method:current?.active_method || null,merchant_enabled:current?.merchant_enabled===true};
    if(Object.hasOwn(input,'merchantEnabled')){if(typeof input.merchantEnabled!=='boolean')throw fail('Choose a valid connection.');fields.merchant_enabled=input.merchantEnabled;}
    if(Object.hasOwn(input,'activeMethod')){
      if(![null,'belna_wallet','existing_card'].includes(input.activeMethod))throw fail('Choose a valid wallet.');
      if(input.activeMethod==='belna_wallet' && !(await store.getBelnaWallet(userId))?.account_id)throw fail('Connect your Belna Wallet first.');
      if(input.activeMethod==='existing_card' && !fields.merchant_enabled && !(await store.getShopPayAccount(userId))?.encryptedShopToken)throw fail('Connect Shop Pay or logged-in payments first.');
      fields.active_method=input.activeMethod;
    }
    return prefView(await store.saveWalletPreferences(userId,fields));
  }
  async function recordExistingPurchase(userId,approved){
    if(!['shop_pay','saved_card'].includes(approved?.paymentMethod))throw fail('Approve this purchase first.');
    if(durable())await store.recordExistingPurchase(userId,approved);
  }
  async function existingHistory(userId){return {history:durable() ? (await store.listExistingPurchases(userId)).map(x=>({title:x.merchant,amount:Number(x.amount),currency:x.currency,status:x.status,at:x.created_at})) : []};}
  return { configured, snapshot, legacySnapshot, setup, verify, connectCard, cardSession, updateCard, deposit, withdrawalSession, receive, transferQuote, send, confirmTransfer,
    preferences,savePreferences,
    recordExistingPurchase,existingHistory,
    addresses,saveAddress,deleteAddress,
    connectionInfo:async()=>{await loadConfiguration();return {platformAccountId:platformAccountId(),environment:environment()};},
    executePurchase:async (...args)=>{await loadConfiguration();if(!await checkoutAvailable())throw fail('Secure card checkout is not available yet. Use an existing saved card.','NOT_SET_UP');return purchases.execute(...args);}, checkProviderConnection,
    reconcilePurchases:async()=>{await loadConfiguration();return purchases.reconcile();},reconcilePurchaseCard:purchases.reconcileCard,reconcileConnectionCards };
}
function createBelnaWallet(options){
  const connectedStore={...options.store,
    getBelnaWallet:async userId=>{const row=await options.store.getBelnaWallet(userId);return row?.wallet_kind==='personal'?null:row;},
    ...(options.store.listPendingWalletConnections?{listPendingWalletConnections:async environment=>(await options.store.listPendingWalletConnections(environment)).filter(row=>/^biz_/.test(row.account_id))}:{}),
    claimBelnaWallet:async (...args)=>{
      if(typeof options.store.claimConnectedBelnaWallet!=='function')throw Object.assign(new Error('Wallet setup is not configured. Please contact Belna support.'),{code:'NOT_SET_UP'});
      const row=await options.store.claimConnectedBelnaWallet(...args);
      if(row?.wallet_kind!=='business' || row.user_id!==args[0] || row.account_id && !/^biz_[A-Za-z0-9]+$/.test(row.account_id))throw Object.assign(new Error('Your connected wallet setup could not be confirmed. Please try again.'),{code:'WALLET_STORE'});
      return row;
    }};
  const wallet=createBusinessWallet({...options,store:connectedStore});
  const retired=async()=>{throw Object.assign(new Error('Create your Belna Wallet connected account in Wallet settings. Personal Whop sign-in cannot issue cards.'),{code:'NOT_SET_UP'});};
  return {...wallet,finishConnect:retired,paymentRequest:retired,
    legacyWithdrawalSession:retired,
    snapshot:async userId=>{const result=await wallet.snapshot(userId);const previous=await options.store.getBelnaWallet(userId);if(previous?.wallet_kind==='personal')result.wallet.previousPersonalWallet=true;return result;},
    reconcilePurchaseCard:async(ownerId,cardId)=>{if(ownerId?.startsWith('user_'))return;return wallet.reconcilePurchaseCard(ownerId,cardId);}};
}
module.exports = { createBelnaWallet, createBusinessWallet };
