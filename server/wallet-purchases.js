// Trusted server code only. The checkout executor must run outside the agent's
// VM/tool environment. Never pass credentials through a model-visible tool.
function createWalletPurchases({ store, request, owned, balanceView, environment, secureCheckout, now = () => Date.now() }) {
  const fail = message => Object.assign(new Error(message), { code:'BAD_INPUT' });
  const view = p => ({ purchaseId:p.id, merchant:p.merchant, amount:Number(p.amount), currency:'USD', status:p.status,
    cardLast4:p.last4 || null, expiresAt:p.expires_at, cardCanceled:!!p.canceled_at });
  async function cancel(p) {
    if (!p.card_id || p.canceled_at) return p;
    const card = await request('/cards/' + encodeURIComponent(p.card_id), { method:'PATCH', body:{ account_id:p.account_id, canceled:true } });
    if (card.id !== p.card_id || card.status !== 'canceled') throw fail('Your purchase card is being closed. Please check again shortly.');
    return store.saveWalletPurchase(p.user_id,p.id,{ canceled_at:new Date(now()).toISOString(), status:p.status === 'paid' ? 'paid' : 'closed' });
  }
  async function execute(userId, approved, context) {
    if (typeof secureCheckout !== 'function') throw fail('Belna Wallet checkout is not enabled yet. Use an existing saved card.');
    if (approved?.paymentMethod !== 'belna_wallet' || !/^[a-f0-9]{64}$/.test(approved.checkoutKey || '') ||
        approved.currency !== 'USD' || !Number.isFinite(approved.amount) || approved.amount < 1 || approved.amount > 2000 ||
        Math.abs(approved.amount*100 - Math.round(approved.amount*100)) > 1e-8 || !/^https:\/\//.test(approved.website || ''))
      throw fail('Approve a dollar purchase between $1 and $2,000 with an exact final total first.');
    const wallet = await owned(userId);
    if (wallet.card_status === 'frozen') throw fail('Your wallet card is paused. Unfreeze it before purchasing.');
    const account = await request('/accounts/' + encodeURIComponent(wallet.account_id));
    if (account.capabilities?.card_issuing !== 'active' || balanceView(account).available < approved.amount || balanceView(account).available == null)
      throw fail('Your wallet needs an approved card account and enough available dollars.');
    const purchaseId = crypto.randomUUID();
    let p, executor;
    try {
      // Verify in the private environment BEFORE reserving an allowance or
      // issuing a card. An unsupported/changed checkout must not create money
      // movement capability or leave an unissued reservation stuck in recovery.
      executor = await secureCheckout({ userId, approved, purchaseId, context });
      if (!executor || !['verify','submit','close'].every(name => typeof executor[name] === 'function'))
        throw fail('Secure checkout is unavailable.');
      await executor.verify(approved);
      // Database lock atomically claims this approval and reserves the owner's
      // rolling allowance. A crashed/unknown attempt is never submitted twice.
      const claim = await store.claimWalletPurchase(userId,{ id:purchaseId, approval_key:approved.checkoutKey,
        account_id:wallet.account_id, environment:environment(), merchant:new URL(approved.website).hostname,
        amount:approved.amount, approved_detail:JSON.stringify(approved), expires_at:new Date(now()+15*60000).toISOString() });
      p = claim.purchase;
      if (!claim.claimed) return { ...view(p), message:'This approval was already used. Check wallet activity; do not place the order again.' };
      const card = await request('/cards', { method:'POST', key:p.id, body:{ account_id:wallet.account_id,
        assigned_user_id:wallet.owner_provider_id, name:'Belna purchase ' + p.id,
        spend_limit:approved.amount, spend_limit_frequency:'one_time' } });
      if (card.object !== 'card' || !/^icrd_[a-zA-Z0-9]+$/.test(card.id || '')) {
        // Asynchronous issuance is reconciled by its unique name. Do not
        // create another card or attempt checkout while issuance is pending.
        return { ...view(p), message:'Card issuance is pending. This order has not been submitted.' };
      }
      p = await store.saveWalletPurchase(userId,p.id,{ card_id:card.id, last4:card.last4, status:'ready' });
      if (card.status !== 'active' || card.type !== 'virtual' || card.user_id !== wallet.owner_provider_id)
        throw fail('The purchase card could not be confirmed for its owner.');
      if (Number(card.limit?.amount) !== approved.amount || card.limit?.frequency !== 'one_time') throw fail('The issuer did not confirm the purchase card limit.');
      // Issuance can take time: check the order again before exposing secrets
      // to the isolated executor. Never return its page or raw result to tools.
      await executor.verify(approved);
      const stillOwned = await owned(userId);
      if (stillOwned.account_id !== wallet.account_id || stillOwned.card_status === 'frozen' || now() >= Date.parse(p.expires_at))
        throw fail('This purchase is no longer available.');
      const secretCard = card.secrets?.card_number ? card : await request('/cards/' + encodeURIComponent(card.id) + '?account_id=' + encodeURIComponent(wallet.account_id));
      const month = Number(secretCard.expiration_month), year = Number(secretCard.expiration_year);
      if (secretCard.id !== card.id || secretCard.status !== 'active' || secretCard.user_id !== wallet.owner_provider_id ||
        !/^\d{13,19}$/.test(secretCard.secrets?.card_number || '') || !/^\d{3,4}$/.test(secretCard.secrets?.cvc || '') ||
        !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200 ||
        Date.UTC(year,month,1) <= now() || secretCard.secrets.card_number.slice(-4) !== card.last4 || now() >= Date.parse(p.expires_at))
        throw fail('Your secure purchase card is not ready.');
      p = await store.saveWalletPurchase(userId,p.id,{ status:'submitted' });
      if (now() >= Date.parse(p.expires_at)) throw fail('This purchase has expired.');
      // A timeout here has an unknown outcome: never retry the merchant click.
      const submitted=await executor.submit({ approved, purchaseId:p.id, card:{ id:card.id, last4:card.last4,
        expiration_month:String(month).padStart(2,'0'), expiration_year:String(year),
        billing:Object.fromEntries(['city','country_code','line1','line2','postal_code','region'].filter(key => typeof secretCard.billing?.[key] === 'string').map(key => [key,secretCard.billing[key]])),
        secrets:{ card_number:secretCard.secrets.card_number,
          cvc:secretCard.secrets.cvc, name_on_card:secretCard.secrets.name_on_card } } });
      return { ...view(p), ownerActionRequired:submitted?.ownerActionRequired===true, message:submitted?.ownerActionRequired===true
        ? 'Your bank needs you to verify this payment. Open this purchase in Wallet to continue privately.'
        : 'Checkout was submitted. Payment is confirmed only when the wallet reports a charge.' };
    } catch {
      // Cancellation is attempted even on uncertain outcomes. Failure remains
      // durably visible to the reconciler rather than claiming expiry locally.
      if (p) await cancel(p).catch(() => {});
      throw fail('Checkout could not be confirmed. Check wallet activity and the merchant before purchasing again.');
    } finally { try { await executor?.close?.(); } catch {} }
  }
  async function reconcile() {
    const pending = await store.listPendingWalletPurchases(environment());
    let unresolved = 0;
    for (let p of pending) {
      try {
        if (!p.card_id) {
          const cards = await request('/cards?account_id=' + encodeURIComponent(p.account_id));
          const card = (cards.data || []).find(x => x.name === 'Belna purchase ' + p.id);
          if (!card) { unresolved++; continue; }
          p = await store.saveWalletPurchase(p.user_id,p.id,{ card_id:card.id, last4:card.last4 });
          // Recovery must never submit a checkout after a lost response.
          await cancel(p); continue;
        }
        const transactions = await request('/card_transactions?account_id=' + encodeURIComponent(p.account_id) + '&card_id=' + encodeURIComponent(p.card_id) + '&first=10');
        // Close on ANY transaction, including a declined first attempt. A new
        // attempt needs a new owner review. Authorizations are not settlements.
        if ((transactions.data || []).some(x => x.card_id === p.card_id)) {
          if (transactions.data.some(x => x.card_id === p.card_id && x.transaction_type === 'spend' && x.status === 'completed')) p = await store.saveWalletPurchase(p.user_id,p.id,{ status:'paid' });
          await cancel(p);
        } else if (now() >= Date.parse(p.expires_at)) await cancel(p);
      } catch { unresolved++; }
    }
    return { checked:pending.length, unresolved };
  }
  async function reconcileCard(accountId,cardId) {
    if (!/^biz_[a-zA-Z0-9]+$/.test(accountId || '') || !/^icrd_[a-zA-Z0-9]+$/.test(cardId || '')) throw fail('Invalid card transaction event.');
    const p = await store.getWalletPurchaseByCard(accountId,cardId);
    if (!p || p.environment !== environment()) return { matched:false };
    const transactions = await request('/card_transactions?account_id=' + encodeURIComponent(accountId) + '&card_id=' + encodeURIComponent(cardId) + '&first=10');
    if (!(transactions.data || []).some(x => x.card_id === p.card_id)) return { matched:true, settled:false };
    let current = p;
    if (transactions.data.some(x => x.card_id === p.card_id && x.transaction_type === 'spend' && x.status === 'completed') && p.status !== 'paid') current = await store.saveWalletPurchase(p.user_id,p.id,{ status:'paid' });
    if (!current.canceled_at) current = await cancel(current);
    return { matched:true, settled:current.status === 'paid', cardCanceled:!!current.canceled_at };
  }
  async function cancelOwner(userId) {
    for (const p of await store.listPendingWalletPurchases(environment())) {
      if (p.user_id===userId && p.card_id && !p.canceled_at) await cancel(p);
    }
  }
  return { execute, reconcile, reconcileCard, view, cancelOwner };
}
module.exports = { createWalletPurchases };
