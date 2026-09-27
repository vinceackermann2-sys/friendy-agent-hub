const assert = require('node:assert/strict');
const { searchProducts, productsFromHtml, amountOf } = require('../server/agents/product-search');
const { resultCard } = require('../server/agents/cards');

(async () => {
  // Prices as structured data writes them.
  assert.equal(amountOf('1299.00'), 1299);
  assert.equal(amountOf('1 299,00'), 1299);
  assert.equal(amountOf('1,299'), 1299);
  assert.equal(amountOf('12.5'), 12.5);
  assert.equal(amountOf(449), 449);
  assert.equal(amountOf(''), null);
  assert.equal(amountOf('free'), null);

  // A product page states its product in JSON-LD, also inside @graph and with several offers.
  const productPage = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Apple AirPods Pro 3","image":["https://cdn.store.se/airpods.jpg"],
    "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.7","reviewCount":"212"},"offers":[{"@type":"Offer","price":"2 790,00","priceCurrency":"SEK"}]}]}</script></head><body>Buy</body></html>`;
  assert.deepEqual(productsFromHtml(productPage, 'https://store.se/airpods'), [{ title: 'Apple AirPods Pro 3', url: 'https://store.se/airpods', image: 'https://cdn.store.se/airpods.jpg', price: { amount: 2790, currency: 'SEK' }, rating: { value: 4.7, count: 212 } }]);
  // A listing gives a few of its products, each with its own link.
  const listing = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
    {"@type":"ListItem","item":{"@type":"Product","name":"Speedgoat 6","url":"/p/speedgoat","image":{"url":"https://cdn.run.se/sg.jpg"},"offers":{"@type":"AggregateOffer","lowPrice":1499,"priceCurrency":"SEK"}}},
    {"@type":"ListItem","item":{"@type":"Product","name":"Peregrine 15","url":"https://run.se/p/peregrine","offers":{"@type":"Offer","price":1299,"priceCurrency":"SEK"}}},
    {"@type":"ListItem","item":{"@type":"Product","name":"Cascadia 19","url":"https://run.se/p/cascadia"}},
    {"@type":"ListItem","item":{"@type":"Product","name":"Fourth","url":"https://run.se/p/fourth"}}]}</script><script type="application/ld+json">not json</script>`;
  const listed = productsFromHtml(listing, 'https://run.se/trailskor');
  assert.deepEqual(listed.map((p) => p.title), ['Speedgoat 6', 'Peregrine 15', 'Cascadia 19'], 'at most three per page');
  assert.equal(listed[0].url, 'https://run.se/p/speedgoat', 'relative links resolve against the page');
  assert.deepEqual(listed[0].price, { amount: 1499, currency: 'SEK' });
  assert.equal(listed[0].image, 'https://cdn.run.se/sg.jpg');
  assert.equal(listed[2].price, null);
  // Without JSON-LD, product meta tags still give the product.
  const metaPage = '<meta property="og:title" content="Kobo Clara BW"><meta property="og:image" content="https://cdn.books.se/clara.jpg"><meta property="product:price:amount" content="1690"><meta property="product:price:currency" content="SEK">';
  assert.deepEqual(productsFromHtml(metaPage, 'https://books.se/clara'), [{ title: 'Kobo Clara BW', url: 'https://books.se/clara', image: 'https://cdn.books.se/clara.jpg', price: { amount: 1690, currency: 'SEK' }, rating: null }]);
  assert.deepEqual(productsFromHtml('<title>Trailskor</title><script type="application/ld+json">{"@type":"BreadcrumbList"}</script>', 'https://x.se/'), []);
  // A product group (as price comparison sites write it) keeps its price on a variant; names decode.
  const group = productsFromHtml('<script type="application/ld+json">{"@type":"ProductGroup","name":"L&#246;parsko 2025","image":"https://cdn.pj.se/p.jpg","hasVariant":[{"@type":"Product","name":"White","offers":{"@type":"AggregateOffer","lowPrice":2559,"priceCurrency":"SEK"}}],"aggregateRating":{"ratingValue":3.4,"ratingCount":26}}</script>', 'https://pj.se/p');
  assert.deepEqual(group, [{ title: 'Löparsko 2025', url: 'https://pj.se/p', image: 'https://cdn.pj.se/p.jpg', price: { amount: 2559, currency: 'SEK' }, rating: { value: 3.4, count: 26 } }]);

  // Both sources at once: web products lead, then Shopify, then links to stores.
  const pages = {
    'https://store.se/airpods': productPage,
    'https://run.se/trailskor': listing,
    'https://outlet.se/dyr': `<script type="application/ld+json">{"@type":"Product","name":"Pricey shoe","offers":{"price":2500,"priceCurrency":"SEK"}}</script>`,
    'https://shop.se/skor': '<title>Skor</title><meta property="og:image" content="https://shop.se/banner.jpg">',
  };
  const calls = { search: [], catalog: [], fetched: [] };
  const io = {
    catalog: async (args) => { calls.catalog.push(args); return { products: [{ id: 'gid://p/1', title: 'Shopify shoe', url: 'https://shopify-store.com/p/1', price: { amount: 999, currency: 'SEK' }, seller: { name: 'Shopify Store' }, variants: [{ id: 'v1' }] }] }; },
    search: async (args) => { calls.search.push(args); return [
      { title: 'Trailskor | Run', url: 'https://run.se/trailskor', snippet: 'Trail shoes' },
      { title: 'AirPods', url: 'https://store.se/airpods', snippet: 'Buy AirPods' },
      { title: 'Dyr sko', url: 'https://outlet.se/dyr', snippet: '' },
      { title: 'Skor | Shop', url: 'https://shop.se/skor', snippet: 'Fri frakt' },
      { title: 'Blocked store', url: 'https://blocked.se/', snippet: 'Stora rabatter' },
      { title: 'Not read', url: 'https://sixth.se/', snippet: 'Beyond the reads' },
      { title: 'Insecure', url: 'http://plain.se/', snippet: 'no https' },
    ]; },
    fetchHtml: async (url) => { calls.fetched.push(url); if (!pages[url]) throw new Error('HTTP 429'); return { url, html: pages[url] }; },
  };
  const found = await searchProducts({ query: 'trailskor', country: 'SE', maxPrice: 2000 }, io);
  assert.deepEqual(calls.search[0], { query: 'trailskor köp', country: 'SE', signal: undefined }, 'the web search asks for stores in the owner\'s language');
  assert.deepEqual(calls.catalog[0], { query: 'trailskor', country: 'SE', limit: undefined, maxPrice: 2000, currency: undefined });
  assert.equal(calls.fetched.length, 5, 'the top five results are read');
  assert.deepEqual(found.products.map((p) => `${p.source}:${p.kind || 'product'}:${p.title}`), [
    'web:product:Speedgoat 6', 'web:product:Peregrine 15', 'web:product:Cascadia 19',
    'shopify:product:Shopify shoe',
    'web:store:Skor | Shop', 'web:store:Blocked store', 'web:store:Not read',
  ]);
  assert.ok(!found.products.some((p) => ['Pricey shoe', 'Apple AirPods Pro 3'].includes(p.title)), 'web products over budget in the same currency are dropped');
  assert.equal(found.products.find((p) => p.title === 'Skor | Shop').image, 'https://shop.se/banner.jpg');
  assert.equal(found.products.find((p) => p.title === 'Speedgoat 6').seller.name, 'run.se');
  assert.equal(found.products.find((p) => p.title === 'Shopify shoe').variants[0].id, 'v1', 'Shopify products keep their variants for checkout');
  assert.deepEqual(found.sources, { web: 6, shopify: 1 });
  assert.equal(found.currency, 'SEK');

  // The card shows both sources; a store link carries what the search said about it.
  const card = resultCard('product_search', found, { query: 'trailskor' });
  assert.equal(card.kind, 'products');
  assert.equal(card.items.length, 7);
  assert.ok(card.items.every((item) => item.url.startsWith('https://')), 'every row opens its page');
  assert.equal(card.items.find((item) => item.title === 'Blocked store').meta, 'Stora rabatter');
  assert.match(card.subtitle, /^7 under SEK\s2,000\.00$/);
  const open = resultCard('product_search', await searchProducts({ query: 'airpods', country: 'SE' }, io), { query: 'airpods' });
  assert.equal(open.subtitle, undefined, 'no budget, the app counts the items');
  assert.equal(open.items.find((item) => item.title === 'Apple AirPods Pro 3').meta, '★ 4.7 (212)');

  // A store pricing in another region's currency rarely ships to the owner: A$ is dropped for a
  // Swedish shopper, euros and pounds are kept.
  const far = await searchProducts({ query: 'airpods', country: 'SE' }, { ...io, search: async () => [], catalog: async () => ({ products: [
    { title: 'Australian store', url: 'https://au.example/p', price: { amount: 429, currency: 'AUD' }, seller: { name: 'AU' } },
    { title: 'German store', url: 'https://de.example/p', price: { amount: 249, currency: 'EUR' }, seller: { name: 'DE' } },
    { title: 'Swedish store', url: 'https://se.example/p', price: { amount: 2590, currency: 'SEK' }, seller: { name: 'SE' } }] }) });
  assert.deepEqual(far.products.map((p) => p.title), ['German store', 'Swedish store']);

  // The same product twice in one store (two pages) shows once, with its price.
  const twice = await searchProducts({ query: 'airpods', country: 'SE' }, { catalog: async () => ({ products: [] }),
    search: async () => [{ title: 'A', url: 'https://apple.example/a' }, { title: 'B', url: 'https://apple.example/b' }],
    fetchHtml: async (url) => ({ url, html: `<script type="application/ld+json">{"@type":"Product","name":"AirPods Pro 3"${url.endsWith('b') ? ',"offers":{"price":2995,"priceCurrency":"SEK"}' : ''}}</script>` }) });
  assert.deepEqual(twice.products.map((p) => [p.url, p.price?.amount]), [['https://apple.example/b', 2995]]);

  // One source failing leaves the other; both failing is an error.
  const webOnly = await searchProducts({ query: 'airpods', country: 'SE' }, { ...io, catalog: async () => { throw new Error('Catalog down'); } });
  assert.ok(webOnly.products.length > 0 && webOnly.products.every((p) => p.source === 'web'));
  const shopOnly = await searchProducts({ query: 'airpods köp', country: 'SE' }, { ...io, search: async (args) => { calls.search.push(args); throw new Error('Search down'); } });
  assert.deepEqual(shopOnly.products.map((p) => p.title), ['Shopify shoe']);
  assert.equal(calls.search.at(-1).query, 'airpods köp', 'a query that already says buy keeps its words');
  await searchProducts({ query: 'yoga mat', country: 'US' }, { ...io, search: async (args) => { calls.search.push(args); return []; } });
  assert.equal(calls.search.at(-1).query, 'yoga mat buy', 'US searches add "buy"');
  await assert.rejects(searchProducts({ query: 'x y', country: 'SE' }, { catalog: async () => { throw new Error('Catalog down'); }, search: async () => { throw new Error('Search down'); }, fetchHtml: io.fetchHtml }), /Catalog down/);
  // Nothing found while one source failed is reported as the failure, not as "no products".
  await assert.rejects(searchProducts({ query: 'x y', country: 'SE' }, { catalog: async () => { throw new Error('Catalog down'); }, search: async () => [], fetchHtml: io.fetchHtml }), /Catalog down/);
  assert.deepEqual((await searchProducts({ query: 'x y', country: 'SE' }, { catalog: async () => ({ products: [] }), search: async () => [], fetchHtml: io.fetchHtml })).products, []);
  await assert.rejects(searchProducts({ query: ' ' }, io), /query is required/);
  console.log('product search: web stores and Shopify at once, structured product data, budget, store links, failures: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
