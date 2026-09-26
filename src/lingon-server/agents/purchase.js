// The final browser click is bound to the current checkout page and to the
// owner's exact review card. Payment is always Shop Pay or a card the owner
// already saved in the merchant account; the merchant shows it masked and no
// card data is stored or typed by the agent.
import crypto from 'node:crypto';
import { cardNumberIn } from './payment-safety.js';
function createPurchaseFlow({ live }) {
  const bad = (message) => Object.assign(new Error(message), { code: 'BAD_INPUT' });
  const purchaseWords = /\b(?:buy|purchase|checkout|place order|pay now|confirm order|köp|kassa|betala|bekräfta köp|beställ)\b/i;
  const checkoutContext = /\b(?:checkout|order total|payment method|shipping address|place order|your basket|your cart|kassa|ordersumma|betalningssätt|leveransadress|slutför köp|beställning)\b/i;
  const flat = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const pageHost = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
  const pageKey = (session, args) => {
    const selected = args.ref ? (session.elements || []).find((line) => line.startsWith(`[${args.ref}]`)) || '' : '';
    const raw = `${session.url}\n${String(session.text || '').slice(-3500)}\n${(session.elements || []).join('\n').slice(0,6500)}\n${selected}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  };
  function targetLine(session, args) {
    return args.ref ? (session.elements || []).find((line) => line.startsWith(`[${args.ref}]`)) || '' : '';
  }
  function safeExcerpt(session) {
    if (session.ownerSensitive) return '';
    let text = String(session.text || '').slice(-650);
    for (const value of session.sensitiveValues || []) if (value) text = text.split(value).join('[protected]');
    return text.replace(/(?:\d[ -]?){13,19}/g, (match) => cardNumberIn(match) ? '[payment card]' : match);
  }
  async function beforeAction(args, { userId, sessionId }) {
    if (!['click','double_click','click_text','key','type'].includes(args.type)) return;
    if (args.type === 'type' && !args.submit) return;
    if (args.type === 'key' && !/enter|return/i.test(String(args.key || ''))) return;
    const session = await live.forTool(userId, sessionId, undefined, false);
    await live.content(session);
    const target = `${targetLine(session,args)} ${args.type==='click_text' ? args.text : ''}`;
    if (/\b(?:place order|pay now|buy now|complete purchase|confirm purchase|köp nu|betala nu|slutför köp|bekräfta köp|beställ nu)\b/i.test(target)
      || (checkoutContext.test(session.text || '') && (!targetLine(session,args) || /\b(?:buy|purchase|pay|order|köp|betala|beställ|confirm|bekräfta)\b/i.test(target))))
      throw bad('This may place an order. Use browser_submit with full purchase details for owner approval.');
  }
  async function details(args, userId, session) {
    const host = pageHost(session.url);
    if (!host || !session.url.startsWith('https://')) throw bad('Purchases require an HTTPS merchant page.');
    const input = args.purchase;
    if (!input || typeof input !== 'object') {
      if (purchaseWords.test(`${args.summary || ''} ${targetLine(session, args)}`) || checkoutContext.test(session.text || '')) throw bad('A purchase needs the items, total, shipping address and the Shop Pay or saved merchant card selected at checkout before approval.');
      return null;
    }
    const merchant = pageHost(input.website || `https://${host}`);
    if (merchant !== host) throw bad('Purchase website must match the current checkout website.');
    const items = (Array.isArray(input.items) ? input.items : []).slice(0, 12).map((item) => ({
      title: String(item?.title || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      quantity: Number(item?.quantity),
      price: Number(item?.price),
    }));
    if (!items.length || items.some((item) => !item.title || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 || !Number.isFinite(item.price) || item.price < 0)) throw bad('Purchase items need titles, quantities and prices.');
    const amount = Number(input.amount);
    const currency = String(input.currency || '').toUpperCase();
    const shippingAddress = String(input.shippingAddress || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || !/^[A-Z]{3}$/.test(currency) || shippingAddress.length < 8) throw bad('Purchase needs a valid total, currency and delivery address.');
    const paymentMethod = ['shop_pay', 'saved_card'].includes(input.payment?.method) ? input.payment.method : '';
    const payment = String(input.payment?.label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!paymentMethod) throw bad('Pay with Shop Pay or a card already saved in the merchant account. Never enter card details.');
    if (!payment || /\d{5,}/.test(payment.replace(/[ -]/g, '')) || cardNumberIn(payment)) throw bad('Copy the payment method as the checkout shows it, for example "Shop Pay" or "Visa ending in 1234". Never include a full card number.');
    if (!flat(`${session.text || ''}\n${(session.elements || []).join('\n')}`).includes(flat(payment))) throw bad('Select Shop Pay or the saved card on the checkout page first, then copy its label exactly as shown.');
    return { merchant: host, website: session.url, items, amount, currency, shippingAddress,
      payment, paymentMethod,
      checkoutKey: pageKey(session, args), target: targetLine(session, args).slice(0, 200),
      pageExcerpt: safeExcerpt(session) };
  }
  async function approvalDetail(args, { userId, sessionId }) {
    const session = await live.forTool(userId, sessionId, undefined, false);
    await live.content(session);
    const purchase = await details(args, userId, session);
    return JSON.stringify(purchase || { summary: String(args.summary || '').slice(0, 300), website: session.url,
      checkoutKey: pageKey(session, args), target: targetLine(session, args).slice(0, 200) });
  }
  async function beforeSubmit(args, ctx) {
    if (!ctx.approvedDetail) throw bad('This final action needs a fresh owner approval.');
    let approved;
    try { approved = JSON.parse(ctx.approvedDetail); } catch { throw bad('Purchase approval is invalid.'); }
    const session = await live.forTool(ctx.userId, ctx.sessionId, ctx.trace, false);
    await live.content(session);
    if (approved.website !== session.url || approved.checkoutKey !== pageKey(session, args)) throw bad('Checkout changed after approval. Review the updated page and approve again.');
    const current = await details(args, ctx.userId, session);
    if (current && JSON.stringify({ ...current, pageExcerpt: '' }) !== JSON.stringify({ ...approved, pageExcerpt: '' })) throw bad('Purchase details changed after approval. Review again.');
    if (!!current !== !!approved.paymentMethod) throw bad('Purchase approval type changed. Review again.');
  }
  return { approvalDetail, beforeSubmit, beforeAction };
}
export { createPurchaseFlow };
