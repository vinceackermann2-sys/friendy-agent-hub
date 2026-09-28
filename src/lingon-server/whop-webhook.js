// Standard Webhooks v1 verification. The caller must pass the untouched body.
async function verifyWhopWebhook(rawBody, headers, secret, now = Date.now()) {
  const fail = () => Object.assign(new Error('Invalid Whop webhook.'), { code:'BAD_SIGNATURE' });
  if (typeof rawBody !== 'string' || !secret || !secret.startsWith('ws_')) throw fail();
  const encoder = new TextEncoder();
  if (encoder.encode(rawBody).length > 262144) throw fail();
  const id = String(headers['webhook-id'] || ''), timestamp = String(headers['webhook-timestamp'] || '');
  const signatures = String(headers['webhook-signature'] || '').split(/\s+/).filter(x => x.startsWith('v1,')).map(x => x.slice(3));
  if (!/^msg_[a-zA-Z0-9]+$/.test(id) || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !signatures.length) throw fail();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(id + '.' + timestamp + '.' + rawBody)));
  const valid = signatures.some(value => {
    let bytes;
    try { bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { return false; }
    if (bytes.length !== signed.length) return false;
    let mismatch = 0;
    for (let i = 0; i < bytes.length; i++) mismatch |= bytes[i] ^ signed[i];
    return mismatch === 0;
  });
  if (!valid) throw fail();
  let event;
  try { event = JSON.parse(rawBody); } catch { throw fail(); }
  if (event?.id !== id || event?.api_version !== 'v1' || typeof event.type !== 'string') throw fail();
  return event;
}
export { verifyWhopWebhook };
