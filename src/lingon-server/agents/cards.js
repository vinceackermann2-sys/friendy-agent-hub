/* Visual chat cards. Tools return data; these builders turn tool arguments,
   approval details and results into the structured cards the app renders:
   questions, approvals (email, purchase, app action, website step, credential
   use, automation), product lists, orders, emails, lists and dashboards.
   Pure functions shared by the chat coordinator, task worker and VM harness,
   so every runtime shows the same card for the same action. */

const str = (value, max = 400) => String(value ?? '').trim().slice(0, max);
function httpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href.slice(0, 1200) : '';
  } catch { return ''; }
}
function hostOf(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase() : '';
  } catch { return ''; }
}
function parse(detail) {
  if (detail && typeof detail === 'object') return detail;
  try { return JSON.parse(String(detail || '')); } catch { return null; }
}
const addresses = (value) => (Array.isArray(value) ? value : String(value || '').split(/[,;]/))
  .map((item) => str(typeof item === 'object' ? item?.email || item?.address : item, 200)).filter(Boolean).slice(0, 20);
function money(amount, currency) {
  if (amount && typeof amount === 'object') return money(amount.amount, amount.currency || currency);
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'USD').toUpperCase() }).format(n); }
  catch { return `${n.toFixed(2)} ${str(currency, 8)}`.trim(); }
}
const humanize = (slug) => str(slug, 120).replace(/[_-]+/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const TOOLKIT_NAMES = { gmail: 'Gmail', googlecalendar: 'Google Calendar', googledrive: 'Google Drive', googlesheets: 'Google Sheets', googledocs: 'Google Docs', outlook: 'Outlook', slack: 'Slack', github: 'GitHub', notion: 'Notion', linear: 'Linear', hubspot: 'HubSpot', stripe: 'Stripe', twitter: 'X', linkedin: 'LinkedIn', discord: 'Discord', trello: 'Trello', asana: 'Asana', jira: 'Jira', dropbox: 'Dropbox', calendly: 'Calendly', shopify: 'Shopify', whatsapp: 'WhatsApp', telegram: 'Telegram' };
const toolkitName = (toolkit) => TOOLKIT_NAMES[String(toolkit || '').toLowerCase()] || humanize(toolkit);
// Composio slugs start with the toolkit, e.g. GMAIL_SEND_EMAIL or GOOGLECALENDAR_CREATE_EVENT.
const toolkitOf = (slug) => String(slug || '').split('_')[0].toLowerCase();

/* ---------- agent-driven cards (ask_user, present, connect_app) ---------- */
function questionArgs(args = {}) {
  const options = (Array.isArray(args.options) ? args.options : []).slice(0, 8).map((option) => {
    if (typeof option !== 'object' || !option) return { label: str(option, 80) };
    const out = { label: str(option.label, 80) };
    const description = str(option.description, 160);
    const image = httpsUrl(option.image);
    if (description) out.description = description;
    if (image) out.image = image;
    return out;
  }).filter((option) => option.label);
  const card = { type: 'question', q: str(args.question, 300) || 'Which option do you prefer?', options,
    multi: args.multiple === true && options.length > 1, allowOther: args.allow_other !== false || !options.length };
  const image = httpsUrl(args.image);
  const context = str(args.context, 400);
  if (image) card.image = image;
  if (context) card.context = context;
  return card;
}

const PRESENT_KINDS = new Set(['list', 'gallery', 'dashboard', 'table', 'steps']);
function presentArgs(args = {}) {
  const kind = PRESENT_KINDS.has(args.kind) ? args.kind : 'list';
  const card = { type: 'present', kind, title: str(args.title, 120) || 'Overview' };
  const subtitle = str(args.subtitle, 200);
  if (subtitle) card.subtitle = subtitle;
  card.items = (Array.isArray(args.items) ? args.items : []).slice(0, 24).map((item) => {
    const row = { title: str(item?.title ?? item, 140) };
    for (const key of ['subtitle', 'meta', 'badge', 'price']) { const v = str(item?.[key], 160); if (v) row[key] = v; }
    const image = httpsUrl(item?.image);
    const url = httpsUrl(item?.url);
    if (image) row.image = image;
    if (url) row.url = url;
    if (item && typeof item === 'object' && typeof item.done === 'boolean') row.done = item.done;
    return row;
  }).filter((row) => row.title);
  card.metrics = (Array.isArray(args.metrics) ? args.metrics : []).slice(0, 8).map((metric) => ({
    label: str(metric?.label, 60), value: str(metric?.value, 40), delta: str(metric?.delta, 30) || undefined,
    trend: ['up', 'down', 'flat'].includes(metric?.trend) ? metric.trend : undefined,
  })).filter((metric) => metric.label && metric.value);
  const chart = args.chart && typeof args.chart === 'object' ? args.chart : null;
  if (chart && Array.isArray(chart.series)) {
    const labels = (Array.isArray(chart.labels) ? chart.labels : []).slice(0, 24).map((label) => str(label, 24));
    const series = chart.series.slice(0, 3).map((serie) => ({ name: str(serie?.name, 40),
      values: (Array.isArray(serie?.values) ? serie.values : []).slice(0, 24).map(Number).map((n) => (Number.isFinite(n) ? n : 0)) }))
      .filter((serie) => serie.values.length);
    if (series.length) card.chart = { type: chart.type === 'line' ? 'line' : 'bar', labels, series };
  }
  card.columns = (Array.isArray(args.columns) ? args.columns : []).slice(0, 8).map((column) => str(column, 40));
  card.rows = (Array.isArray(args.rows) ? args.rows : []).slice(0, 40).map((row) => (Array.isArray(row) ? row : [row]).slice(0, 8).map((cell) => str(cell, 140)));
  return card;
}

function connectArgs(args = {}) {
  const toolkit = str(args.toolkit, 60).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return { type: 'connect', toolkit, app: toolkit, name: str(args.name, 60) || toolkitName(toolkit), note: str(args.reason, 240) };
}

/* ---------- approvals ---------- */
function emailView(provider, input = {}) {
  return { kind: 'email', provider,
    to: addresses(input.recipient_email || input.to || input.recipients || input.recipient || input.email),
    cc: addresses(input.cc), bcc: addresses(input.bcc),
    subject: str(input.subject, 240),
    body: str(input.body || input.message_body || input.text || input.html_body || input.content, 6000) };
}
function appActionView(slug, input = {}) {
  const toolkit = toolkitOf(slug);
  const upper = String(slug || '').toUpperCase();
  if (/(SEND|REPLY|FORWARD|DRAFT)/.test(upper) && /(MAIL|GMAIL|OUTLOOK)/.test(upper)) {
    return { ...emailView(toolkit, input), draft: /DRAFT/.test(upper), app: toolkit, appName: toolkitName(toolkit) };
  }
  if (/(SEND|POST).*MESSAGE|CHAT_POST|MESSAGE_SEND/.test(upper)) {
    return { kind: 'message', app: toolkit, appName: toolkitName(toolkit), to: str(input.channel || input.channel_id || input.to || input.chat_id || input.recipient, 120), body: str(input.text || input.message || input.body || input.markdown_text, 4000) };
  }
  if (/CALENDAR/.test(upper) && /(CREATE|UPDATE|QUICK_ADD)/.test(upper)) {
    return { kind: 'event', app: toolkit, appName: toolkitName(toolkit), title: str(input.summary || input.title, 200), start: str(input.start_datetime || input.start || input.start_time, 80), end: str(input.end_datetime || input.end || input.end_time, 80), attendees: addresses(input.attendees), location: str(input.location, 200) };
  }
  const fields = Object.entries(input || {}).filter(([, value]) => value != null && value !== '').slice(0, 10)
    .map(([key, value]) => ({ k: humanize(key), v: str(typeof value === 'object' ? JSON.stringify(value) : value, 600) }));
  return { kind: 'app_action', app: toolkit, appName: toolkitName(toolkit), action: humanize(upper.replace(new RegExp(`^${toolkit.toUpperCase()}_`), '')), fields };
}
function approvalView(name, args = {}, detail) {
  const parsed = parse(detail) || {};
  switch (name) {
    case 'mail_send': return emailView('mailbox', args);
    case 'composio_execute': return appActionView(args.tool, args.args || {});
    case 'shop_purchase': {
      const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 8).map((item) => ({
        title: str(item.title, 140) || 'Item', quantity: Number(item.quantity) || 1, price: money(item.price, parsed.currency) }));
      return { kind: 'purchase', merchant: str(parsed.merchant || args.merchant, 120), website: str(`https://${parsed.merchant || args.merchant}`, 300), items, total: money(parsed.amount, parsed.currency),
        payment: 'Shop Pay', email: str(parsed.buyerEmail, 120), delivery: (Array.isArray(parsed.delivery) ? parsed.delivery : []).map((d) => str(d, 200)).slice(0, 2), estimated:false };
    }
    case 'browser_submit':
      if (parsed.paymentMethodId && args.purchase) return { kind:'purchase', merchant:str(parsed.merchant,120), website:str(parsed.website,500),
        items:(parsed.items || []).slice(0,12).map((item)=>({title:str(item.title,140),quantity:Number(item.quantity)||1,price:money(item.price,parsed.currency)})),
        total:money(parsed.amount,parsed.currency), payment:str(parsed.payment,80), delivery:[str(parsed.shippingAddress,300)], estimated:false,
        checkoutExcerpt:str(parsed.pageExcerpt,650) };
      return { kind:'submit', summary:str(args.summary,300), surface:'browser', action:str(args.type,30), website:str(parsed.website,500) };
    case 'computer_submit':
      return { kind: 'submit', summary: str(args.summary, 300), surface: name === 'computer_submit' ? 'computer' : 'browser', action: str(args.type || args.action, 30) };
    case 'browser_fill_secret': case 'computer_fill_secret':
      return { kind: 'credential', summary: str(parsed.summary, 240), host: str(args.host, 120), window: str(args.window, 120) };
    case 'browser_open': case 'computer_screenshot':
      return { kind: 'website', host: hostOf(args.url), url: str(args.url, 500) };
    case 'web_search':
      return { kind: 'search', query: str(args.query, 300), urls: (Array.isArray(args.urls) ? args.urls : []).map((url) => str(url, 300)).slice(0, 4) };
    case 'browser_action': case 'computer_action':
      return { kind: 'web_action', action: str(args.type || args.action, 30), text: str(args.text || args.key || args.value, 200), surface: name === 'computer_action' ? 'computer' : 'browser' };
    case 'trigger_create': {
      const trigger = args.trigger || {};
      const when = trigger.type === 'schedule' ? `Every ${Number(trigger.intervalMinutes) >= 60 ? `${Math.round(Number(trigger.intervalMinutes) / 60)} h` : `${Number(trigger.intervalMinutes) || 60} min`}`
        : trigger.type === 'app' ? `When ${toolkitName(trigger.app)} has new activity` : trigger.type === 'subagent' ? 'After another automation runs' : '';
      return { kind: 'automation', name: str(args.name, 120), prompt: str(args.prompt, 600), when };
    }
    default: return { kind: 'generic' };
  }
}
const HEADLINES = {
  email: (v) => (v.draft ? 'Save this email draft' : v.provider === 'mailbox' ? 'Send this email' : `Send this email with ${toolkitName(v.provider)}`),
  message: (v) => `Send a message in ${v.appName}`,
  event: (v) => `Add an event in ${v.appName}`,
  app_action: (v) => `${v.action} in ${v.appName}`,
  purchase: (v) => `Place an order${v.merchant ? ` at ${v.merchant}` : ''}`,
  submit: (v) => (v.surface === 'computer' ? 'Finish this step on the computer' : 'Finish this step on the website'),
  credential: () => 'Use a saved credential',
  website: (v) => `Open ${v.host || 'this website'}`,
  search: (v) => (v.query ? 'Search the web' : 'Read these websites'),
  web_action: (v) => (v.surface === 'computer' ? 'Use the computer' : 'Interact with this website'),
  automation: () => 'Create this automation',
};
function approvalCard(name, args = {}, detail = '', tool = {}, key) {
  if (name === 'ask_user') return { ...questionArgs(args), status: 'pending' };
  if (name === 'connect_app') return { ...connectArgs(args), status: 'pending' };
  if (tool && typeof tool.approvalCard === 'function') return { ...tool.approvalCard(args, detail), status: 'pending' };
  const view = approvalView(name, args, detail);
  const title = HEADLINES[view.kind] ? HEADLINES[view.kind](view) : name;
  return { type: 'approval', status: 'pending', title: str(title, 200), detail: String(detail || '').slice(0, 2000), key: key || name, tool: name, view };
}

/* ---------- results ---------- */
function productItems(products = []) {
  return products.slice(0, 12).map((product) => ({
    title: str(product.title, 140), subtitle: str(product.seller?.name || product.seller?.domain, 120),
    price: money(product.price), image: httpsUrl(product.image) || undefined, url: httpsUrl(product.url) || undefined,
  })).filter((item) => item.title);
}
function resultCard(name, out, args = {}) {
  if (!out || typeof out !== 'object') return null;
  if (name === 'present') return { ...presentArgs(args && args.title ? args : out), status: 'done' };
  if (name === 'shop_search' && Array.isArray(out.products)) {
    return { type: 'present', kind: 'products', title: str(args.query, 80) ? `Results for “${str(args.query, 80)}”` : 'Products', items: productItems(out.products), status: 'done' };
  }
  if ((name === 'shop_checkout' || name === 'shop_purchase' || name === 'shop_order') && out.merchant) {
    const total = (out.totals || []).find((t) => t.type === 'total');
    return { type: 'order', merchant: str(out.merchant, 120), orderStatus: str(out.status, 40),
      items: (out.lineItems || []).slice(0, 8).map((item) => ({ title: str(item.title, 140) || 'Item', quantity: Number(item.quantity) || 1, price: money(item.price) })),
      total: total ? money(total.amount) : money(out.amount, out.currency), continueUrl: httpsUrl(out.continueUrl) || undefined, orderUrl: httpsUrl(out.orderUrl) || undefined,
      status: out.status === 'completed' ? 'done' : (out.continueUrl ? 'needs_buyer' : 'done') };
  }
  if (name === 'mail_send' && out.id) {
    return { type: 'email', state: 'sent', provider: 'mailbox', from: str(out.from, 200), to: addresses(out.to), subject: str(out.subject, 240), body: str(args.body, 6000), status: 'done' };
  }
  if (name === 'mail_draft') {
    return { type: 'email', state: 'draft', provider: 'mailbox', to: addresses(out.to || args.to), subject: str(out.subject || args.subject, 240), body: str(out.body || out.bodyText || args.body, 6000), status: 'done' };
  }
  if (name === 'mail_list' && Array.isArray(out)) {
    return { type: 'present', kind: 'inbox', title: args.folder === 'sent' ? 'Sent mail' : 'Inbox',
      items: out.slice(0, 12).map((m) => ({ title: str(m.subject, 160), subtitle: str(m.fromName || m.from || (m.to || []).join(', '), 160), meta: str(m.preview, 160), badge: m.isRead === false ? 'New' : undefined })), status: 'done' };
  }
  if (name === 'composio_execute') {
    const view = appActionView(args.tool, args.args || {});
    if (view.kind === 'email' && !view.draft) return { type: 'email', state: 'sent', provider: view.provider, to: view.to, subject: view.subject, body: view.body, status: 'done' };
  }
  // The pending connect card already asked; only a confirmed connection adds a card.
  if (name === 'connect_app' && out.toolkit && out.connected) return { ...connectArgs(out), status: 'connected' };
  return null;
}

// Safety net for chat replies: a markdown table or task list the model wrote instead of
// calling present becomes a card. Only unambiguous blocks convert; other text is untouched.
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim().replace(/\*\*/g, ''));
function cardFromMarkdown(text) {
  const lines = String(text || '').split('\n');
  for (let i = 0; i + 2 < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) continue;
    let end = i + 2;
    while (end < lines.length && /^\s*\|.*\|\s*$/.test(lines[end])) end++;
    if (end - i - 2 < 2) continue;
    const heading = lines.slice(0, i).reverse().find((line) => /^#{1,4}\s+/.test(line));
    const card = presentArgs({ kind: 'table', title: heading ? heading.replace(/^#+\s*/, '') : 'Comparison', columns: cells(lines[i]), rows: lines.slice(i + 2, end).map(cells) });
    return { card, rest: [...lines.slice(0, i).filter((line) => line !== heading), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim() };
  }
  const tasks = lines.map((line, index) => ({ index, m: line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/) })).filter((row) => row.m);
  if (tasks.length >= 3) {
    const heading = lines.find((line) => /^#{1,4}\s+/.test(line));
    const items = tasks.map(({ m }) => {
      const [title, ...more] = m[2].replace(/\*\*/g, '').split(/:\s+| — | - /);
      return { title: title.trim(), subtitle: more.join(': ').trim() || undefined, done: m[1].toLowerCase() === 'x' };
    });
    const used = new Set(tasks.map((row) => row.index));
    // Section labels between the task items ("**Moving day**") belong to the list, not the reply.
    const rest = lines.filter((line, index) => !used.has(index) && line !== heading && !/^#{1,4}\s+/.test(line) && !/^\s*\*\*[^*]+\*\*:?\s*$/.test(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { card: presentArgs({ kind: 'steps', title: heading ? heading.replace(/^#+\s*/, '') : 'Checklist', items }), rest };
  }
  return null;
}

export { questionArgs, presentArgs, connectArgs, approvalView, approvalCard, resultCard, cardFromMarkdown, toolkitName };
