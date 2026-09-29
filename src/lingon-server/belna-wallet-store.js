// Provider identifiers and masked card metadata only. Never persist card credentials.
function createBelnaWalletStore({ supa, ensureProfile }) {
  const db = () => {
    const client = supa();
    if (!client) throw Object.assign(new Error('Belna Wallet is not available yet.'), { code:'NOT_SET_UP' });
    return client;
  };
  const checked = ({ data, error }) => {
    if (error) throw Object.assign(new Error('Could not save or load your wallet. Please try again.'), { code:'WALLET_STORE' });
    return data;
  };
  async function getBelnaWallet(userId) {
    return checked(await db().from('belna_wallets').select('*').eq('user_id', userId).maybeSingle());
  }
  async function getLegacyBelnaWallet(userId){return checked(await db().from('belna_wallet_legacy_accounts').select('wallet').eq('user_id',userId).maybeSingle())?.wallet || null;}
  async function getPersonalWalletConfiguration(){const value=checked(await db().rpc('get_server_secret',{p_name:'whop_personal_wallet_config'}));if(!value)return null;try{return JSON.parse(value);}catch{throw Object.assign(new Error('Personal wallet configuration needs attention.'),{code:'NOT_SET_UP'});}}
  async function claimBelnaWallet(userId, input) {
    await ensureProfile(userId);
    checked(await db().from('belna_wallets').upsert({ user_id:userId, ...input }, { onConflict:'user_id', ignoreDuplicates:true }));
    return getBelnaWallet(userId);
  }
  async function saveBelnaWallet(userId, fields) {
    return checked(await db().from('belna_wallets').update(fields).eq('user_id', userId).select('*').single());
  }
  async function findBelnaWalletRecipient(email) {
    const client = db();
    const row = checked(await client.from('belna_wallets').select('user_id,account_id,environment,wallet_kind').eq('owner_email', email).maybeSingle());
    if (!row) return null;
    // A saved email may have changed since setup. Never pay the former holder
    // when someone else has since registered that address, nor an unconfirmed one.
    const { data, error } = await client.auth.admin.getUserById(row.user_id);
    if (error || String(data?.user?.email || '').toLowerCase() !== email || !data.user.email_confirmed_at) return null;
    return row;
  }
  async function saveWhopWalletOAuthState(userId,fields){await ensureProfile(userId);checked(await db().from('belna_whop_wallet_oauth').upsert({user_id:userId,...fields}));}
  async function consumeWhopWalletOAuthState(userId,stateHash,environment){return checked(await db().rpc('consume_whop_wallet_oauth',{p_user_id:userId,p_state_hash:stateHash,p_environment:environment}));}
  async function connectPersonalWhopWallet(userId,connection){
    await ensureProfile(userId);
    const result=await db().rpc('connect_personal_whop_wallet',{p_user_id:userId,p_connection:connection});
    if(result.error)throw Object.assign(new Error('This Whop wallet is already connected, or your previous wallet has a payment still pending. Keep the same Whop identity and check pending wallet activity.'),{code:'WALLET_STORE'});
  }
  async function getWhopWalletAuth(userId){return checked(await db().from('belna_whop_wallet_auth').select('*').eq('user_id',userId).maybeSingle());}
  async function claimWhopWalletRefresh(userId,version,lease){return checked(await db().rpc('claim_whop_wallet_refresh',{p_user_id:userId,p_version:version,p_lease:lease}));}
  async function finishWhopWalletRefresh(userId,lease,tokens){checked(await db().rpc('finish_whop_wallet_refresh',{p_user_id:userId,p_lease:lease,p_tokens:tokens}));}
  async function releaseWhopWalletRefresh(userId,lease){checked(await db().rpc('release_whop_wallet_refresh',{p_user_id:userId,p_lease:lease}));}
  async function saveWalletPaymentRequest(userId,fields){
    checked(await db().from('belna_wallet_payment_requests').upsert({user_id:userId,...fields},{onConflict:'id',ignoreDuplicates:true}));
    return checked(await db().from('belna_wallet_payment_requests').select('*').eq('id',fields.id).eq('user_id',userId).single());
  }
  async function getWalletPaymentRequest(id){return checked(await db().from('belna_wallet_payment_requests').select('*').eq('id',id).maybeSingle());}
  async function getWalletTransferByRequest(id){return checked(await db().from('belna_wallet_transfers').select('*').eq('payment_request_id',id).maybeSingle());}
  async function addBelnaWalletQuote(userId, fields) {
    return checked(await db().from('belna_wallet_transfers').insert({ user_id:userId, ...fields }).select('*').single());
  }
  async function getBelnaWalletQuote(userId, id) {
    return checked(await db().from('belna_wallet_transfers').select('*').eq('user_id',userId).eq('id',id).maybeSingle());
  }
  async function beginBelnaWalletTransfer(userId, id) {
    const result = await db().rpc('begin_belna_wallet_transfer', { p_user_id:userId, p_id:id });
    if (result.error) throw Object.assign(new Error('This transfer expired or exceeds your $50 transfer allowance. Review a new transfer or try later.'), { code:'BAD_INPUT' });
    return result.data;
  }
  async function saveBelnaWalletTransfer(userId, id, fields) {
    return checked(await db().from('belna_wallet_transfers').update(fields).eq('user_id',userId).eq('id',id).select('*').single());
  }
  async function listBelnaWalletTransfers(userId) {
    return checked(await db().from('belna_wallet_transfers').select('id,origin_id,recipient_email,amount,status,created_at').eq('user_id',userId).neq('status','quoted').order('created_at',{ascending:false}).limit(10)) || [];
  }
  async function claimWalletPurchase(userId, purchase) {
    const result = await db().rpc('claim_wallet_purchase',{ p_user_id:userId,p_purchase:purchase });
    if (result.error) throw Object.assign(new Error('Your purchase exceeds the available wallet allowance or your wallet is paused.'),{code:'BAD_INPUT'});
    return result.data;
  }
  async function saveWalletPurchase(userId,id,fields) {
    return checked(await db().from('belna_wallet_purchases').update(fields).eq('user_id',userId).eq('id',id).select('*').single());
  }
  async function listWalletPurchases(userId) {
    return checked(await db().from('belna_wallet_purchases').select('id,account_id,merchant,amount,status,last4,expires_at,canceled_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(10)) || [];
  }
  async function getWalletPurchase(userId,id) {
    return checked(await db().from('belna_wallet_purchases').select('*').eq('user_id',userId).eq('id',id).maybeSingle());
  }
  async function getWalletPurchaseByCard(accountId,cardId) {
    return checked(await db().from('belna_wallet_purchases').select('*').eq('account_id',accountId).eq('card_id',cardId).maybeSingle());
  }
  async function listPendingWalletPurchases(environment) {
    // Keep checking closed authorizations for settlement for seven days.
    return checked(await db().from('belna_wallet_purchases').select('*').eq('environment',environment)
      .or('canceled_at.is.null,and(status.neq.paid,created_at.gt.'+new Date(Date.now()-7*86400000).toISOString()+')')
      .order('canceled_at',{ascending:true,nullsFirst:true}).order('created_at',{ascending:true}).limit(100)) || [];
  }
  async function listPendingWalletConnections(environment) {
    return checked(await db().from('belna_wallets')
      .select('user_id,account_id,owner_provider_id,application_status')
      .eq('environment',environment).like('application_status','connection_%')
      .not('account_id','is',null)
      .order('last_connection_check_at',{ascending:true,nullsFirst:true})
      .order('created_at',{ascending:true}).limit(100)) || [];
  }
  async function walletRecoveryReady(platformAccountId, environment, kind, now = Date.now()) {
    if(typeof kind==='number'){now=kind;kind=null;}
    try {
      const [enabled, health] = await Promise.all([
        db().rpc('get_server_secret',{p_name:'wallet_recovery_enabled'}),
        db().rpc('get_server_secret',{p_name:'wallet_recovery_health'})
      ]);
      if (enabled.error || health.error || enabled.data !== 'true') return false;
      const state = JSON.parse(health.data);
      const age = now - Date.parse(state.checkedAt);
      return state.ok === true && (kind!=='personal' || state.personalWallets===true) && state.platformAccountId === platformAccountId &&
        state.environment === environment && age >= 0 && age < 180000;
    } catch { return false; }
  }
  async function listShippingAddresses(userId) {
    return checked(await db().from('belna_shipping_addresses').select('*').eq('user_id',userId).order('is_default',{ascending:false}).order('created_at',{ascending:true})) || [];
  }
  async function getWalletPreferences(userId) {
    return checked(await db().from('belna_wallet_preferences').select('*').eq('user_id',userId).maybeSingle());
  }
  async function recordExistingPurchase(userId,p) {
    await ensureProfile(userId);
    checked(await db().from('belna_existing_purchases').upsert({user_id:userId,approval_key:p.checkoutKey,merchant:p.merchant,amount:p.amount,currency:p.currency},{onConflict:'user_id,approval_key',ignoreDuplicates:true}));
  }
  async function listExistingPurchases(userId) {
    return checked(await db().from('belna_existing_purchases').select('merchant,amount,currency,status,created_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(20)) || [];
  }
  async function saveWalletPreferences(userId,fields) {
    await ensureProfile(userId);
    return checked(await db().from('belna_wallet_preferences').upsert({user_id:userId,...fields,updated_at:new Date().toISOString()},{onConflict:'user_id'}).select('*').single());
  }
  async function saveShippingAddress(userId,fields) {
    await ensureProfile(userId);
    checked(await db().rpc('save_shipping_address',{p_user_id:userId,p_address:fields}));
    return listShippingAddresses(userId);
  }
  async function deleteShippingAddress(userId,id) {
    checked(await db().rpc('delete_shipping_address',{p_user_id:userId,p_id:id}));
    return listShippingAddresses(userId);
  }
  return { getPersonalWalletConfiguration,getLegacyBelnaWallet,saveWhopWalletOAuthState,consumeWhopWalletOAuthState,connectPersonalWhopWallet,getWhopWalletAuth,claimWhopWalletRefresh,finishWhopWalletRefresh,releaseWhopWalletRefresh,saveWalletPaymentRequest,getWalletPaymentRequest,getWalletTransferByRequest,
    getBelnaWallet, claimBelnaWallet, saveBelnaWallet, findBelnaWalletRecipient, addBelnaWalletQuote, getBelnaWalletQuote, beginBelnaWalletTransfer, saveBelnaWalletTransfer, listBelnaWalletTransfers,
    listShippingAddresses,saveShippingAddress,deleteShippingAddress,
    getWalletPreferences,saveWalletPreferences,
    recordExistingPurchase,listExistingPurchases,
    claimWalletPurchase,saveWalletPurchase,listWalletPurchases,getWalletPurchase,getWalletPurchaseByCard,listPendingWalletPurchases,listPendingWalletConnections,walletRecoveryReady };
}
export { createBelnaWalletStore };
