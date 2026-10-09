// The request about to be signed must be the one on the owner's screen, not only one that
// agrees with the server's own reply: a changed amount, address, bank or vault is refused.
export function assertSameAsReviewed(intent: any, reviewed: any) {
  for (const key of ['quoteId', 'kind', 'amount', 'address', 'fiatAccountId', 'vaultId'])
    if ((intent?.[key] ?? null) !== (reviewed?.[key] ?? null))
      throw Error('Your wallet request does not match the reviewed details. Review it again.');
}
// The SDK may sign only the exact USDC action displayed in the owner's review.
export function assertReviewedRequest(
  request: any,
  intent: any,
  quoteId: string,
  appId: string,
  now = Date.now(),
) {
  const keys = (value: any, expected: string[]) =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === expected.sort().join(',');
  const reject = () => {
    throw Error('Your wallet request does not match the reviewed details. Review it again.');
  };
  if (
    intent?.quoteId !== quoteId ||
    intent.asset !== 'USDC' ||
    intent.chainId !== 8453 ||
    !Number.isFinite(intent.amount) ||
    intent.amount <= 0 ||
    intent.amount > 2000
  )
    reject();
  if (
    !keys(request, ['version', 'method', 'url', 'body', 'headers']) ||
    request.version !== 1 ||
    request.method !== 'POST'
  )
    reject();
  if (
    !keys(request.headers, ['privy-app-id', 'privy-idempotency-key', 'privy-request-expiry']) ||
    request.headers['privy-app-id'] !== appId ||
    request.headers['privy-idempotency-key'] !== quoteId
  )
    reject();
  const expiry = Number(request.headers['privy-request-expiry']);
  if (
    !/^\d{13}$/.test(request.headers['privy-request-expiry']) ||
    expiry <= now ||
    expiry > now + 6 * 60000
  )
    reject();
  const earn = ['earn_deposit', 'earn_withdraw'].includes(intent.kind), bank = intent.kind === 'bank_withdraw',
    action = earn
      ? 'earn/ethereum/' + (intent.kind === 'earn_deposit' ? 'deposit' : 'withdraw')
      : bank ? 'payout/fiat' : 'transfer';
  if (
    !['send', 'withdraw', 'bank_withdraw', 'earn_deposit', 'earn_withdraw'].includes(intent.kind) ||
    typeof request.url !== 'string' ||
    !new RegExp('^https://api\\.privy\\.io/v1/wallets/[^/?#]+/' + action + '$').test(request.url)
  )
    reject();
  const body = request.body,
    amount = earn ? body?.amount : body?.source?.amount;
  if (
    typeof amount !== 'string' ||
    !/^\d+\.\d{2}$/.test(amount) ||
    Number(amount) !== intent.amount
  )
    reject();
  if (earn) {
    if (!keys(body, ['vault_id', 'amount']) || !intent.vaultId || body.vault_id !== intent.vaultId)
      reject();
  } else if (bank) {
    if (!keys(body, ['source', 'destination']) || !keys(body.source, ['asset', 'chain', 'amount']) ||
      body.source.asset !== 'usdc' || body.source.chain !== 'base' ||
      !keys(body.destination, ['fiat_account_id', 'payment_rail']) ||
      !intent.fiatAccountId || body.destination.fiat_account_id !== intent.fiatAccountId ||
      intent.bankCurrency !== 'EUR' || intent.paymentRail !== 'sepa' || body.destination.payment_rail !== 'sepa') reject();
  } else if (
    !keys(body, ['source', 'destination']) ||
    !keys(body.source, ['asset', 'chain', 'amount']) ||
    !keys(body.destination, ['address', 'chain', 'asset']) ||
    body.source.asset !== 'usdc' ||
    body.source.chain !== 'base' ||
    body.destination.asset !== 'usdc' ||
    body.destination.chain !== 'base' ||
    body.destination.address !== intent.address ||
    !/^0x[0-9a-f]{40}$/.test(intent.address)
  )
    reject();
}
