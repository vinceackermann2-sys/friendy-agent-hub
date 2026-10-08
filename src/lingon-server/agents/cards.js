/* Visual chat cards. Tools return data; these builders turn tool arguments,
   approval details and results into the structured cards the app renders:
   questions, approvals (email, purchase, app action, website step, credential
   use, automation), product lists, orders, emails, lists, dashboards and learning cards (quiz, flashcards, problems, graphs).
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
  // No price is not a price of zero.
  if (amount == null || amount === '') return '';
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

/* ---------- learning cards (learn) ----------
   Interactive cards the owner works through in the chat: a quiz, flashcards, practice
   problems with hints and a checked answer, or a graph of functions with a slider. The
   app renders and scores them locally, so nothing here calls a model. */
const LEARN_KINDS = new Set(['quiz', 'flashcards', 'problem', 'plot']);
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', Sigma: 'Σ', phi: 'φ', omega: 'ω', Omega: 'Ω' };
const LATEX_SYMBOLS = { cdot: '·', times: '×', div: '÷', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', infty: '∞', to: '→', rightarrow: '→', degree: '°', circ: '°', ...GREEK };
// The model sometimes writes LaTeX although the schema asks for plain math. The card shows
// plain text (x^2 is drawn as a superscript by the app), so common LaTeX is rewritten.
function plainMath(value, max = 600) {
  let text = String(value ?? '').replace(/\$\$?|\\[()[\]]/g, '');
  for (let i = 0; i < 4 && /\\[a-z]*frac|\\sqrt/.test(text); i++) {
    text = text.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => `${/^\w+$/.test(a) ? a : `(${a})`}/${/^\w+$/.test(b) ? b : `(${b})`}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
  }
  text = text.replace(/\\(?:left|right)\s*/g, '').replace(/\\text\s*\{([^{}]*)\}/g, '$1').replace(/\\operatorname\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\([A-Za-z]+)/g, (whole, name) => LATEX_SYMBOLS[name] ?? (/^(sin|cos|tan|log|ln|exp)$/.test(name) ? name : whole))
    .replace(/\\,|\\;|\\!|\\ /g, ' ');
  return str(text, max);
}
const learnText = (value, max) => plainMath(value, max);
// Functions of x the app can draw: numbers, x, one slider letter, arithmetic and a few
// named functions. Anything else is dropped rather than drawn wrong.
const PLOT_NAMES = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'abs', 'ln', 'log', 'exp', 'floor', 'ceil', 'round', 'sign', 'pi', 'e', 'x']);
function plotExpr(value, slider) {
  let expr = plainMath(value, 160).replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '').replace(/\*\*/g, '^').replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/√/g, 'sqrt').replace(/π/g, 'pi').replace(/\{/g, '(').replace(/\}/g, ')').trim();
  if (!expr || !/^[0-9a-z.+\-*/^(), ]+$/i.test(expr)) return '';
  const names = expr.toLowerCase().match(/[a-z]+/g) || [];
  if (names.some((name) => !PLOT_NAMES.has(name) && name !== slider)) return '';
  let depth = 0;
  for (const ch of expr) { depth += ch === '(' ? 1 : ch === ')' ? -1 : 0; if (depth < 0) return ''; }
  return depth === 0 ? expr.toLowerCase() : '';
}
const num = (value, fallback) => (value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback);
function learnArgs(args = {}) {
  const kind = LEARN_KINDS.has(args.kind) ? args.kind : Array.isArray(args.questions) ? 'quiz' : Array.isArray(args.cards) ? 'flashcards' : Array.isArray(args.problems) ? 'problem' : args.plot ? 'plot' : 'quiz';
  const card = { type: 'learn', kind, title: learnText(args.title, 120) || { quiz: 'Quiz', flashcards: 'Flashcards', problem: 'Practice', plot: 'Graph' }[kind] };
  const subtitle = learnText(args.subtitle, 200);
  if (subtitle) card.subtitle = subtitle;
  if (kind === 'quiz') {
    card.questions = (Array.isArray(args.questions) ? args.questions : []).slice(0, 12).map((q) => {
      const options = [...new Set((Array.isArray(q?.options) ? q.options : []).map((o) => learnText(typeof o === 'object' ? o?.label ?? o?.text : o, 160)).filter(Boolean))].slice(0, 6);
      // The answer is the correct option's text; a letter (B) or a 0-based number also works.
      const said = String(q?.answer ?? '').trim();
      const clean = (s) => learnText(s, 160).toLowerCase().replace(/[.\s]+$/, '');
      let answer = options.findIndex((o) => clean(o) === clean(said));
      if (answer < 0 && /^[A-F]$/i.test(said)) answer = said.toUpperCase().charCodeAt(0) - 65;
      if (answer < 0 && /^\d$/.test(said)) answer = Number(said);
      if (answer < 0) answer = options.findIndex((o) => clean(said) && clean(o).replace(/^[a-f][).:]\s*/, '') === clean(said).replace(/^[a-f][).:]\s*/, ''));
      // The model puts the right option second most of the time; a fixed shuffle (the same for
      // the same question) keeps the position from giving it away. "All of the above" and
      // similar options refer to the order, so those questions keep theirs.
      if (answer >= 0 && !options.some((o) => /\b(?:all|none|both|neither) of\b|\babove\b|\bbelow\b|\b(?:alla|inget|ingen|båda) av\b|ovan/i.test(o))) {
        let seed = 0;
        for (const ch of `${q?.question}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
        const order = options.map((_, i) => i);
        const random = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
        const shuffled = order.map((i) => options[i]);
        answer = order.indexOf(answer);
        options.splice(0, options.length, ...shuffled);
      }
      const row = { question: learnText(q?.question, 400), options, answer };
      const explanation = learnText(q?.explanation, 500);
      if (explanation) row.explanation = explanation;
      return row;
    }).filter((q) => q.question && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length);
  } else if (kind === 'flashcards') {
    card.cards = (Array.isArray(args.cards) ? args.cards : []).slice(0, 30)
      .map((c) => ({ front: learnText(c?.front, 300), back: learnText(c?.back, 400) })).filter((c) => c.front && c.back);
  } else if (kind === 'problem') {
    const list = Array.isArray(args.problems) ? args.problems : args.problem ? [args.problem] : [];
    card.problems = list.slice(0, 6).map((p) => {
      const row = { question: learnText(p?.question, 600), answer: learnText(p?.answer, 120) };
      row.steps = (Array.isArray(p?.steps) ? p.steps : []).slice(0, 8).map((s) => learnText(s, 300)).filter(Boolean);
      const accept = (Array.isArray(p?.accept) ? p.accept : []).slice(0, 6).map((s) => learnText(s, 120)).filter(Boolean);
      if (accept.length) row.accept = accept;
      const explanation = learnText(p?.explanation, 600);
      if (explanation) row.explanation = explanation;
      return row;
    }).filter((p) => p.question && p.answer);
  } else {
    const plot = args.plot && typeof args.plot === 'object' ? args.plot : args;
    const name = /^[a-df-wyz]$/i.test(String(plot.slider?.name || '')) ? String(plot.slider.name).toLowerCase() : '';
    const out = {};
    if (name) {
      const min = num(plot.slider.min, -5), max = num(plot.slider.max, 5);
      if (max > min) out.slider = { name, min, max, step: Math.min(Math.abs(num(plot.slider.step, (max - min) / 100)) || (max - min) / 100, max - min), value: Math.min(max, Math.max(min, num(plot.slider.value, min <= 1 && max >= 1 ? 1 : (min + max) / 2))), ...(learnText(plot.slider.label, 60) ? { label: learnText(plot.slider.label, 60) } : {}) };
    }
    const slider = out.slider?.name || '';
    out.functions = (Array.isArray(plot.functions) ? plot.functions : []).slice(0, 4).map((f) => {
      const expr = plotExpr(typeof f === 'object' ? f?.expr ?? f?.expression : f, slider);
      return expr ? { expr, label: learnText(f?.label, 60) || `y = ${expr}` } : null;
    }).filter(Boolean);
    let xMin = num(plot.x_min ?? plot.xMin, -10), xMax = num(plot.x_max ?? plot.xMax, 10);
    if (!(xMax > xMin)) [xMin, xMax] = [-10, 10];
    out.x = [xMin, xMax];
    const yMin = num(plot.y_min ?? plot.yMin, null), yMax = num(plot.y_max ?? plot.yMax, null);
    if (yMin !== null && yMax !== null && yMax > yMin) out.y = [yMin, yMax];
    out.points = (Array.isArray(plot.points) ? plot.points : []).slice(0, 24)
      .map((p) => ({ x: num(p?.x, NaN), y: num(p?.y, NaN), label: learnText(p?.label, 40) || undefined }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const caption = learnText(plot.caption, 300);
    if (caption) out.caption = caption;
    if (!slider) delete out.slider;
    Object.assign(card, out);
  }
  return card;
}
// What the agent learns back from its own card: enough to talk about it without restating it.
function learnSummary(card) {
  const count = { quiz: card.questions?.length, flashcards: card.cards?.length, problem: card.problems?.length, plot: card.functions?.length || card.points?.length }[card.kind] || 0;
  return { shown: count > 0, kind: card.kind, title: card.title, count };
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
// "Every week, first Mon 28 Sep 09:00": the first run as the agent wrote it, in the owner's time.
function scheduleText(trigger) {
  const minutes = Number(trigger.intervalMinutes) || 60;
  const every = minutes % 10080 === 0 ? (minutes === 10080 ? 'Every week' : `Every ${minutes / 10080} weeks`)
    : minutes % 1440 === 0 ? (minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`)
    : minutes % 60 === 0 ? (minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`) : `Every ${minutes} min`;
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(String(trigger.startAt || ''));
  if (!m) return every;
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const label = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${every}, first ${label} ${m[4]}:${m[5]}`;
}
function approvalView(name, args = {}, detail) {
  const parsed = parse(detail) || {};
  switch (name) {
    case 'mail_send': return emailView('mailbox', args);
    case 'composio_execute': return appActionView(args.tool, args.args || {});
    // The owner's own API or MCP server: its name and the request, from connectors.approvalDetail.
    case 'connector_call': return { kind: 'app_action', app: '', appName: str(parsed.appName || args.connector, 80) || 'your connector', action: str(parsed.action, 120) || 'Use',
      fields: (Array.isArray(parsed.fields) ? parsed.fields : []).slice(0, 10).map((f) => ({ k: str(f?.k, 80), v: str(f?.v, 600) })) };
    case 'shop_purchase': {
      const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 8).map((item) => ({
        title: str(item.title, 140) || 'Item', quantity: Number(item.quantity) || 1, price: money(item.price, parsed.currency) }));
      return { kind: 'purchase', merchant: str(parsed.merchant || args.merchant, 120), website: str(`https://${parsed.merchant || args.merchant}`, 300), items, total: money(parsed.amount, parsed.currency),
        payment: 'Shop Pay', fundedBy: 'own', email: str(parsed.buyerEmail, 120), delivery: (Array.isArray(parsed.delivery) ? parsed.delivery : []).map((d) => str(d, 200)).slice(0, 2), estimated:false };
    }
    case 'browser_submit':
      if (parsed.paymentMethod && args.purchase) return { kind:'purchase', merchant:str(parsed.merchant,120), website:str(parsed.website,500),
        items:(parsed.items || []).slice(0,12).map((item)=>({title:str(item.title,140),quantity:Number(item.quantity)||1,price:money(item.price,parsed.currency)})),
        total:money(parsed.amount,parsed.currency), payment:str(parsed.payment,80), delivery:[str(parsed.shippingAddress,300)], estimated:false,
        checkoutExcerpt:str(parsed.pageExcerpt,650), fundedBy:parsed.paymentMethod==='belna_wallet'?'balance':'own',
        // Swish and Klarna: the owner approves the payment on their phone after this click.
        ...(parsed.paymentMethod==='payment_app' ? { phoneApproval:str(parsed.payment,80) } : {}) };
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
      const when = trigger.type === 'schedule' ? scheduleText(trigger)
        : trigger.type === 'app' ? `When ${toolkitName(trigger.app)} has new activity` : trigger.type === 'subagent' ? 'After another automation runs' : '';
      return { kind: 'automation', name: str(args.name, 120), prompt: str(args.prompt, 600), when };
    }
    // Money the owner approves: the exact amount and recipient from the approved detail, never raw JSON.
    case 'wallet_send': return { kind: 'money', action: 'send', amount: money(parsed.amount, parsed.currency), to: str(parsed.recipient, 200), note: str(parsed.fees, 200) };
    case 'wallet_withdraw': return {kind:'money',action:'bank_withdraw',amount:money(parsed.amount,parsed.currency),to:str(parsed.recipient,200),note:'EUR bank payout after conversion and fees. Owner must authorize in Wallet.'};
    case 'wallet_earn': return { kind:'money', action:parsed.kind==='earn_withdraw'?'earn_withdraw':'earn_deposit',amount:money(parsed.amount,parsed.currency),to:'Earn',note:str(parsed.risk,400) };
    case 'wallet_set_limit': return { kind: 'money', action: 'limit', amount: money(parsed.dailyLimitUsd, parsed.currency) };
    case 'wallet_pause': return { kind: 'money', action: parsed.paused === false ? 'resume' : 'pause' };
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
  money: (v) => (v.action === 'send' ? `Send ${v.amount}${v.to ? ` to ${v.to}` : ''}` : v.action === 'bank_withdraw' ? `Request ${v.amount} USD withdrawal${v.to ? ` to ${v.to}` : ''}` : v.action === 'earn_deposit' ? `Request ${v.amount} USD deposit into Earn` : v.action === 'earn_withdraw' ? `Request ${v.amount} USD withdrawal from Earn` : v.action === 'limit' ? `Set your 24-hour transfer limit to ${v.amount}` : v.action === 'resume' ? 'Resume wallet transfers' : 'Pause wallet transfers'),
};
function approvalCard(name, args = {}, detail = '', tool = {}, key) {
  if (name === 'ask_user') return { ...questionArgs(args), status: 'pending' };
  if (name === 'connect_app') return { ...connectArgs(args), status: 'pending' };
  if (tool && typeof tool.approvalCard === 'function') return { ...tool.approvalCard(args, detail), status: 'pending' };
  const view = approvalView(name, args, detail);
  const title = HEADLINES[view.kind] ? HEADLINES[view.kind](view) : name;
  return { type: 'approval', status: 'pending', title: str(title, 200), detail: String(detail || '').slice(0, 2000), key: key || name, tool: name, rememberable:JSON.stringify(args).length<=2000 && ((name==='composio_execute' && !!args.connectedAccountId) || (name==='connector_call' && !!args.connector && !!(args.tool || (args.method && args.path)))),view };
}

/* ---------- results ---------- */
const stars = (rating) => (Number(rating?.value) > 0 ? `★ ${Number(rating.value).toFixed(1)}${Number(rating.count) > 0 ? ` (${Number(rating.count)})` : ''}` : undefined);
// Each product opens its page in the merchant's store; a store link from the web shows
// what the search said about it.
function productItems(products = []) {
  return products.slice(0, 12).map((product) => ({
    title: str(product.title, 140), subtitle: str(product.seller?.name || product.seller?.domain, 120),
    ...(money(product.price) ? { price: money(product.price) } : {}), ...(stars(product.rating) || product.snippet ? { meta: stars(product.rating) || str(product.snippet, 160) } : {}), image: httpsUrl(product.image) || undefined,
    url: httpsUrl(product.url || product.variants?.find((v) => v?.url)?.url) || undefined,
  })).filter((item) => item.title);
}
function resultCard(name, out, args = {}) {
  if (!out || typeof out !== 'object') return null;
  if (name === 'present') return { ...presentArgs(args && args.title ? args : out), status: 'done' };
  if (name === 'learn' && out.shown) return { ...learnArgs(args), status: 'done' };
  // No matches shows no card; the agent says so and looks elsewhere.
  if ((name === 'product_search' || name === 'shop_search') && Array.isArray(out.products) && out.products.length) {
    const items = productItems(out.products);
    // A budget the owner gave shows on the card, so they see it was applied.
    const budget = out.maxPrice ? money(out.maxPrice, out.currency) : '';
    return { type: 'present', kind: 'products', title: str(args.query, 80) ? `Results for “${str(args.query, 80)}”` : 'Products',
      ...(budget ? { subtitle: `${items.length} under ${budget}` } : {}), items, status: 'done' };
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
  // An app that is connected needs no card: the pending connect card (if one asked)
  // updates itself, and an app that was already connected just gets used.
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
  // A numbered list of named picks ("1. **Wander Alfama** — …") is a list card. Only items
  // that each lead with a bold name count, so ordinary numbered instructions stay text.
  const picks = lines.map((line, index) => ({ index, m: line.match(/^\s*\d+[.)]\s+\*\*([^*]{2,120})\*\*\s*(?:[—–:-]\s*)?(.*)$/) })).filter((row) => row.m);
  if (picks.length >= 4) {
    const first = picks[0].index;
    const intro = lines.slice(0, first).map((line, index) => ({ line, index })).filter(({ line }) => line.trim()).at(-1);
    const titleLine = intro && (/^#{1,4}\s+/.test(intro.line) || /:\s*$/.test(intro.line)) ? intro : null;
    const title = titleLine ? titleLine.line.replace(/^#+\s*/, '').replace(/[*:]+/g, '').trim() : 'List';
    const items = picks.map(({ m }) => ({ title: m[1].replace(/[.:]+$/, '').trim(), subtitle: m[2].replace(/\*\*/g, '').trim() || undefined }));
    const used = new Set([...picks.map((row) => row.index), ...(titleLine ? [titleLine.index] : [])]);
    const rest = lines.filter((line, index) => !used.has(index)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { card: presentArgs({ kind: 'list', title: title.slice(0, 120) || 'List', items }), rest };
  }
  return null;
}

export { questionArgs, presentArgs, learnArgs, learnSummary, plainMath, connectArgs, approvalView, approvalCard, resultCard, cardFromMarkdown, toolkitName };
