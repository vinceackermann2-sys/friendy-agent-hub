/* Product search across web stores and Shopify stores. The Shopify catalog and a web
   search run at once. Web results are read directly (free): a store page that states its
   product in structured data (JSON-LD Product or ItemList, product meta tags) becomes a
   product with name, price, image and rating; any other result becomes a link to that
   store. Pure logic shared by both runtimes, which pass their own catalog, search and
   page fetch. */

// What the owner's country pays in, for their budget and for local search words.
const COUNTRY_CURRENCY = { US: 'USD', GB: 'GBP', SE: 'SEK', NO: 'NOK', DK: 'DKK', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD', PL: 'PLN', CZ: 'CZK', IS: 'ISK', JP: 'JPY' };
const EURO_COUNTRIES = new Set(['AT', 'BE', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'NL', 'PT', 'SI', 'SK']);
const currencyFor = (country) => COUNTRY_CURRENCY[country] || (EURO_COUNTRIES.has(country) ? 'EUR' : 'USD');
// Rough US dollars per unit. The Shopify catalog filters prices in US dollars.
const USD_RATE = { USD: 1, EUR: 1.1, GBP: 1.3, SEK: 0.095, NOK: 0.094, DKK: 0.147, CHF: 1.15, CAD: 0.73, AUD: 0.66, NZD: 0.6, PLN: 0.26, CZK: 0.044, ISK: 0.0073, JPY: 0.0068 };
// "Buy" in the owner's language steers a web search to stores rather than reviews.
const BUY_WORD = { SE: 'köp', NO: 'kjøp', DK: 'køb', FI: 'osta', DE: 'kaufen', AT: 'kaufen', CH: 'kaufen', FR: 'acheter', BE: 'acheter', ES: 'comprar', PT: 'comprar', IT: 'acquista', NL: 'kopen', PL: 'kup' };

const WEB_READS = 5, WEB_PRODUCTS_PER_PAGE = 3, MAX_SHOPIFY = 6, MAX_STORES = 4, MAX_ITEMS = 12;

// Stores pricing in a currency from another part of the world rarely ship to the owner.
const REGION = { SEK: 'eu', NOK: 'eu', DKK: 'eu', EUR: 'eu', GBP: 'eu', CHF: 'eu', PLN: 'eu', CZK: 'eu', ISK: 'eu', USD: 'na', CAD: 'na', AUD: 'oc', NZD: 'oc', JPY: 'jp' };
const nearby = (price, home) => !price || !REGION[price.currency] || !REGION[home] || REGION[price.currency] === REGION[home];

const clean = (value, max = 200) => String(value ?? '').replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (m, n) => (Number(n) > 0 && Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : m))
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => (parseInt(n, 16) > 0 && parseInt(n, 16) < 0x110000 ? String.fromCodePoint(parseInt(n, 16)) : m))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, max);
function httpsUrl(value, base) {
  try { const url = new URL(String(value || ''), base); return url.protocol === 'https:' ? url.href.slice(0, 1200) : ''; } catch { return ''; }
}
const hostName = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const types = (node) => [].concat(node?.['@type'] || []).map(String);
// Structured-data prices are numbers or strings such as "1299.00" or "1 299,00".
function amountOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const text = String(value ?? '').replace(/[^\d.,]/g, '');
  // A final separator with one or two digits after it is the decimal point; others group thousands.
  const decimals = /[.,](\d{1,2})$/.exec(text);
  const whole = (decimals ? text.slice(0, decimals.index) : text).replace(/[.,]/g, '');
  const n = Number(decimals ? `${whole}.${decimals[1]}` : whole);
  return whole && Number.isFinite(n) && n > 0 ? n : null;
}
function priceOf(offers) {
  for (const offer of [].concat(offers || [])) {
    if (!offer || typeof offer !== 'object') continue;
    const spec = [].concat(offer.priceSpecification || [])[0] || {};
    const amount = amountOf(offer.price ?? offer.lowPrice ?? spec.price);
    const currency = String(offer.priceCurrency || spec.priceCurrency || '').toUpperCase().slice(0, 3);
    if (amount && /^[A-Z]{3}$/.test(currency)) return { amount, currency };
  }
  return null;
}
function imageOf(image, base) {
  for (const item of [].concat(image || [])) {
    const url = httpsUrl(typeof item === 'object' ? item?.url || item?.contentUrl : item, base);
    if (url && !/\.svg(\?|$)/i.test(url)) return url;
  }
  return '';
}
function ratingOf(rating) {
  const value = Number(rating?.ratingValue);
  return value > 0 && value <= (Number(rating?.bestRating) || 5) ? { value, count: Number(rating.reviewCount || rating.ratingCount) || 0 } : null;
}
function productNode(node, base) {
  const title = clean(node.name, 160);
  if (!title) return null;
  // A product group (colours, sizes) keeps its prices on its variants.
  const variants = [].concat(node.hasVariant || []).filter((v) => v && typeof v === 'object');
  const price = priceOf(node.offers) || variants.map((v) => priceOf(v.offers)).find(Boolean) || null;
  return { title, url: httpsUrl(node.url || node.offers?.url || node['@id'], base) || base, image: imageOf(node.image, base) || variants.map((v) => imageOf(v.image, base)).find(Boolean) || '', price, rating: ratingOf(node.aggregateRating) };
}
const meta = (html, name) => clean((html.match(new RegExp(`<meta\\b[^>]*(?:property|name)=["']${name}["'][^>]*>`, 'i'))?.[0].match(/\bcontent=["']([^"']*)["']/i) || [])[1], 600);

// The products a page states about itself: one on a product page, a few from a listing.
function productsFromHtml(html, pageUrl) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object' || found.length >= WEB_PRODUCTS_PER_PAGE) return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const kind = types(node);
    if (kind.includes('Product') || kind.includes('ProductGroup')) { const product = productNode(node, pageUrl); if (product) found.push(product); return; }
    if (kind.includes('ItemList')) {
      for (const entry of [].concat(node.itemListElement || [])) {
        const item = entry?.item && typeof entry.item === 'object' ? entry.item : entry;
        if (types(item).includes('Product')) visit(item);
      }
      return;
    }
    if (node['@graph']) visit(node['@graph']);
    if (node.mainEntity) visit(node.mainEntity);
  };
  for (const match of String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1].trim())); } catch {}
  }
  if (found.length) return found;
  // Pages without JSON-LD often still carry product meta tags.
  const amount = amountOf(meta(html, '(?:product|og):price:amount'));
  const currency = meta(html, '(?:product|og):price:currency').toUpperCase().slice(0, 3);
  const title = meta(html, 'og:title');
  if (amount && /^[A-Z]{3}$/.test(currency) && title) return [{ title: clean(title, 160), url: pageUrl, image: imageOf(meta(html, 'og:image'), pageUrl), price: { amount, currency }, rating: null }];
  return [];
}
const storeImage = (html, base) => imageOf(meta(html, 'og:image'), base);

// Web results as products (from structured data) and store links (everything else).
async function webProducts({ query, country }, { search, fetchHtml, signal }) {
  const buy = BUY_WORD[country] || 'buy';
  const results = (await search({ query: new RegExp(`\\b${buy}\\b`, 'i').test(query) ? query : `${query} ${buy}`, country, signal }) || [])
    .filter((r) => httpsUrl(r.url)).slice(0, 8);
  const pages = await Promise.all(results.slice(0, WEB_READS).map(async (result) => {
    try { const page = await fetchHtml(result.url, { signal }); return { result, html: page.html, url: page.url || result.url }; }
    catch { return { result, html: '', url: result.url }; }
  }));
  const products = [], stores = [];
  for (const { result, html, url } of [...pages, ...results.slice(WEB_READS).map((result) => ({ result, html: '', url: result.url }))]) {
    const seller = { name: hostName(url) };
    const stated = html ? productsFromHtml(html, url) : [];
    if (stated.length) products.push(...stated.map((p) => ({ ...p, seller, source: 'web' })));
    else stores.push({ title: clean(result.title, 160) || seller.name, url, image: html ? storeImage(html, url) : '', price: null, rating: null, snippet: clean(result.snippet, 200), seller, source: 'web', kind: 'store' });
  }
  return { products, stores };
}

// Both sources at once; one failing still leaves the other. Web products lead (they are
// the top local results), then Shopify products, then links to stores.
async function searchProducts({ query, country, maxPrice, currency, limit } = {}, io) {
  const q = clean(query, 200);
  if (q.length < 2) throw Object.assign(new Error('Search query is required.'), { code: 'BAD_INPUT' });
  const cc = String(country || 'US').slice(0, 2).toUpperCase();
  const budget = Number(maxPrice) > 0 ? Number(maxPrice) : 0;
  const budgetCurrency = String(currency || currencyFor(cc)).slice(0, 3).toUpperCase();
  const [shop, web] = await Promise.all([
    io.catalog({ query: q, country: cc, limit, maxPrice: budget || undefined, currency: currency || undefined }).catch((error) => ({ products: [], error })),
    io.search ? webProducts({ query: q, country: cc }, io).catch((error) => ({ products: [], stores: [], error })) : { products: [], stores: [] },
  ]);
  if (io.signal?.aborted) throw Object.assign(new Error('Interrupted'), { name: 'AbortError' });
  const home = currencyFor(cc);
  const withinBudget = (p) => nearby(p.price, home) && (!budget || !p.price || p.price.currency !== budgetCurrency || p.price.amount <= budget);
  // One row per page and per product in a store; a row with a price wins over one without.
  const seen = new Set();
  const fresh = (p) => { const key = `${p.seller?.name}|${p.title.toLowerCase()}`; if (!p.url || seen.has(p.url) || seen.has(key)) return false; seen.add(p.url); seen.add(key); return true; };
  const pricedFirst = (list) => [...list.filter((p) => p.price), ...list.filter((p) => !p.price)];
  const shopify = (shop.products || []).map((p) => ({ ...p, source: 'shopify' }));
  const products = [...pricedFirst(web.products.filter(withinBudget)), ...shopify.filter((p) => nearby(p.price, home)).slice(0, MAX_SHOPIFY), ...web.stores.slice(0, MAX_STORES)].filter(fresh).slice(0, MAX_ITEMS);
  // Nothing to show while a source failed is a failure, not "no products".
  if (!products.length && (shop.error || web.error)) throw shop.error || web.error;
  const sources = { web: products.filter((p) => p.source === 'web').length, shopify: products.filter((p) => p.source === 'shopify').length };
  return budget ? { products, sources, maxPrice: budget, currency: budgetCurrency } : { products, sources };
}

export { searchProducts, productsFromHtml, amountOf, currencyFor, USD_RATE, BUY_WORD };
