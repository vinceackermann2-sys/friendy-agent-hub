// The final browser click is bound to the current checkout page and to the
// owner's exact review card. Payment is a payment app (Klarna, Swish, Shop Pay, PayPal,
// Afterpay, Sezzle…) that the owner approves themselves, or a card the owner already saved
// in the merchant account (shown masked). No card data, password or code is stored or typed
// by the agent.
const crypto = require('crypto');
const { cardNumberIn } = require('./payment-safety');
// Payment apps and pay-later providers the owner approves themselves (in their app, with a
// QR code, BankID, their own sign-in or, for Shop Pay, the code Shop sends to their phone).
// Apple Pay and Google Pay are left out: they need the owner's own device, so the agent's
// browser cannot use them.
const PAYMENT_APPS = /\b(?:swish|klarna|shop ?pay|paypal|venmo|afterpay|clearpay|sezzle|affirm|zip(?! ?code)|vipps|mobilepay|twint|ideal|bancontact|blik|mb ?way|satispay|trustly|walley|qliro|svea|bizum|amazon pay|cash app pay|revolut pay)\b/i;
// The Wallet switch each purchase method needs. Shop Pay is one of the payment apps.
const METHOD_SWITCH = { payment_app: 'payment_apps', shop_pay: 'payment_apps', saved_card: 'saved_card', belna_wallet: 'belna_wallet' };
const METHOD_NAMES = { payment_app: 'Payment apps', shop_pay: 'Payment apps (Shop Pay is one of them)', saved_card: 'Paying with a card saved in the store', belna_wallet: 'Belna Wallet card' };
function createPurchaseFlow({ live, wallet }) {
  const bad = (message) => Object.assign(new Error(message), { code: 'BAD_INPUT' });
  const purchaseWords = /\b(?:buy|purchase|checkout|place order|pay now|confirm order|köp|kassa|betala|bekräfta köp|beställ)\b/i;
  const checkoutContext = /\b(?:checkout|order total|payment method|shipping address|place order|your basket|your cart|kassa|ordersumma|betalningssätt|leveransadress|slutför köp|beställning)\b/i;
  // The same rules for checkouts in other European languages: a German, French or Spanish
  // "place order" button is as final as an English one. Word edges are Unicode-aware, since
  // \b does not treat letters such as ø, ł or é as part of a word.
  const anyWord = (words) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
  const PURCHASE_WORDS_EU = anyWord(['kaufen','jetzt kaufen','bestellen','zur kasse','bezahlen','acheter','commander','payer','passer la commande','comprar','pagar','realizar pedido','finalizar compra',
    'acquista','acquistare','ordina','paga','kopen','afrekenen','betalen','bestelling plaatsen','køb','kjøp','betal','bestil','bestill','osta','maksa','tilaa','kup','kupuję','zapłać','zamów','zamawiam','finalizar pedido']);
  const CHECKOUT_CONTEXT_EU = anyWord(['kasse','zur kasse','zahlungsart','zahlungsmethode','lieferadresse','ihr warenkorb','dein warenkorb','bestellübersicht','gesamtsumme','zahlungspflichtig bestellen',
    'mode de paiement','moyen de paiement','adresse de livraison','votre panier','récapitulatif de (?:la )?commande','total de la commande','passer la commande','valider (?:la|ma) commande',
    'método de pago','forma de pago','dirección de envío','tu carrito','resumen del pedido','realizar pedido','finalizar compra',
    'metodo di pagamento','indirizzo di spedizione','il tuo carrello','riepilogo (?:dell.)?ordine','conferma ordine',
    'betaalmethode','betaalwijze','bezorgadres','je winkelwagen','uw winkelwagen','bestelling plaatsen','afrekenen',
    'betalingsmetode','betalingsmåte','leveringsadresse','din indkøbskurv','din handlekurv','gå til kassen',
    'maksutapa','toimitusosoite','metoda płatności','adres dostawy','twój koszyk','podsumowanie zamówienia',
    'método de pagamento','forma de pagamento','endereço de entrega','seu carrinho','resumo do pedido']);
  const PLACE_ORDER_EU = anyWord(['jetzt kaufen','zahlungspflichtig bestellen','jetzt bestellen','bestellung abschließen','kauf abschließen','jetzt bezahlen',
    'passer (?:la|ma) commande','valider (?:la|ma) commande','confirmer (?:la|ma) commande','finaliser (?:la|ma) commande','acheter maintenant','payer maintenant',
    'comprar ahora','realizar pedido','confirmar pedido','finalizar compra','pagar ahora','tramitar pedido',
    'acquista ora','conferma ordine','completa (?:l.)?ordine','paga ora','procedi all.ordine',
    'nu kopen','bestelling plaatsen','nu betalen','bestellen en betalen','bestelling afronden',
    'køb nu','gennemfør køb','betal nu','bestil nu','godkend køb','kjøp nå','fullfør kjøp','betal nå','bestill nå',
    'osta nyt','maksa nyt','vahvista tilaus','tee tilaus','kup teraz','zamawiam i płacę','zapłać teraz','złóż zamówienie','kupuję i płacę',
    'comprar agora','finalizar pedido','pagar agora',
    'submit order','complete order','buy with 1-click']);
  const PLACE_ORDER = /\b(?:place (?:your )?order|pay now|buy now|complete purchase|confirm purchase|köp nu|betala nu|slutför köp|bekräfta köp|beställ nu)\b/i;
  const ORDER_TARGET_EU = anyWord(['kaufen','bestellen','bestellung','bezahlen','zahlen','bestätigen','commander','commande','payer','acheter','valider','confirmer',
    'comprar','pagar','pedido','confirmar','finalizar','acquista','acquistare','ordina','ordine','paga','pagare','conferma',
    'kopen','bestelling','betalen','bevestigen','afrekenen','køb','kjøp','betal','bestil','bestill','bekræft','bekreft',
    'osta','maksa','tilaa','vahvista','kup','kupuję','zapłać','zamów','zamawiam','płacę','potwierdź']);
  // Checkout pages by address too: Shopify's /checkouts/, /checkout and its translations.
  const CHECKOUT_PATH = /\/(?:checkouts?|kassa|kasse|kassan|caisse|paiement|pago|afrekenen)(?:\/|$)/i;
  const pathOf = (url) => { try { return new URL(url).pathname; } catch { return ''; } };
  const atCheckout = (session) => checkoutContext.test(session.text || '') || CHECKOUT_CONTEXT_EU.test(session.text || '') || CHECKOUT_PATH.test(pathOf(session.url));
  // Totals the page itself shows, with a currency or cents so a count ("Total 3 items") is
  // not read as money. Used to refuse an approval card whose total contradicts the page.
  const TOTAL_LINE = /(?<![\p{L}\p{N}])(?:order total|grand total|total|ordersumma|att betala|totalt|gesamtsumme|gesamtbetrag|gesamt|totaal|totale|i alt|yhteensä|razem|suma)(?![\p{L}\p{N}])[\s:]*(?:([$€£])\s*|([a-z]{3})\s+)?(\d{1,3}(?:[ .,  ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*([$€£]|kr|zł|[a-z]{3}))?(?![\p{L}\p{N}])/giu;
  function pageTotals(text) {
    const totals = [];
    for (const m of String(text || '').matchAll(TOTAL_LINE)) {
      const raw = m[3].replace(/[\s  ]/g, ''), decimal = /[.,](\d{1,2})$/.exec(raw);
      if (!m[1] && !m[2] && !m[4] && !decimal) continue;
      const value = decimal ? Number(raw.slice(0, decimal.index).replace(/[.,]/g, '') + '.' + decimal[1]) : Number(raw.replace(/[.,]/g, ''));
      if (Number.isFinite(value) && value > 0) totals.push(value);
    }
    return [...new Set(totals)];
  }
  const CHOICE =/^\[\d+\] (?:input:(?:radio|checkbox|text|email|tel|number|search)|select|textarea|radio|checkbox|option|combobox|switch|textbox) /;
  const choiceTarget = (session, args) => CHOICE.test(targetLine(session, args))
    || (args.type === 'click_text' && !!args.text && (session.elements || []).some((line) => CHOICE.test(line) && flat(line).includes(flat(args.text))));
  const flat = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const pageHost = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
  const pageKey = (session, args) => {
    const selected = args.ref ? (session.elements || []).find((line) => line.startsWith(`[${args.ref}]`)) || '' : '';
    const raw = `${session.url}\n${String(session.text || '').slice(-3500)}\n${(session.elements || []).join('\n').slice(0,6500)}\n${selected}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  };
  // A click that sends, posts, deletes or submits for the owner is final, like placing an
  // order: it goes through browser_submit so the owner approves it. browser_action and
  // browser_submit run the same click, so the label decides which one is allowed.
  // Consent and cookie choices are not final. Coordinate-only clicks carry no label.
  const FINAL_ACTION = /^(?:send|post|publish|tweet|delete|erase|remove account|unsubscribe|transfer|submit|deactivate|close account|cancel (?:subscription|order|account|membership)|skicka|publicera|radera|säg upp|avsluta konto)(?:\s|$)/;
  const FINAL_ACTION_EU = /^(?:senden|absenden|veröffentlichen|löschen|kündigen|envoyer|publier|supprimer|enviar|publicar|eliminar|borrar|invia|pubblica|elimina|verzenden|versturen|publiceren|verwijderen|slet|publiser|slett|lähetä|julkaise|poista|wyślij|opublikuj|usuń)(?:\s|$)/u;
  const FINAL_ROLES = /^(?:button|input:submit|input:button|menuitem|link)$/;
  function finalActionLabel(session, args) {
    const m = /^\[\d+\] (\S+) "([^"]*)"/.exec(targetLine(session, args));
    if (m && !FINAL_ROLES.test(m[1].toLowerCase())) return '';
    const label = args.type === 'click_text' ? String(args.text || '') : m ? m[2] : '';
    const text = flat(label);
    // Text that exactly names a field or option ("Send to") selects it, it does not send.
    if (args.type === 'click_text' && (session.elements || []).some((line) => CHOICE.test(line) && flat(/"([^"]*)"/.exec(line)?.[1]) === text)) return '';
    if (!text || text.split(' ').length > 5 || /cookie|consent|samtycke|preferences|choices|inställningar/.test(text)) return '';
    return FINAL_ACTION.test(text) || FINAL_ACTION_EU.test(text) ? label : '';
  }
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
    const orderButton = (session.elements || []).some((line) => PLACE_ORDER.test(line) || PLACE_ORDER_EU.test(line));
    // Enter in a field can submit the whole form, and on a checkout that may place the order.
    if (args.type === 'type' && (orderButton || CHECKOUT_PATH.test(pathOf(session.url)))) throw bad('Pressing Enter here may place the order. Type without submit, then click the button for the next step.');
    const target = `${targetLine(session,args)} ${args.type==='click_text' ? args.text : ''}`;
    // Choosing an option or filling a field ("Klarna – pay later", a delivery choice) never
    // places the order; clicking one is a normal step. Pressing Enter in a field may submit.
    const final = ['click','double_click','click_text'].includes(args.type) && finalActionLabel(session, args);
    if (final) throw bad(`"${final.slice(0, 60)}" sends, posts, deletes or submits something for the owner. Use browser_submit with a summary of exactly what it does, so the owner approves it first.`);
    if (choiceTarget(session, args) && ['click','double_click','click_text'].includes(args.type)) return;
    if (PLACE_ORDER.test(target) || PLACE_ORDER_EU.test(target)
      || (atCheckout(session) && (!targetLine(session,args) || /\b(?:buy|purchase|pay|order|köp|betala|beställ|confirm|bekräfta)\b/i.test(target) || ORDER_TARGET_EU.test(target))))
      throw bad('This may place an order. Use browser_submit with full purchase details for owner approval.');
    // A click by position has no label to check. Away from the checkout, on a page with a
    // button that can buy at once (a 1-Click "Buy now"), the click must name its element.
    if (['click','double_click'].includes(args.type) && !targetLine(session, args) && orderButton)
      throw bad('This page has a button that can place an order, so click by ref from the latest page state, not by position.');
  }
  async function details(args, userId, session, ownerCheckout = false) {
    const host = pageHost(session.url);
    if (!host || !session.url.startsWith('https://')) throw bad('Purchases require an HTTPS merchant page.');
    const input = args.purchase;
    if (!input || typeof input !== 'object') {
      const said = `${args.summary || ''} ${targetLine(session, args)}`;
      if (purchaseWords.test(said) || PURCHASE_WORDS_EU.test(said) || atCheckout(session)) throw bad('A purchase needs the items, total, shipping address and the payment method selected at checkout (a payment app such as Klarna, Swish or Shop Pay, or a saved merchant card) before approval.');
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
    // The approval card shows this amount as the total. When the page states its own total
    // and none of them is this amount, the card would show the owner the wrong price.
    const shownTotals = pageTotals(session.text);
    if (shownTotals.length && !shownTotals.some((total) => Math.abs(total - amount) < 0.005)) throw bad(`The checkout page shows a total of ${shownTotals.slice(0, 3).join(' or ')}, not ${amount}. Copy the order total exactly as the page shows it.`);
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
    if (ownerCheckout) return { merchant: host, website: session.url, items, amount, currency, shippingAddress,
      payment: 'Owner checkout', paymentMethod: 'owner_checkout',
      ...(shippingAddressId ? {shippingAddressId} : {}), ...(shippingAddressParts ? {shippingAddressParts} : {}),
      checkoutKey: pageKey(session, {}), target: '', pageExcerpt: safeExcerpt(session) };
    const paymentMethod = Object.hasOwn(METHOD_SWITCH, input.payment?.method) ? input.payment.method : '';
    // Each method is off until the owner turns it on in Wallet; the server checks it here,
    // whatever the model was told. Payment apps also wait for the owner's own approval.
    const app = paymentMethod === 'payment_app';
    if(paymentMethod && wallet?.preferences){
      const selection=await wallet.preferences(userId);
      if(!selection.methods?.[METHOD_SWITCH[paymentMethod]])throw bad(`${METHOD_NAMES[paymentMethod]} is turned off. Ask the owner to turn it on in Settings → Wallet before purchasing.`);
    }
    const payment = String(input.payment?.label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!paymentMethod) throw bad('Pay with a payment app the owner approves (Klarna, Swish, Shop Pay, PayPal, Afterpay…) or a card already saved in the merchant account. Never enter card details.');
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
  async function handoffDetail(args, { userId, sessionId }) {
    const session = await live.forTool(userId, sessionId, undefined, false);
    await live.content(session);
    if (session.sensitivePresent || session.ownerSensitive || session.sensitiveValues?.length) throw bad('Prepare a fresh checkout without private payment information before handoff.');
    const purchase = await details(args, userId, session, true);
    if (!purchase) throw bad('Review the items, total, currency and delivery address before checkout handoff.');
    return purchase;
  }
  return { approvalDetail, beforeSubmit, beforeAction, handoffDetail };
}
// After a payment-app order is placed (Shop Pay in a store's checkout included), the payment
// waits for the owner's own approval.
function withPhoneApproval(args, out) {
  const payment = args?.purchase?.payment;
  if (!['payment_app','shop_pay'].includes(payment?.method) || !out || typeof out !== 'object') return out;
  const app = String(payment.label || 'the payment app').slice(0, 80);
  return { ...out, payment: { method:payment.method, status: 'awaiting_owner', note: `The owner approves this payment with ${app} themselves. Wait, then read the page for the store's confirmation. If it shows a QR code, asks to open an app or another device, or asks the owner to sign in or enter personal details, call browser_auth_handoff with purpose payment so the owner does it (without that tool, tell the owner to finish it in the live browser in Canvas). Never type their details and never place this order again.` } };
}
module.exports = { createPurchaseFlow, withPhoneApproval, PAYMENT_APPS };
