const assert = require('node:assert/strict');
const { createPurchaseFlow } = require('../server/agents/purchase');

// The final purchase click needs the owner's approval in every language a checkout uses,
// not only in English and Swedish, and the approval card's total must not contradict the page.
const ctx = { userId: 'owner', sessionId: 'task' };
const flowFor = (page) => createPurchaseFlow({ live: { forTool: async () => page, content: async () => page } });

(async () => {
  const checkouts = [
    { url: 'https://shop.example.de/bestellen', text: 'Zahlungsart: Visa endet auf 4242. Lieferadresse: Ada, Hauptstraße 1. Gesamtsumme 230,00 €', button: 'Zahlungspflichtig bestellen' },
    { url: 'https://boutique.example.fr/commande', text: 'Mode de paiement : Visa. Adresse de livraison : Ada, Rue 1. Total 230,00 €', button: 'Valider la commande' },
    { url: 'https://tienda.example.es/pedido', text: 'Método de pago: Visa. Dirección de envío: Ada, Calle 1. Total 230,00 €', button: 'Realizar pedido' },
    { url: 'https://winkel.example.nl/bestelling', text: 'Betaalmethode: Visa. Bezorgadres: Ada, Straat 1. Totaal € 230,00', button: 'Bestelling plaatsen' },
    { url: 'https://sklep.example.pl/zamowienie', text: 'Metoda płatności: Visa. Adres dostawy: Ada, Ulica 1. Razem 230,00 zł', button: 'Zamawiam i płacę' },
  ];
  for (const page of checkouts) {
    const flow = flowFor({ ...page, elements: ['[6] radio "Visa" @500,600', `[7] button "${page.button}" @500,700`] });
    await assert.rejects(flow.beforeAction({ type: 'click', ref: 7 }, ctx), /browser_submit/, `${page.button} is a final click`);
    await assert.rejects(flow.beforeAction({ type: 'click_text', text: page.button }, ctx), /browser_submit/, `${page.button} by text`);
    await assert.rejects(flow.beforeAction({ type: 'click', x: 500, y: 700 }, ctx), /browser_submit/, `a coordinate click on ${page.url}`);
    await flow.beforeAction({ type: 'click', ref: 6 }, ctx); // choosing the payment option is a normal step
  }

  // A checkout recognised by its address alone, with no checkout words on the page.
  const shopify = flowFor({ url: 'https://store.example/checkouts/cn/abc', text: 'Ada Lovelace. 1 item.', elements: ['[3] button "Weiter" @1,1'] });
  await assert.rejects(shopify.beforeAction({ type: 'click', x: 10, y: 10 }, ctx), /browser_submit/);

  // Ordinary pages keep working: an English parity check, not a stricter rule.
  const product = flowFor({ url: 'https://shop.example.de/lampe', text: 'Lampe aus Messing. In den Warenkorb.', elements: ['[2] button "In den Warenkorb" @1,1', '[3] link "Bewertungen" @2,2'] });
  for (const step of [{ type: 'click', ref: 2 }, { type: 'click', ref: 3 }, { type: 'click', x: 5, y: 5 }]) await product.beforeAction(step, ctx);

  // Sending or deleting in another language is final, like "Send" and "Delete".
  const mail = flowFor({ url: 'https://mail.example/', text: 'Posteingang', elements: ['[4] button "Senden" @1,1', '[5] button "Supprimer" @1,1', '[6] button "Usuń" @1,1', '[7] link "Entwürfe" @1,1'] });
  for (const ref of [4, 5, 6]) await assert.rejects(mail.beforeAction({ type: 'click', ref }, ctx), /browser_submit with a summary/);
  await mail.beforeAction({ type: 'click', ref: 7 }, ctx);

  // The approval card's total must match a total the page shows.
  const page = { url: 'https://shop.example/checkout', text: 'One lamp 2 × 100 SEK. Shipping: Ada, Main Street 1. Payment: Visa ending in 4242. Total 1 230,00 SEK. Place order',
    elements: ['[7] button "Place order" @500,700'] };
  const purchase = (amount) => ({ type: 'click', ref: 7, summary: 'Place order', purchase: { website: page.url, items: [{ title: 'One lamp', quantity: 2, price: 100 }], amount, currency: 'SEK',
    shippingAddress: 'Ada, Main Street 1, Stockholm', payment: { method: 'saved_card', label: 'Visa ending in 4242' } } });
  await assert.rejects(flowFor(page).approvalDetail(purchase(12.3), ctx), /shows a total of 1230/);
  assert.equal(JSON.parse(await flowFor(page).approvalDetail(purchase(1230), ctx)).amount, 1230);
  // A count is not a price, and a page without a readable total keeps today's behaviour.
  const counted = { ...page, text: 'Total 3 items. Shipping: Ada, Main Street 1. Payment: Visa ending in 4242.' };
  assert.equal(JSON.parse(await flowFor(counted).approvalDetail(purchase(230), ctx)).amount, 230);
  console.log('purchase guard: final clicks in other languages and at checkout addresses need approval, card totals match the page: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
