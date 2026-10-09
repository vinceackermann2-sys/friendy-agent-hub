// Only public wallet identifiers and exact action requests are stored here.
// Authorization signatures, JWTs, wallet keys and provider secrets are never persisted.
function createPrivyWalletStore({ supa, ensureProfile }) {
  const db = () => {
    const c = supa();
    if (!c)
      throw Object.assign(new Error('Wallet storage is unavailable.'), { code: 'NOT_SET_UP' });
    return c;
  };
  const checked = ({ data, error }) => {
    if (error)
      throw Object.assign(new Error('Could not save or load your wallet. Please try again.'), {
        code: 'WALLET_STORE',
      });
    return data;
  };
  const getPrivyWallet = async (userId) =>
    checked(await db().from('belna_privy_wallets').select('*').eq('user_id', userId).maybeSingle());
  async function claimPrivyWallet(userId, fields) {
    await ensureProfile(userId);
    checked(
      await db()
        .from('belna_privy_wallets')
        .upsert({ user_id: userId, ...fields }, { onConflict: 'user_id', ignoreDuplicates: true }),
    );
    return getPrivyWallet(userId);
  }
  const updatePrivyWallet = async (userId, fields) =>
    checked(
      await db()
        .from('belna_privy_wallets')
        .update(fields)
        .eq('user_id', userId)
        .select('*')
        .single(),
    );
  const createPrivyIntent = async (userId, fields) =>
    checked(
      await db()
        .from('belna_privy_wallet_intents')
        .insert({ user_id: userId, ...fields })
        .select('*')
        .single(),
    );
  const getPrivyIntent = async (userId, id) =>
    checked(
      await db()
        .from('belna_privy_wallet_intents')
        .select('*')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle(),
    );
  const listPrivyIntents = async (userId) =>
    checked(
      await db()
        .from('belna_privy_wallet_intents')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
    );
  const beginPrivyIntent = async (userId, id) => {
    const result = await db().rpc('begin_privy_wallet_intent', { p_user_id: userId, p_id: id });
    const messages = {
      'daily wallet allowance exceeded':
        'Your 24-hour transfer limit has been reached. Check Wallet settings.',
      'check pending wallet action first':
        'Check your pending wallet action before starting another.',
      'wallet requests paused': 'Wallet transfers are paused. Resume them in Wallet settings.',
      'intent expired': 'This request expired or was canceled. Review a new request.',
    };
    if (result.error?.code === 'P0001' && messages[result.error.message])
      throw Object.assign(new Error(messages[result.error.message]), { code: 'WALLET_STORE' });
    return checked(result);
  };
  const updatePrivyIntent = async (userId, id, fields) =>
    checked(
      await db()
        .from('belna_privy_wallet_intents')
        .update(fields)
        .eq('user_id', userId)
        .eq('id', id)
        .select('*')
        .single(),
    );
  // A stale agent approval or cancellation must never reopen a reserved action.
  const markPrivyIntentAwaitingOwner = async (userId, id) =>
    checked(
      await db()
        .from('belna_privy_wallet_intents')
        .update({ status: 'awaiting_owner' })
        .eq('user_id', userId)
        .eq('id', id)
        .eq('status', 'quoted')
        .select('*')
        .maybeSingle(),
    );
  const cancelPrivyIntent = async (userId, id) =>
    checked(
      await db()
        .from('belna_privy_wallet_intents')
        .update({ status: 'canceled' })
        .eq('user_id', userId)
        .eq('id', id)
        .in('status', ['quoted', 'awaiting_owner'])
        .select('*')
        .maybeSingle(),
    );
  async function findPrivyRecipient(email) {
    const row = checked(
      await db().from('belna_privy_wallets').select('*').eq('owner_email', email).maybeSingle(),
    );
    if (!row) return null;
    const { data, error } = await db().auth.admin.getUserById(row.user_id);
    return !error && data?.user?.email_confirmed_at && data.user.email?.toLowerCase() === email
      ? row
      : null;
  }
  async function getPrivyAccountUser(userId) {
    const { data, error } = await db().auth.admin.getUserById(userId);
    if (error)
      throw Object.assign(new Error('Your Belna account could not be verified.'), {
        code: 'VERIFY',
      });
    return data?.user || null;
  }
  async function recordPrivyBalance(userId, available) {
    checked(
      await db()
        .from('belna_privy_wallet_balances')
        .upsert(
          { user_id: userId, day: new Date().toISOString().slice(0, 10), available },
          { onConflict: 'user_id,day' },
        ),
    );
    return checked(
      await db()
        .from('belna_privy_wallet_balances')
        .select('day,available')
        .eq('user_id', userId)
        .order('day', { ascending: false })
        .limit(30),
    );
  }
  async function getPrivyWalletConfiguration() {
    const raw = checked(await db().rpc('get_server_secret', { p_name: 'privy_wallet_config' }));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw Object.assign(new Error('Wallet configuration needs attention.'), {
        code: 'NOT_SET_UP',
      });
    }
  }
  return {
    getPrivyWallet,
    claimPrivyWallet,
    updatePrivyWallet,
    createPrivyIntent,
    getPrivyIntent,
    listPrivyIntents,
    beginPrivyIntent,
    updatePrivyIntent,
    markPrivyIntentAwaitingOwner,
    cancelPrivyIntent,
    findPrivyRecipient,
    getPrivyAccountUser,
    recordPrivyBalance,
    getPrivyWalletConfiguration,
  };
}
module.exports = { createPrivyWalletStore };
