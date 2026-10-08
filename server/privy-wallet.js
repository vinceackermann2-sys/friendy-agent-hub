// User-owned USDC wallets. The app secret can read metadata, but cannot authorize
// spending. Every money-moving request needs the owner's ephemeral Privy signature.
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_CHAIN = 8453;
const API = 'https://api.privy.io';
function createPrivyWallet({
  store,
  env = process.env,
  fetchImpl = (...a) => fetch(...a),
  verifyIdentity,
  readBalance,
  randomId = () => crypto.randomUUID(),
  now = () => Date.now(),
  shared = {},
}) {
  env = { ...env };
  let configuration, jwks;
  const fail = (message, code = 'BAD_INPUT') => Object.assign(new Error(message), { code });
  const setting = (name) => String(env[name] || '').trim();
  async function load() {
    if (!configuration)
      configuration = (async () => {
        const saved = await store.getPrivyWalletConfiguration?.();
        for (const k of [
          'PRIVY_APP_ID',
          'PRIVY_APP_SECRET',
          'PRIVY_AUTH_MODE',
          'PRIVY_EARN_VAULT_ID',
          'PRIVY_EARN_ENABLED',
          'PRIVY_EARN_FEE_PERCENT',
          'PRIVY_BANK_WITHDRAWALS_ENABLED',
          'PRIVY_BASE_RPC_URL',
        ])
          if (typeof saved?.[k] === 'string') env[k] = saved[k].trim();
      })();
    try {
      await configuration;
    } catch (e) {
      configuration = null;
      throw e;
    }
  }
  const configured = () =>
    !!setting('PRIVY_APP_ID') && !!setting('PRIVY_APP_SECRET') && store.supaConfigured();
  const authMode = () => (setting('PRIVY_AUTH_MODE') === 'jwt' ? 'jwt' : 'email');
  async function config() {
    await load();
    return {
      provider: 'privy',
      appId: setting('PRIVY_APP_ID') || null,
      authMode: authMode(),
      configured: configured(),
      chainId: BASE_CHAIN,
      chain: 'base',
      asset: 'USDC',
      tokenAddress: BASE_USDC,
      decimals: 6,
      ownerAuthorizationRequired: true,
      agentSigningEnabled: false,
      bankWithdrawalsAvailable: configured() && setting('PRIVY_BANK_WITHDRAWALS_ENABLED') === 'true',
      earnAvailable:
        configured() &&
        setting('PRIVY_EARN_ENABLED') === 'true' &&
        !!setting('PRIVY_EARN_VAULT_ID'),
    };
  }
  async function request(path, { method = 'GET', body, signature, key, expiry } = {}) {
    await load();
    if (!configured())
      throw fail('The wallet connection needs to be configured.', 'NOT_SET_UP');
    const headers = {
      'privy-app-id': setting('PRIVY_APP_ID'),
      Authorization: 'Basic ' + btoa(setting('PRIVY_APP_ID') + ':' + setting('PRIVY_APP_SECRET')),
      'Content-Type': 'application/json',
      ...(signature ? { 'privy-authorization-signature': signature } : {}),
      ...(key ? { 'privy-idempotency-key': key } : {}),
      ...(expiry ? { 'privy-request-expiry': expiry } : {}),
    };
    let response;
    try {
      response = await fetchImpl(API + path, {
        method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw fail(
        'The wallet result is uncertain. Check this same request before trying again.',
        'PROVIDER',
      );
    }
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw fail(
        response.status === 401 || response.status === 403
          ? 'Your wallet authorization could not be verified. Check the connection and try again.'
          : 'The wallet provider could not complete this request. Check its status before trying again.',
        'PROVIDER',
      );
    if (!data || typeof data !== 'object')
      throw fail('The wallet returned an incomplete response.', 'PROVIDER');
    return data;
  }
  async function identity(userId, token, confirmedUser) {
    await load();
    if (typeof token !== 'string' || token.length > 24000)
      throw fail('Confirm your wallet identity first.', 'VERIFY');
    let payload;
    try {
      if (verifyIdentity) payload = await verifyIdentity(token);
      else {
        const jose = await import('jose');
        jwks ||= jose.createRemoteJWKSet(
          new URL(
            'https://auth.privy.io/api/v1/apps/' +
              encodeURIComponent(setting('PRIVY_APP_ID')) +
              '/jwks.json',
          ),
        );
        ({ payload } = await jose.jwtVerify(token, jwks, {
          issuer: 'privy.io',
          audience: setting('PRIVY_APP_ID'),
          algorithms: ['ES256'],
          requiredClaims: ['exp', 'iat', 'sub', 'linked_accounts'],
        }));
      }
    } catch {
      throw fail('Your wallet identity could not be verified. Reopen your wallet.', 'VERIFY');
    }
    let accounts;
    try {
      accounts = JSON.parse(payload.linked_accounts);
    } catch {
      throw fail('Your wallet identity is incomplete.', 'VERIFY');
    }
    if (
      !Array.isArray(accounts) ||
      typeof payload.sub !== 'string' ||
      !payload.sub.startsWith('did:privy:')
    )
      throw fail('Your wallet identity is incomplete.', 'VERIFY');
    if (authMode() === 'jwt') {
      if (!accounts.some((a) => a.type === 'custom_auth' && a.custom_user_id === userId))
        throw fail('This wallet belongs to a different Belna account.', 'VERIFY');
    } else {
      const owner = confirmedUser || (await store.getPrivyAccountUser?.(userId));
      if (
        owner?.id !== userId ||
        !owner.email_confirmed_at ||
        typeof owner.email !== 'string' ||
        !accounts.some(
          (a) =>
            a.type === 'email' &&
            typeof a.address === 'string' &&
            a.address.toLowerCase() === owner.email.toLowerCase(),
        )
      )
        throw fail(
          'Verify the same email address you use for your confirmed Belna account.',
          'VERIFY',
        );
    }
    return { did: payload.sub, accounts };
  }
  async function setup(user, { identityToken, walletId, country } = {}) {
    if (!user?.id || !user.email_confirmed_at)
      throw fail('Confirm your Belna email before creating a wallet.', 'VERIFY');
    if (!/^[A-Z]{2}$/.test(country || '')) throw fail('Choose your country.');
    const proof = await identity(user.id, identityToken, user);
    const account = proof.accounts.find(
      (a) =>
        a.type === 'wallet' &&
        a.wallet_client_type === 'privy' &&
        a.chain_type === 'ethereum' &&
        a.id === walletId,
    );
    if (!account || !/^0x[a-fA-F0-9]{40}$/.test(account.address || ''))
      throw fail('Create your user-owned embedded wallet first.', 'VERIFY');
    await verifyWalletOwner(
      { wallet_id: walletId, address: account.address.toLowerCase() },
      proof.did,
    );
    const row = await store.claimPrivyWallet(user.id, {
      wallet_id: walletId,
      privy_user_id: proof.did,
      address: account.address.toLowerCase(),
      owner_email: user.email.toLowerCase(),
      country,
    });
    if (row.user_id !== user.id || row.wallet_id !== walletId || row.privy_user_id !== proof.did)
      throw fail('A different wallet is already connected.', 'VERIFY');
    return snapshot(user.id);
  }
  function checkedRow(userId, row) {
    if (!row || row.user_id !== userId || !row.wallet_id || !/^0x[a-f0-9]{40}$/.test(row.address))
      throw fail('Create your Belna Wallet first.', 'NOT_SET_UP');
    return row;
  }
  async function owned(userId) {
    await load();
    return checkedRow(userId, await store.getPrivyWallet(userId));
  }
  async function verifyWalletOwner(row, did) {
    const wallet = await request('/v1/wallets/' + encodeURIComponent(row.wallet_id));
    if (
      wallet.id !== row.wallet_id ||
      !wallet.owner_id ||
      wallet.chain_type !== 'ethereum' ||
      wallet.address?.toLowerCase() !== row.address ||
      !Array.isArray(wallet.additional_signers) ||
      wallet.additional_signers.length ||
      wallet.automations?.length
    )
      throw fail(
        'Your wallet must be owned by you, with no delegated app signer or automation.',
        'VERIFY',
      );
    // owner_id is normally a key quorum ID, not the user's Privy DID.
    if (wallet.owner_id !== did) {
      const q = await request('/v1/key_quorums/' + encodeURIComponent(wallet.owner_id));
      if (
        q.id !== wallet.owner_id ||
        q.user_ids?.length !== 1 ||
        q.user_ids[0] !== did ||
        q.authorization_keys?.length ||
        q.key_quorum_ids?.length ||
        (q.authorization_threshold ?? 1) !== 1
      )
        throw fail('Only your verified wallet identity may authorize this wallet.', 'VERIFY');
    }
  }
  async function balance(row) {
    if (readBalance) return readBalance(row.address);
    const { createPublicClient, http, parseAbi } = await import('viem');
    const client = createPublicClient({
      transport: http(setting('PRIVY_BASE_RPC_URL') || 'https://mainnet.base.org', {
        timeout: 15000,
        retryCount: 1,
      }),
    });
    const [chainId, raw] = await Promise.all([client.getChainId(), client.readContract({
      address: BASE_USDC,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [row.address],
    })]);
    if (chainId !== BASE_CHAIN)
      throw fail('The wallet network could not be verified.', 'PROVIDER');
    return Number(raw) / 1e6;
  }
  function view(i) {
    return {
      quoteId: i.id,
      kind: i.kind,
      recipient: i.recipient,
      address: i.destination_address,
      amount: Number(i.amount),
      currency: 'USD',
      asset: 'USDC',
      chainId: BASE_CHAIN,
      chain: 'Base',
      vaultId: i.vault_id || null,
      fiatAccountId: i.fiat_account_id || null,
      bankCurrency: i.kind === 'bank_withdraw' ? 'EUR' : null,
      paymentRail: i.kind === 'bank_withdraw' ? 'sepa' : null,
      providerReviewRequired: i.provider_review_required === true,
      status: i.status,
      at: i.created_at,
      expiresAt: i.expires_at,
      ownerActionRequired: ['quoted', 'awaiting_owner', 'processing'].includes(i.status),
      fees: 'Network and provider fees may apply in addition to this amount.',
      risk: i.kind.startsWith('earn_')
        ? 'Yield is variable. Smart-contract losses and withdrawal delays are possible. This is not a bank deposit.'
        : null,
    };
  }
  async function earn(userId, walletRow) {
    const c = await config();
    if (!c.earnAvailable)
      return {
        available: false,
        reason: 'Earn is awaiting a reviewed vault configuration.',
        apy: null,
        position: null,
      };
    const row = walletRow ? checkedRow(userId, walletRow) : await owned(userId),
      vault = await request(
        '/v1/earn/ethereum/vaults/' + encodeURIComponent(setting('PRIVY_EARN_VAULT_ID')),
      );
    if (
      vault.id !== setting('PRIVY_EARN_VAULT_ID') ||
      vault.caip2 !== 'eip155:8453' ||
      vault.asset?.address?.toLowerCase() !== BASE_USDC.toLowerCase() || vault.asset?.decimals !== 6
    )
      throw fail('Earn must use the configured USDC vault on Base.', 'PROVIDER');
    const p = await request(
      '/v1/wallets/' +
        encodeURIComponent(row.wallet_id) +
        '/earn/ethereum/vaults?vault_id=' +
        encodeURIComponent(vault.id),
    );
    const number = (x) => (typeof x === 'string' && /^\d+$/.test(x) ? Number(x) / 1e6 : null);
    if (p.asset?.address?.toLowerCase() !== BASE_USDC.toLowerCase() || p.asset?.decimals !== 6)
      throw fail('Your Earn position could not be verified.', 'PROVIDER');
    const position = {
      available: number(p.assets_in_vault),
      deposited: number(p.total_deposited),
      withdrawn: number(p.total_withdrawn),
    };
    position.earned = Object.values(position).every(Number.isFinite)
      ? position.available - (position.deposited - position.withdrawn) : null;
    return {
      available: true,
      vaultId: vault.id,
      name: vault.name,
      provider: vault.provider,
      apy: Number.isFinite(vault.user_apy) ? vault.user_apy / 100 : null,
      yieldFeePercent: /^\d+(\.\d+)?$/.test(setting('PRIVY_EARN_FEE_PERCENT')) && Number(setting('PRIVY_EARN_FEE_PERCENT')) <= 100
        ? Number(setting('PRIVY_EARN_FEE_PERCENT')) : null,
      liquidityUsd: vault.available_liquidity_usd ?? null,
      position,
      risk: 'Yield is variable. Smart-contract losses and withdrawal delays are possible. This is not a bank deposit.',
    };
  }
  const bankCountries = {
    AT:'AUT', BE:'BEL', BG:'BGR', HR:'HRV', CY:'CYP', CZ:'CZE', DK:'DNK',
    EE:'EST', FI:'FIN', FR:'FRA', DE:'DEU', GR:'GRC', HU:'HUN', IS:'ISL',
    IE:'IRL', IT:'ITA', LV:'LVA', LI:'LIE', LT:'LTU', LU:'LUX', MT:'MLT',
    NL:'NLD', NO:'NOR', PL:'POL', PT:'PRT', RO:'ROU', SK:'SVK', SI:'SVN',
    ES:'ESP', SE:'SWE', CH:'CHE', GB:'GBR', AD:'AND',
  };
  const bankPath = (row) => '/v1/users/' + encodeURIComponent(row.privy_user_id);
  async function bankOwner(userId, token) {
    const c = await config();
    if (!c.bankWithdrawalsAvailable) throw fail('Bank withdrawals are not enabled yet.', 'NOT_SET_UP');
    const row = await owned(userId);
    if (!bankCountries[row.country]) throw fail('EUR bank withdrawals are currently available for supported European countries.');
    if (token !== undefined) {
      const proof = await identity(userId, token);
      if (proof.did !== row.privy_user_id) throw fail('Your wallet owner could not be verified.', 'VERIFY');
      await verifyWalletOwner(row, proof.did);
    }
    return row;
  }
  function bankAccountView(a) {
    return { id: a.id, currency: 'EUR', last4: a.last_4 || null,
      label: (a.bank_name || 'Bank account') + (a.last_4 ? ' ····' + a.last_4 : '') + ' · EUR' };
  }
  function validBankAccount(a, row) {
    return !!a && typeof a.id === 'string' && a.user_id === row.privy_user_id &&
      a.provider === 'bridge' && a.environment === 'production' && a.currency === 'eur' && a.account_type === 'iban';
  }
  async function bankVerification(row) {
    const result = await request(bankPath(row) + '/kyc');
    if (!Array.isArray(result.kyc_statuses)) throw fail('Your bank verification could not be checked.', 'PROVIDER');
    const s = result.kyc_statuses.find(s => s.provider === 'bridge' && s.environment === 'production');
    const ready = s?.status === 'active' && s.tos?.status === 'approved' &&
      ['active', 'approved'].includes(s.kyc?.status) && s.capabilities?.payout_fiat === 'active' &&
      s.endorsements?.some(e => e.name === 'sepa' && e.status === 'approved');
    return { ready: !!ready, status: ready ? 'approved' : s?.kyc?.status || s?.status || 'not_started',
      termsAccepted: s?.tos?.status === 'approved' };
  }
  async function bankStatus(userId) {
    const row = await bankOwner(userId);
    const [verification, result] = await Promise.all([bankVerification(row),
      request(bankPath(row) + '/external_fiat_accounts?provider=bridge&environment=production')]);
    if (!Array.isArray(result.external_fiat_accounts)) throw fail('Your linked banks could not be loaded.', 'PROVIDER');
    return { available: true, currency: 'EUR', rail: 'SEPA', verification,
      accounts: result.external_fiat_accounts.filter(a => validBankAccount(a, row)).map(bankAccountView) };
  }
  function hostedBankLink(link) {
    try {
      const u = new URL(link);
      if (u.protocol === 'https:' && !u.username && !u.password &&
        (u.hostname === 'bridge.xyz' || u.hostname.endsWith('.bridge.xyz') || u.hostname === 'bridge.withpersona.com')) return u.href;
    } catch {}
    throw fail('The bank verification link could not be verified.', 'PROVIDER');
  }
  async function bankVerify(userId, input, token) {
    if (input?.consent !== true) throw fail('Confirm that Bridge may use your wallet identity and email for bank verification.');
    if (!token) throw fail('Confirm your wallet identity first.', 'VERIFY');
    const row = await bankOwner(userId, token), state = await bankVerification(row);
    if (state.ready) return { completed: true };
    if (!state.termsAccepted) {
      const tos = await request(bankPath(row) + '/kyc/tos', { method: 'POST', body: { provider: 'bridge', environment: 'production' } });
      if (tos.provider !== 'bridge' || tos.environment !== 'production') throw fail('Your bank terms could not be verified.', 'PROVIDER');
      return { step: 'terms', url: hostedBankLink(tos.link) };
    }
    const kyc = await request(bankPath(row) + '/kyc/links', { method: 'POST', body: {
      provider: 'bridge', environment: 'production', endorsements: ['sepa'], redirect_uri: bankReturnUrl(),
    } });
    if (kyc.provider !== 'bridge' || kyc.environment !== 'production') throw fail('Your bank verification could not be verified.', 'PROVIDER');
    return { step: 'identity', url: hostedBankLink(kyc.kyc?.link) };
  }
  function bankReturnUrl() {
    try {
      const origin = new URL(setting('SITE_URL')).origin;
      if (['https://belna.se', 'http://localhost:8000'].includes(origin)) return origin + '/app';
    } catch {}
    return 'https://belna.se/app';
  }
  async function verifiedBankAccount(userId, id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw fail('Choose your linked bank account.');
    const row = await bankOwner(userId);
    if (!(await bankVerification(row)).ready) throw fail('Complete your identity verification for EUR bank withdrawals first.');
    const result = await request(bankPath(row) + '/external_fiat_accounts/' + encodeURIComponent(id));
    const a = result.external_fiat_account;
    if (!validBankAccount(a, row) || a.id !== id) throw fail('This bank account does not belong to your verified wallet.', 'VERIFY');
    return a;
  }
  async function bankRegister(userId, input, token) {
    if (!token) throw fail('Confirm your wallet identity first.', 'VERIFY');
    if (input?.consent !== true) throw fail('Confirm this is your own bank account and approve sharing these bank details with Bridge.');
    const row = await bankOwner(userId, token);
    if (!(await bankVerification(row)).ready) throw fail('Complete your identity verification for EUR bank withdrawals first.');
    const iban = String(input.iban || '').replace(/\s/g, '').toUpperCase();
    const bic = String(input.bic || '').trim().toUpperCase();
    const name = String(input.accountOwnerName || '').trim();
    if (!bankCountries[iban.slice(0,2)] || !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw fail('Enter a valid European IBAN that can receive EUR transfers.');
    let mod = 0;
    for (const c of iban.slice(4) + iban.slice(0,4)) {
      const digits = /[A-Z]/.test(c) ? String(c.charCodeAt(0)-55) : c;
      for (const digit of digits) mod = (mod*10 + Number(digit)) % 97;
    }
    if (mod !== 1) throw fail('Check your IBAN. Its check digits do not match.');
    if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) throw fail('Enter your bank’s 8 or 11 character BIC / SWIFT code.');
    if (name.length < 2 || name.length > 200 || /[\x00-\x1f]/.test(name)) throw fail('Enter the full account holder name shown by your bank.');
    const result = await request(bankPath(row) + '/external_fiat_accounts', { method: 'POST', body: {
      provider: 'bridge', environment: 'production', currency: 'eur', account_owner_name: name,
      account: { type: 'iban', account_number: iban, bic, country: bankCountries[iban.slice(0,2)] },
    } });
    if (!validBankAccount(result.external_fiat_account, row)) throw fail('Your linked bank could not be verified. Refresh before trying again.', 'PROVIDER');
    return bankStatus(userId);
  }
  async function reconcile(userId, intent) {
    if (intent.provider_action_id && intent.status === 'processing') {
      const row = await owned(userId),
        action = await request(
          '/v1/wallets/' +
            encodeURIComponent(row.wallet_id) +
            '/actions/' +
            encodeURIComponent(intent.provider_action_id) +
            '?include=steps',
        );
      if (
        action.wallet_id !== row.wallet_id ||
        !['pending', 'succeeded', 'rejected', 'failed'].includes(action.status)
      )
        throw fail('The wallet action could not be verified.', 'PROVIDER');
      const hash = action.steps
        ?.filter((s) => s.type === 'evm_transaction')
        .at(-1)?.transaction_hash;
      // A failed bank leg after crypto submission needs provider reconciliation.
      // Keep its reservation and never create a second payout automatically.
      const bankReview = intent.kind === 'bank_withdraw' && action.status === 'failed' && !!hash;
      intent = await store.updatePrivyIntent(userId, intent.id, {
        status: action.status === 'pending' || bankReview ? 'processing' : action.status,
        ...(intent.kind === 'bank_withdraw' ? { provider_review_required: bankReview } : {}),
        ...(/^0x[a-fA-F0-9]{64}$/.test(hash || '') ? { transaction_hash: hash.toLowerCase() } : {}),
      });
    }
    return intent;
  }
  async function transactions(row) {
    const feed = await request(
      '/v1/wallets/' +
        encodeURIComponent(row.wallet_id) +
        '/transactions?chain=base&token=' +
        BASE_USDC.toLowerCase() +
        '&limit=50',
    );
    if (!Array.isArray(feed.transactions))
      throw fail('Wallet activity is temporarily unavailable.', 'PROVIDER');
    return feed.transactions
      .filter(
        (t) =>
          t.wallet_id === row.wallet_id &&
          t.caip2 === 'eip155:8453' &&
          (t.details?.asset === 'usdc' ||
            t.details?.asset?.toLowerCase() === BASE_USDC.toLowerCase()) &&
          t.details.chain === 'base' &&
          t.details.raw_value_decimals === 6 &&
          /^\d+$/.test(t.details.raw_value || '') &&
          Number.isFinite(Number(t.details.raw_value)) &&
          Number.isSafeInteger(t.created_at) &&
          t.created_at >= 0 &&
          t.created_at <= 8640000000000000 &&
          ((t.details.type === 'transfer_received' &&
            t.details.recipient?.toLowerCase() === row.address) ||
            (t.details.type === 'transfer_sent' &&
              t.details.sender?.toLowerCase() === row.address)),
      )
      .map((t) => ({
        title: t.details.type === 'transfer_received' ? 'Received money' : 'Sent money',
        amount: Number(t.details.raw_value) / 1e6,
        currency: 'USD',
        asset: 'USDC',
        direction: t.details.type === 'transfer_received' ? 'incoming' : 'outgoing',
        at: new Date(t.created_at).toISOString(),
        status: ['confirmed', 'finalized'].includes(t.status) ? 'succeeded' : t.status,
        transactionHash: /^0x[0-9a-fA-F]{64}$/.test(t.transaction_hash || '')
          ? t.transaction_hash.toLowerCase()
          : null,
      }));
  }
  async function snapshot(userId) {
    const c = await config();
    const [row, legacy] = await Promise.all([
      c.configured ? store.getPrivyWallet(userId) : null,
      store.getBelnaWallet && store.supaConfigured() ? store.getBelnaWallet(userId) : null,
    ]);
    if (!row)
      return {
        wallet: {
          ...c,
          kind: 'privy',
          status: c.configured ? 'not_created' : 'unavailable',
          cardProgramAvailable: false,
          card: null,
          balance: null,
          legacyWallet: !!legacy?.account_id,
        },
        transactions: [],
        intents: [],
      };
    checkedRow(userId, row);
    // Only independent reads run together. Every transfer still rechecks live
    // balances, verification and ownership before its exact request is signed.
    const amountTask = balance(row).then(amount => {
      if (!Number.isFinite(amount) || amount < 0) throw fail('Your USD balance could not be loaded.', 'PROVIDER');
      return amount;
    });
    const intentsTask = store.listPrivyIntents(userId).then(async saved => {
      const intents = [];
      for (let start = 0; start < saved.length; start += 5) {
        const group = await Promise.allSettled(saved.slice(start, start + 5).map(i => reconcile(userId, i)));
        group.forEach((r, n) => intents.push(r.status === 'fulfilled' ? r.value : saved[start + n]));
      }
      return intents;
    });
    let balanceHistoryError, activityError;
    const historyTask = amountTask.then(amount => store.recordPrivyBalance(userId, amount)).catch(() => {
      balanceHistoryError = 'Balance history is temporarily unavailable.';
      return [];
    });
    const earnTask = earn(userId, row).catch(() => ({
        available: false,
        reason: 'Earn information could not be verified. Refresh to try again.',
        apy: null,
        position: null,
    }));
    const activityTask = transactions(row).catch(() => {
      activityError = 'Onchain activity is temporarily unavailable. Recorded requests remain below.';
      return [];
    });
    const [amount, intents, history, earnView, onchain] = await Promise.all([
      amountTask, intentsTask, historyTask, earnTask, activityTask,
    ]);
    const tracked = intents
      .filter((i) => !['quoted', 'awaiting_owner', 'canceled'].includes(i.status))
      .map((i) => ({
        ...view(i),
        direction: i.kind === 'earn_withdraw' ? 'incoming' : 'outgoing',
        transactionHash: i.transaction_hash || null,
        title:
          i.kind === 'withdraw' || i.kind === 'bank_withdraw'
            ? (i.kind === 'bank_withdraw' ? 'Withdrawal to bank' : 'Withdrawal')
            : i.kind === 'earn_deposit'
              ? 'Earn deposit'
              : i.kind === 'earn_withdraw'
                ? 'Earn withdrawal'
                : 'Sent money',
      }));
    const knownHashes = new Set(tracked.map((i) => i.transactionHash).filter(Boolean));
    return {
      wallet: {
        ...c,
        kind: 'privy',
        status: 'ready',
        address: row.address,
        walletId: row.wallet_id,
        country: row.country,
        cardProgramAvailable: false,
        cardReady: false,
        agentCardPayments: false,
        card: null,
        balance: { currency: 'USD', asset: 'USDC', available: amount, pending: 0 },
        dailyTransferLimitUsd: Number(row.daily_limit_usd),
        paused: row.paused,
        legacyWallet: !!legacy?.account_id,
        withdrawalsAvailable: true,
      },
      earn: earnView,
      intents: intents
        .filter(
          (i) =>
            ['quoted', 'awaiting_owner', 'processing'].includes(i.status) &&
            (i.status === 'processing' || Date.parse(i.expires_at) > now()),
        )
        .map(view),
      transactions: tracked,
      activity: [...tracked, ...onchain.filter((t) => !knownHashes.has(t.transactionHash))],
      balanceHistory: history.map((h) => ({
        at: h.day + 'T00:00:00.000Z',
        total: Number(h.available),
      })),
      ...(balanceHistoryError ? { balanceHistoryError } : {}),
      ...(activityError ? { activityError } : {}),
    };
  }
  function amount(value) {
    const s = String(value);
    if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(s) || Number(s) < 0.01 || Number(s) > 2000)
      throw fail('Choose an amount from $0.01 to $2,000 with at most two decimal places.');
    return Number(s).toFixed(2);
  }
  async function transferQuote(userId, input = {}) {
    const row = await owned(userId);
    if (row.paused) throw fail('Wallet transfers are paused. Resume them in Wallet settings.');
    const value = amount(input.amount),
      kind = input.kind || 'send';
    if (!['send', 'withdraw', 'bank_withdraw', 'earn_deposit', 'earn_withdraw'].includes(kind))
      throw fail('Choose a valid wallet action.');
    let recipient = String(input.recipient || '').trim(),
      destination = null,
      vaultId = null, fiatAccountId = null;
    if (kind === 'send' || kind === 'withdraw') {
      if (/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
        destination = recipient.toLowerCase();
        recipient = destination;
      } else if (kind === 'send') {
        recipient = recipient.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
          throw fail('Enter a Belna email or Base wallet address.');
        const target = await store.findPrivyRecipient(recipient);
        if (!target || target.user_id === userId)
          throw fail('The recipient needs a confirmed Belna Wallet.');
        destination = target.address;
      } else throw fail('Enter the Base wallet address to withdraw to.');
      if (
        destination === row.address ||
        destination === BASE_USDC.toLowerCase() ||
        /^0x0{40}$/.test(destination)
      )
        throw fail('Choose a valid recipient other than your wallet or the token contract.');
    } else if (kind === 'bank_withdraw') {
      const account = await verifiedBankAccount(userId, input.fiatAccountId);
      fiatAccountId = account.id;
      recipient = bankAccountView(account).label;
    } else {
      const e = await earn(userId);
      if (!e.available) throw fail(e.reason, 'NOT_SET_UP');
      vaultId = e.vaultId;
      recipient = e.name;
      if (kind === 'earn_withdraw' && (e.position?.available == null || Number(value) > e.position.available))
        throw fail('Your available Earn balance is too low.');
    }
    if (kind !== 'earn_withdraw' && Number(value) > (await balance(row)))
      throw fail('Your available USD balance is too low.');
    const quote = await store.createPrivyIntent(userId, {
      id: randomId(),
      wallet_id: row.wallet_id,
      kind,
      recipient,
      destination_address: destination,
      vault_id: vaultId,
      fiat_account_id: fiatAccountId,
      amount: value,
      status: 'quoted',
      expires_at: new Date(now() + 10 * 60000).toISOString(),
    });
    return view(quote);
  }
  async function send(userId, { quoteId, approvedDetail }) {
    const i = await store.getPrivyIntent(userId, quoteId);
    if (!i || approvedDetail !== JSON.stringify(view(i)))
      throw fail('Approve this exact wallet request first.');
    if (Date.parse(i.expires_at) <= now())
      throw fail('This wallet request expired. Review a new request.');
    if (i.status !== 'quoted') return view(i);
    const saved = await store.markPrivyIntentAwaitingOwner(userId, i.id);
    return view(saved || (await store.getPrivyIntent(userId, i.id)));
  }
  async function prepare(userId, { quoteId, confirm, riskAccepted }, token) {
    if (confirm !== true) throw fail('Review and confirm this exact request.');
    const row = await owned(userId);
    const proof = await identity(userId, token);
    if (proof.did !== row.privy_user_id)
      throw fail('Your wallet owner could not be verified.', 'VERIFY');
    let i = await store.getPrivyIntent(userId, quoteId);
    if (!i || i.wallet_id !== row.wallet_id) throw fail('That wallet request was not found.');
    if (i.provider_action_id) {
      i = await reconcile(userId, i);
      return { intent: view(i) };
    }
    if (
      !['quoted', 'awaiting_owner', 'processing'].includes(i.status) ||
      (Date.parse(i.expires_at) <= now() && i.status !== 'processing')
    )
      throw fail('This request is no longer available.');
    if (
      i.status === 'processing' &&
      (!Number.isFinite(Date.parse(i.started_at)) ||
        now() - Date.parse(i.started_at) >= 23 * 3600000)
    )
      throw fail(
        'This uncertain request needs provider reconciliation. Contact support before sending again.',
        'REVIEW',
      );
    if (row.paused && i.status !== 'processing') throw fail('Wallet transfers are paused. Resume them in Wallet settings.');
    await verifyWalletOwner(row, proof.did);
    if (i.kind.startsWith('earn_') && riskAccepted !== true)
      throw fail('Review and accept the Earn risks first.');
    if (i.kind.startsWith('earn_')) {
      const e = await earn(userId);
      if (!e.available || e.vaultId !== i.vault_id)
        throw fail('The approved Earn vault changed. Review a new request.');
      if (i.kind === 'earn_withdraw' && (e.position?.available == null || Number(i.amount) > e.position.available))
        throw fail('Your available Earn balance is too low.');
    }
    if (i.kind === 'bank_withdraw') {
      const account = await verifiedBankAccount(userId, i.fiat_account_id);
      if (bankAccountView(account).label !== i.recipient) throw fail('Your bank account changed. Review a new request.');
    }
    const expiry = String(now() + 5 * 60000),
      path =
        '/v1/wallets/' +
        encodeURIComponent(row.wallet_id) +
        (i.kind === 'earn_deposit'
          ? '/earn/ethereum/deposit'
          : i.kind === 'earn_withdraw'
            ? '/earn/ethereum/withdraw'
            : i.kind === 'bank_withdraw' ? '/payout/fiat' : '/transfer');
    const exactAmount = amount(i.amount);
    const body = i.kind.startsWith('earn_')
      ? { vault_id: i.vault_id, amount: exactAmount }
      : {
          source: { asset: 'usdc', chain: 'base', amount: exactAmount },
          destination: i.kind === 'bank_withdraw'
            ? { fiat_account_id: i.fiat_account_id, payment_rail: 'sepa' }
            : { address: i.destination_address, chain: 'base', asset: 'usdc' },
        };
    return {
      intent: view(i),
      request: {
        version: 1,
        method: 'POST',
        url: API + path,
        body,
        headers: {
          'privy-app-id': setting('PRIVY_APP_ID'),
          'privy-idempotency-key': i.id,
          'privy-request-expiry': expiry,
        },
      },
    };
  }
  async function confirmTransfer(userId, input = {}, token) {
    const signature = input.signature;
    if (typeof signature !== 'string' || signature.length > 4000 || signature.length < 20)
      throw fail('Authorize this request in your own wallet first.', 'VERIFY');
    const prepared = await prepare(userId, { ...input, confirm: true }, token);
    if (!prepared.request) return prepared.intent;
    // Rebuild the request on the server; only its expiry comes from the signing step.
    const expiry = String(input.expiry || '');
    if (!/^\d{13}$/.test(expiry) || Number(expiry) <= now() || Number(expiry) > now() + 5 * 60000)
      throw fail('Wallet authorization expired. Review the same request again.');
    const i = await store.beginPrivyIntent(userId, input.quoteId);
    if (!i || i.wallet_id !== (await owned(userId)).wallet_id)
      throw fail('This request could not be reserved.', 'WALLET_STORE');
    if (i.provider_action_id) return view(await reconcile(userId, i));
    const r = prepared.request;
    const action = await request(r.url.slice(API.length), {
      method: 'POST',
      body: r.body,
      signature,
      key: i.id,
      expiry,
    });
    const expectedType =
      i.kind === 'earn_deposit'
        ? 'earn_deposit'
        : i.kind === 'earn_withdraw'
          ? 'earn_withdraw'
          : i.kind === 'bank_withdraw' ? 'payout' : 'transfer';
    if (
      typeof action.id !== 'string' ||
      action.wallet_id !== i.wallet_id ||
      action.type !== expectedType ||
      !['pending', 'succeeded', 'failed', 'rejected'].includes(action.status)
    )
      throw fail('Wallet status is uncertain. Check this same request.', 'PROVIDER');
    const bankReview = i.kind === 'bank_withdraw' && action.status === 'failed' && action.steps?.some(s => s.type === 'evm_transaction' && s.transaction_hash);
    return view(
      await store.updatePrivyIntent(userId, i.id, {
        provider_action_id: action.id,
        status: action.status === 'pending' || bankReview ? 'processing' : action.status,
        ...(bankReview ? { provider_review_required: true } : {}),
      }),
    );
  }
  async function updateCard(userId, input = {}) {
    await owned(userId);
    const fields = {};
    if (Object.hasOwn(input, 'frozen')) {
      if (typeof input.frozen !== 'boolean') throw fail('Choose a valid pause setting.');
      fields.paused = input.frozen;
    }
    if (Object.hasOwn(input, 'dailyLimitUsd')) {
      const v = amount(input.dailyLimitUsd);
      if (Number(v) > 50) throw fail('The 24-hour transfer limit is at most $50.');
      fields.daily_limit_usd = v;
    }
    if (!Object.keys(fields).length) throw fail('Choose a wallet control.');
    await store.updatePrivyWallet(userId, fields);
    return snapshot(userId);
  }
  async function cancel(userId, { quoteId }) {
    const i = await store.getPrivyIntent(userId, quoteId);
    if (!i || !['quoted', 'awaiting_owner'].includes(i.status))
      throw fail('Only an unsigned wallet request can be canceled.');
    const canceled = await store.cancelPrivyIntent(userId, i.id);
    if (!canceled)
      throw fail('This request was already reserved. Check its status before starting another.');
    return view(canceled);
  }
  const unavailable = async () => {
    throw fail('Cards are coming soon. Apply interest in Wallet.', 'NOT_SET_UP');
  };
  const retired = async () => {
    throw fail('This wallet flow has been replaced by your user-owned Belna Wallet.', 'NOT_SET_UP');
  };
  return {
    ...shared,
    configured,
    config,
    setup,
    snapshot,
    transferQuote,
    send,
    prepare,
    confirmTransfer,
    cancel,
    earn,
    bankStatus,
    bankVerify,
    bankRegister,
    updateCard,
    deposit: async (userId) => {
      const row = await owned(userId);
      return { address: row.address, chainId: BASE_CHAIN, asset: 'USDC' };
    },
    savePreferences: async (userId, input) => {
      if (input.activeMethod === 'belna_wallet')
        throw fail(
          'Wallet cards are coming soon. Use your existing payment methods.',
          'NOT_SET_UP',
        );
      return shared.savePreferences(userId, input);
    },
    preferences: async (userId) => {
      const p = await shared.preferences(userId);
      if (p.activeMethod === 'belna_wallet')
        return {
          ...p,
          activeMethod: null,
          spendingMethod:
            p.methods.payment_apps || p.methods.shop_pay || p.methods.saved_card
              ? 'existing_card'
              : null,
          methods: { ...p.methods, belna_wallet: false },
        };
      return p;
    },
    verify: retired,
    verificationSession: retired,
    finishConnect: retired,
    depositSession: retired,
    withdrawalSession: retired,
    legacyWithdrawalSession: retired,
    connectCard: unavailable,
    cardSession: unavailable,
    executePurchase: unavailable,
    connectionInfo: async () => ({ platformAccountId: null, environment: 'privy' }),
    reconcilePurchases: async () => [],
    reconcilePurchaseCard: async () => {},
    reconcileConnectionCards: async () => [],
    checkProviderConnection: config,
  };
}
module.exports = { createPrivyWallet, BASE_USDC, BASE_CHAIN };
