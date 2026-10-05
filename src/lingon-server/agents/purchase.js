// The final browser click is bound to the current checkout page and to the
// owner's exact review card. Payment is Shop Pay, a card the owner already saved
// in the merchant account (shown masked), or a payment app (Klarna, Swish, PayPal,
// Afterpay, Sezzle…) that the owner approves themselves. No card data, password or
// code is stored or typed by the agent.
import crypto from 'node:crypto';
import { cardNumberIn } from './payment-safety.js';
// Payment apps and pay-later providers the owner approves themselves (in their app, with a
// QR code, BankID or their own sign-in) after the order is placed. Apple Pay and Google Pay
// are left out: they need the owner's own device, so the agent's browser cannot use them.
const PAYMENT_APPS = /\b(?:swish|klarna|paypal|venmo|afterpay|clearpay|sezzle|affirm|zip(?! ?code)|vipps|mobilepay|twint|ideal|bancontact|blik|mb ?way|satispay|trustly|walley|qliro|svea|bizum|amazon pay|cash app pay|revolut pay)\b/i;
// The Wallet switch each purchase method needs.
const METHOD_SWITCH = { payment_app: 'payment_apps', shop_pay: 'shop_pay', saved_card: 'saved_card', belna_wallet: 'belna_wallet' };
const METHOD_NAMES = { payment_app: 'Payment apps', shop_pay: 'Shop Pay', saved_card: 'Paying with a card saved in the store', belna_wallet: 'Belna Wallet card' };
function createPurchaseFlow({ live, wallet }) {
  const bad = (message) => Object.assign(new Error(message), { code: 'BAD_INPUT' });
  const purchaseWords = /\b(?:buy|purchase|checkout|place order|pay now|confirm order|köp|kassa|betala|bekräfta köp|beställ)\b/i;
  const checkoutContext = /\b(?:checkout|order total|payment method|shipping address|place order|your basket|your cart|kassa|ordersumma|betalningssätt|leveransadress|slutför köp|beställning)\b/i;
  const CHOICE = /^\[\d+\] (?:input:(?:radio|checkbox|text|email|tel|number|search)|select|textarea|radio|checkbox|option|combobox|switch|textbox) /;
  const choiceTarget = (session, args) => CHOICE.test(targetLine(session, args))
    || (args.type === 'click_text' && !!args.text && (session.elements || []).some((line) => CHOICE.test(line) && flat(line).includes(flat(args.text))));
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
    // Choosing an option or filling a field ("Klarna – pay later", a delivery choice) never
    // places the order; clicking one is a normal step. Pressing Enter in a field may submit.
    if (choiceTarget(session, args) && ['click','double_click','click_text'].includes(args.type)) return;
    if (/\b(?:place order|pay now|buy now|complete purchase|confirm purchase|köp nu|betala nu|slutför köp|bekräfta köp|beställ nu)\b/i.test(target)
      || (checkoutContext.test(session.text || '') && (!targetLine(session,args) || /\b(?:buy|purchase|pay|order|köp|betala|beställ|confirm|bekräfta)\b/i.test(target))))
      throw bad('This may place an order. Use browser_submit with full purchase details for owner approval.');
  }
  async function details(args, userId, session) {
    const host = pageHost(session.url);
    if (!host || !session.url.startsWith('https://')) throw bad('Purchases require an HTTPS merchant page.');
    const input = args.purchase;
    if (!input || typeof input !== 'object') {
      if (purchaseWords.test(`${args.summary || ''} ${targetLine(session, args)}`) || checkoutContext.test(session.text || '')) throw bad('A purchase needs the items, total, shipping address and the payment method selected at checkout (Swish, Klarna, Shop Pay or a saved merchant card) before approval.');
      return null;
    }
    // The approval is for the click that places the order, never for choosing an option.
    if (choiceTarget(session, args)) throw bad('That only chooses an option. Select it with browser_action, then use browser_submit on the button that places the order.');
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
    const shippingAddress = String(input.shippingAddress || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || !/^[A-Z]{3}$/.test(currency) || shippingAddress.length < 8) throw bad('Purchase needs a valid total, currency and delivery address.');
    const shippingAddressId=String(input.shippingAddressId || '');
    // The saved address's own parts: a checkout shows an address its own way (lines, spacing),
    // so the private checkout compares these, not the formatted line.
    let shippingAddressParts=null;
    if(wallet?.addresses) {
      const saved=(await wallet.addresses(userId)).addresses;
      if(saved.length || shippingAddressId) {
        const address=saved.find(a=>a.id===shippingAddressId);
        if(!address || flat(address.formatted)!==flat(shippingAddress)) throw bad('Use shipping_addresses to select a current saved address and copy its formatted address before approval.');
        shippingAddressParts={recipient:address.recipient,line1:address.line1,line2:address.line2 || '',postalCode:address.postalCode,city:address.city};
      }
    }
    const paymentMethod = Object.hasOwn(METHOD_SWITCH, input.payment?.method) ? input.payment.method : '';
    // Each method is off until the owner turns it on in Wallet; the server checks it here,
    // whatever the model was told. Payment apps also wait for the owner's own approval.
    const app = paymentMethod === 'payment_app';
    if(paymentMethod && wallet?.preferences){
      const selection=await wallet.preferences(userId);
      if(!selection.methods?.[METHOD_SWITCH[paymentMethod]])throw bad(`${METHOD_NAMES[paymentMethod]} is turned off. Ask the owner to turn it on in Settings → Wallet before purchasing.`);
    }
    const payment = String(input.payment?.label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!paymentMethod) throw bad('Pay with a payment app the owner approves (Klarna, Swish, PayPal, Afterpay…), Shop Pay, or a card already saved in the merchant account. Never enter card details.');
    if (!payment || /\d{5,}/.test(payment.replace(/[ -]/g, '')) || cardNumberIn(payment)) throw bad('Copy the payment method as the checkout shows it, for example "Klarna", "PayPal", "Shop Pay" or "Visa ending in 1234". Never include a full card number.');
    if (app && !PAYMENT_APPS.test(payment)) throw bad('That is not a payment app the owner approves themselves. Select one such as Klarna, Swish, PayPal, Afterpay or Sezzle and copy its label as shown; never type card details.');
    if (paymentMethod === 'belna_wallet') {
      if (!wallet || !(await wallet.snapshot(userId)).wallet.agentCardPayments) throw bad('Belna Wallet checkout is not enabled yet. Use an existing saved card.');
      if (currency !== 'USD' || payment !== 'Belna Wallet') throw bad('Belna Wallet purchases currently require USD and the label Belna Wallet.');
    } else if (!flat(`${session.text || ''}\n${(session.elements || []).join('\n')}`).includes(flat(payment))) throw bad('Select the payment method on the checkout page first, then copy its label exactly as shown.');
    return { merchant: host, website: session.url, items, amount, currency, shippingAddress,
      payment, paymentMethod, ...(shippingAddressId ? {shippingAddressId} : {}), ...(shippingAddressParts ? {shippingAddressParts} : {}),
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
// After a payment-app order is placed, the payment waits for the owner's own approval.
function withPhoneApproval(args, out) {
  const payment = args?.purchase?.payment;
  if (payment?.method !== 'payment_app' || !out || typeof out !== 'object') return out;
  const app = String(payment.label || 'the payment app').slice(0, 80);
  return { ...out, payment: { method:'payment_app', status: 'awaiting_owner', note: `The owner approves this payment with ${app} themselves. Wait, then read the page for the store's confirmation. If it shows a QR code, asks to open an app or another device, or asks the owner to sign in or enter personal details, call browser_auth_handoff with purpose payment so the owner does it (without that tool, tell the owner to finish it in the live browser in Canvas). Never type their details and never place this order again.` } };
}
export { createPurchaseFlow, withPhoneApproval, PAYMENT_APPS };
