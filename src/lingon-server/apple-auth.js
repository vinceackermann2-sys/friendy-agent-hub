import { appleIdentity } from './apple-identity.js';
import { eraseLibraryStorage } from './account-deletion.js';
import { wasUnconfirmed, secureFirstSignIn } from './auth-email.js';
function createAppleAccountCleanup({ adminClient, tasks, composio, azure }) {
  return async userId => {
    const admin = adminClient();
    const checked = async query => { const {data,error}=await query; if(error) throw new Error('Account cleanup storage unavailable.'); return data; };
    await checked(admin.from('account_deletions').upsert({user_id:userId},{onConflict:'user_id',ignoreDuplicates:true}));
    // Stop watchers and tasks before deleting their backing records, so an
    // already running worker cannot recreate the account after deletion.
    await checked(admin.from('sub_agents').update({enabled:false}).eq('user_id',userId));
    const active = await checked(admin.from('agent_chat_tasks').select('id,chat_id,state').eq('user_id',userId).in('state->>status',['queued','running','waiting_peers','waiting_approval','stopping']));
    for(const row of active || []) await tasks.control(userId,row.id,{action:'cancel',requestId:'account-delete:'+row.id},row.chat_id);
    const stopping = await checked(admin.from('agent_chat_tasks').select('id').eq('user_id',userId).eq('state->>status','stopping'));
    if(stopping?.length) throw new Error('Wait for the current account operation to stop, then retry deletion.');
    if(composio.configured()) for(const account of await composio.listConnected(userId)) await composio.deleteConnected(userId,account.id);
    if(azure.isAzureConfigured()) {
      const record = await checked(admin.from('account_deletions').select('workspace_resources').eq('user_id',userId).maybeSingle());
      const manifest = await azure.planAccountErasure(userId,record?.workspace_resources || {});
      await checked(admin.from('account_deletions').update({workspace_resources:manifest}).eq('user_id',userId));
      await azure.eraseAccountWorkspace(userId,manifest);
    }
    await eraseLibraryStorage(admin,userId);
    await checked(admin.from('library_storage_gc').delete().eq('user_id',userId));
  };
}
function appleTokenEmail(token) {
  try { return String(JSON.parse(Buffer.from(String(token || '').split('.')[1] || '', 'base64url').toString('utf8')).email || ''); }
  catch { return ''; }
}
function installAppleAuthRoutes(app, { requireAuth, rateLimit, pubClient, adminClient, store, stripe, identity = appleIdentity, beforeDelete = async () => {} }) {
  app.post('/api/auth/apple', rateLimit(15,60000), async (req,res) => {
    const input = req.body || {};
    if (input.terms_version !== '2026-09-24') return res.status(400).json({error:'Please accept the current Terms and Privacy Policy.'});
    if (typeof input.authorizationCode !== 'string' || !input.authorizationCode.length || input.authorizationCode.length > 2000 || typeof input.nonce !== 'string' || input.nonce.length < 32 || input.nonce.length > 200) return res.status(400).json({error:'Valid Apple credential required.'});
    const client = pubClient();
    if (!client) return res.status(503).json({error:'Account authentication is unavailable.'});
    try {
      // Supabase verifies Apple's signature, audience, expiry and nonce. Never
      // trust decoded JWT contents or a client-supplied Apple user identifier.
      const tokens = await identity.exchange(input.authorizationCode);
      // Read only to find an unconfirmed account with this address; Supabase verifies the token.
      const unconfirmed = await wasUnconfirmed(appleTokenEmail(tokens.identityToken));
      const {data,error} = await client.auth.signInWithIdToken({provider:'apple',token:tokens.identityToken,nonce:input.nonce});
      if (error || !data?.session || !data.user) return res.status(401).json({error:'Apple sign-in failed. Please try again.'});
      // Apple proved the address; a password set on the unconfirmed account before that is replaced.
      await secureFirstSignIn(adminClient(),data.user,{wasUnconfirmed:unconfirmed});
      await identity.save(data.user.id,tokens.refreshToken);
      const {error:termsError} = await client.auth.updateUser({data:{terms_version:input.terms_version,terms_accepted_at:new Date().toISOString()}});
      if(termsError) throw new Error('Terms could not be saved.');
      res.setHeader('Cache-Control','no-store');
      return res.json({access_token:data.session.access_token,refresh_token:data.session.refresh_token,user:data.user});
    } catch { return res.status(503).json({error:'Apple sign-in is unavailable. Check the Apple provider configuration.'}); }
  });
  app.post('/api/auth/delete-account', rateLimit(3,60000), requireAuth(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    if (req.body?.confirmation !== 'DELETE') return res.status(400).json({error:'Confirm account deletion first.'});
    const admin = adminClient();
    if (!admin) return res.status(503).json({error:'Account deletion is unavailable.'});
    try {
      const subscription = await store.getSubscription(req.user.id);
      if (subscription.stripe_subscription_id) {
        const client = stripe.client();
        if (!client) return res.status(503).json({error:'Subscription cancellation is unavailable; contact support@belna.se before deleting.'});
        const current = await client.subscriptions.retrieve(subscription.stripe_subscription_id);
        if (current.status !== 'canceled') await client.subscriptions.cancel(current.id);
      }
      // Cancel renewal before cloud cleanup, which may wait on provider retention.
      await beforeDelete(req.user.id);
      await identity.revoke(req.user);
      // profiles.id is text, independent of auth.users in the original schema.
      // Purge it explicitly while auth is still recoverable on a partial failure.
      const {error:purgeError} = await admin.rpc('delete_belna_account_data',{owner_id:req.user.id});
      if (purgeError) return res.status(503).json({error:'Account data could not be deleted. Contact support@belna.se; your sign-in remains available.'});
      const {error} = await admin.auth.admin.deleteUser(req.user.id);
      if (error) return res.status(503).json({error:'Your account data was deleted, but sign-in removal needs a retry. Contact support@belna.se.'});
      return res.json({ok:true,deleted:true});
    } catch(error) { return res.status(503).json({error:error.code === 'APPLE_REAUTH_REQUIRED' ? error.message : 'Account deletion could not finish. Please retry or contact support@belna.se.'}); }
  }, {allowDeleting:true}));
}
export { installAppleAuthRoutes, createAppleAccountCleanup };
