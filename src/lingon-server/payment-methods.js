// Display metadata for cards already saved with a merchant. No PAN, CVC or
// payment token ever enters this store; the merchant handles the actual card.
function createPaymentMethods({ supa, loadLocal, saveLocal, ensureProfile, uid }) {
  const bad = (message) => Object.assign(new Error(message), { code: 'BAD_INPUT' });
  const persistence = () => Object.assign(new Error('Payment methods could not be saved. Try again.'), { code: 'PERSISTENCE' });
  function host(value) {
    try {
      const raw = String(value || '').trim();
      const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.')) throw bad('Enter a public HTTPS merchant website.');
      return url.hostname.toLowerCase().replace(/^www\./, '');
    } catch { throw bad('Enter a public HTTPS merchant website.'); }
  }
  function input(value) {
    const merchant = host(value?.merchant);
    const brand = String(value?.brand || '').trim().slice(0, 32);
    const last4 = String(value?.last4 || '').trim();
    const label = String(value?.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (/(?:\d[ -]?){13,19}/.test(`${brand} ${label}`)) throw bad('Only masked card details can be saved here.');
    if (!/^[\p{L}\p{N} .-]{2,32}$/u.test(brand)) throw bad('Enter the card brand shown by the merchant.');
    if (!/^\d{4}$/.test(last4)) throw bad('Enter only the card’s last four digits.');
    if (!label) throw bad('Give this payment method a short name.');
    return { merchant, brand, last4, label };
  }
  const publicRow = (row) => ({ id: row.id, merchant: row.merchant, brand: row.brand, last4: row.last4, label: row.label,
    at: new Date(row.created_at || row.at || Date.now()).getTime() });
  async function list(userId) {
    const db = supa();
    if (db) {
      const { data, error } = await db.from('merchant_payment_methods').select('id,merchant,brand,last4,label,created_at').eq('user_id', userId).order('created_at', { ascending: false });
      if (error) throw persistence();
      return (data || []).map(publicRow);
    }
    return (loadLocal().merchantPaymentMethods || []).filter((row) => row.userId === userId).map(publicRow);
  }
  async function get(userId, id) {
    return (await list(userId)).find((row) => row.id === id) || null;
  }
  async function add(userId, value) {
    const clean = input(value);
    const row = { id: `pm_${uid()}`, user_id: userId, ...clean };
    const db = supa();
    if (db) {
      await ensureProfile(userId);
      const { data, error } = await db.from('merchant_payment_methods').insert(row).select('id,merchant,brand,last4,label,created_at').single();
      if (error) throw persistence();
      return publicRow(data);
    }
    const local = loadLocal();
    local.merchantPaymentMethods ||= [];
    local.merchantPaymentMethods.unshift({ ...row, userId, at: Date.now() });
    saveLocal(local);
    return publicRow(local.merchantPaymentMethods[0]);
  }
  async function remove(userId, id) {
    const db = supa();
    if (db) {
      const { error } = await db.from('merchant_payment_methods').delete().eq('user_id', userId).eq('id', id);
      if (error) throw persistence();
      return;
    }
    const local = loadLocal();
    local.merchantPaymentMethods = (local.merchantPaymentMethods || []).filter((row) => !(row.userId === userId && row.id === id));
    saveLocal(local);
  }
  return { listPaymentMethods: list, getPaymentMethod: get, addPaymentMethod: add, deletePaymentMethod: remove };
}
export { createPaymentMethods };
