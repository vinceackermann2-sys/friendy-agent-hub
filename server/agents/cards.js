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

/* ---------- calculator formulas ----------
   A calculator card's outputs are formulas of its inputs ("bill * (1 + tip / 100) / people").
   The app works them out as the owner moves the inputs, with the same small grammar: numbers,
   named values, + - * / ^ and parentheses, and a few functions. Never eval. */
const CALC_FUNCS = { sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, sin: Math.sin, cos: Math.cos, tan: Math.tan };
const CALC_MULTI = { min: Math.min, max: Math.max };
const CALC_RESERVED = new Set([...Object.keys(CALC_FUNCS), ...Object.keys(CALC_MULTI), 'pi', 'e']);
function calcCompile(src, names) {
  const s = String(src ?? '').toLowerCase().replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\*\*/g, '^');
  if (!s.trim() || s.length > 300) return null;
  const known = names instanceof Set ? names : new Set(names || []);
  const toks = [];
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/.exec(s.slice(i, i + 40));
    if (num) { toks.push({ t: 'n', v: Number(num[0]) }); i += num[0].length; continue; }
    const word = /^[a-z_][a-z0-9_]*/.exec(s.slice(i, i + 40));
    if (word) { toks.push({ t: 'id', v: word[0] }); i += word[0].length; continue; }
    if ('+-*/^(),'.includes(ch)) { toks.push({ t: ch }); i++; continue; }
    return null;
  }
  let k = 0;
  const peek = () => toks[k], take = (t) => (toks[k] && toks[k].t === t ? toks[k++] : null);
  const expr = () => { let a = term(); for (;;) { if (take('+')) { const l = a, r = term(); a = (v) => l(v) + r(v); } else if (take('-')) { const l = a, r = term(); a = (v) => l(v) - r(v); } else return a; } };
  const term = () => { let a = unary(); for (;;) {
    if (take('*')) { const l = a, r = unary(); a = (v) => l(v) * r(v); }
    else if (take('/')) { const l = a, r = unary(); a = (v) => l(v) / r(v); }
    else if (peek() && ['n', 'id', '('].includes(peek().t)) { const l = a, r = power(); a = (v) => l(v) * r(v); }
    else return a; } };
  const unary = () => { if (take('-')) { const a = unary(); return (v) => -a(v); } if (take('+')) return unary(); return power(); };
  const power = () => { const base = atom(); if (take('^')) { const ex = unary(); return (v) => Math.pow(base(v), ex(v)); } return base; };
  const atom = () => {
    const tok = toks[k++];
    if (!tok) throw new Error('end');
    if (tok.t === 'n') return () => tok.v;
    if (tok.t === '(') { const a = expr(); if (!take(')')) throw new Error(')'); return a; }
    if (tok.t !== 'id') throw new Error('token');
    if (CALC_FUNCS[tok.v] || CALC_MULTI[tok.v]) {
      if (!take('(')) throw new Error('(');
      const args = [expr()];
      while (CALC_MULTI[tok.v] && take(',')) args.push(expr());
      if (!take(')')) throw new Error(')');
      const f = CALC_FUNCS[tok.v] || CALC_MULTI[tok.v];
      return (v) => f(...args.map((a) => a(v)));
    }
    if (tok.v === 'pi') return () => Math.PI;
    if (tok.v === 'e') return () => Math.E;
    if (!known.has(tok.v)) throw new Error('name');
    const name = tok.v;
    return (v) => Number(v[name]);
  };
  try { const fn = expr(); return k === toks.length ? fn : null; } catch { return null; }
}
const calcName = (value) => { const name = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_'); return /^[a-z][a-z0-9_]{0,23}$/.test(name) && !CALC_RESERVED.has(name) ? name : ''; };
// Inputs the owner moves and outputs worked out from them; outputs that do not read as a
// formula of the inputs (and the outputs before them) are dropped rather than shown wrong.
function calcArgs(args = {}) {
  const inputs = [];
  for (const input of (Array.isArray(args.inputs) ? args.inputs : []).slice(0, 6)) {
    const name = calcName(input?.name ?? input?.label);
    if (!name || inputs.some((x) => x.name === name)) continue;
    const row = { name, label: str(input?.label, 60) || name };
    let min = num(input?.min, null), max = num(input?.max, null);
    if (min !== null && max !== null && !(max > min)) [min, max] = [null, null];
    let value = num(input?.value ?? input?.default, min ?? 0);
    if (min !== null) value = Math.max(min, value);
    if (max !== null) value = Math.min(max, value);
    const step = Math.abs(num(input?.step, 0));
    if (min !== null) row.min = min;
    if (max !== null) row.max = max;
    row.value = value;
    if (step > 0) row.step = step;
    const unit = str(input?.unit, 12);
    if (unit) row.unit = unit;
    inputs.push(row);
  }
  const names = new Set(inputs.map((x) => x.name));
  const outputs = [];
  for (const output of (Array.isArray(args.outputs) ? args.outputs : []).slice(0, 6)) {
    const formula = str(output?.formula ?? output?.expr, 300);
    if (!calcCompile(formula, names)) continue;
    const row = { label: str(output?.label, 60) || 'Result', formula };
    const name = calcName(output?.name);
    if (name && !names.has(name)) { row.name = name; names.add(name); }
    const decimals = num(output?.decimals, null);
    if (decimals !== null) row.decimals = Math.max(0, Math.min(6, Math.round(decimals)));
    const unit = str(output?.unit, 12);
    if (unit) row.unit = unit;
    outputs.push(row);
  }
  // A graph of one output as one input runs over a range ("the balance over 30 years").
  const graph = args.graph && typeof args.graph === 'object' ? args.graph : null;
  const x = graph ? inputs.find((input) => input.name === calcName(graph.x)) : null;
  if (x && outputs.length) {
    const wanted = String(graph.output ?? '').trim().toLowerCase();
    // The output it names, else the last one (usually the result the calculator is for).
    const found = outputs.findIndex((output) => output.label.toLowerCase() === wanted || output.name === calcName(wanted));
    const from = num(graph.from, x.min ?? 0), to = num(graph.to, x.max ?? (x.value > 0 ? x.value * 2 : 10));
    if (to > from) return { inputs, outputs, graph: { x: x.name, from, to, output: found >= 0 ? found : outputs.length - 1 } };
  }
  return { inputs, outputs };
}
// What a calculator shows for these input values (the defaults when none are given).
function calcResults(card, values = {}) {
  const v = {};
  for (const input of card.inputs || []) v[input.name] = Number.isFinite(Number(values[input.name])) ? Number(values[input.name]) : input.value;
  const names = new Set(Object.keys(v));
  return (card.outputs || []).map((output) => {
    const fn = calcCompile(output.formula, names);
    let value = NaN;
    try { value = fn ? fn(v) : NaN; } catch {}
    if (output.name) { v[output.name] = value; names.add(output.name); }
    return { label: output.label, value: Number.isFinite(value) ? value : null };
  });
}

/* ---------- cards drawn while the model writes them ----------
   A function call's arguments arrive a few characters at a time. partialJson reads the part
   written so far as the JSON it will become: open strings, arrays and objects are closed and
   a key still waiting for its value is left out. null when nothing usable is there yet. */
function partialJson(text) {
  const s = String(text || '');
  const stack = [];
  let cut = -1, cutClose = '', inString = false, escaped = false, keyString = false;
  const closers = () => stack.map((frame) => frame.close).reverse().join('');
  const settled = (end) => { const top = stack[stack.length - 1]; if (top) top.state = 'next'; cut = end; cutClose = closers(); };
  let i = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') { inString = false; if (keyString) stack[stack.length - 1].state = 'colon'; else settled(i + 1); }
      continue;
    }
    if (ch === '"') { const top = stack[stack.length - 1]; inString = true; keyString = !!top && top.close === '}' && top.state === 'key'; continue; }
    if (ch === '{' || ch === '[') { stack.push({ close: ch === '{' ? '}' : ']', state: ch === '{' ? 'key' : 'value' }); cut = i + 1; cutClose = closers(); continue; }
    if (ch === '}' || ch === ']') { stack.pop(); settled(i + 1); continue; }
    if (ch === ':') { if (stack.length) stack[stack.length - 1].state = 'value'; continue; }
    if (ch === ',') { const top = stack[stack.length - 1]; if (top) top.state = top.close === '}' ? 'key' : 'value'; continue; }
    if (/\s/.test(ch)) continue;
    // A number or literal counts once something follows it; at the very end it may be unfinished.
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i, i + 40));
    if (!literal || i + literal[0].length >= s.length) break;
    i += literal[0].length - 1;
    settled(i + 1);
  }
  let body = cut >= 0 ? s.slice(0, cut) + cutClose : '';
  // A value still being written shows as far as it goes (without a half-written escape).
  if (inString && !keyString && i >= s.length) body = s.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, '') + '"' + closers();
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

/* ---------- recipes, forecasts and drafts ----------
   A recipe's ingredient amounts are numbers, so the app can scale them to other servings;
   a forecast's days carry one of a few conditions the app draws as icons; a draft is text
   the owner edits, copies or opens in their mail app. */
function recipeArgs(args = {}) {
  const servings = num(args.servings, 0);
  const out = { ingredients: (Array.isArray(args.ingredients) ? args.ingredients : []).slice(0, 30).map((row) => {
    if (typeof row !== 'object' || !row) return { item: str(row, 120) };
    const amount = num(row.amount, null);
    return { item: str(row.item ?? row.name, 120), ...(amount !== null && amount > 0 && amount < 100000 ? { amount } : {}), ...(str(row.unit, 20) ? { unit: str(row.unit, 20) } : {}), ...(str(row.note, 60) ? { note: str(row.note, 60) } : {}) };
  }).filter((row) => row.item),
  steps: strList(args.steps, 20, 400) };
  if (servings > 0 && servings <= 100) out.servings = Math.round(servings);
  const time = str(args.time, 40);
  if (time) out.time = time;
  return out;
}
const FORECAST_SKY = new Set(['sun', 'partly', 'cloud', 'rain', 'showers', 'snow', 'storm', 'fog', 'wind']);
function forecastArgs(args = {}) {
  const days = (Array.isArray(args.days) ? args.days : []).slice(0, 10).map((day) => {
    const row = { when: str(day?.when, 30), sky: FORECAST_SKY.has(day?.sky) ? day.sky : 'cloud' };
    const high = num(day?.high, null), low = num(day?.low, null);
    if (high !== null && Math.abs(high) < 70) row.high = Math.round(high);
    if (low !== null && Math.abs(low) < 70) row.low = Math.round(low);
    for (const key of ['rain', 'wind', 'note']) { const v = str(day?.[key], key === 'note' ? 80 : 24); if (v) row[key] = v; }
    return row;
  }).filter((day) => day.when);
  return { days, unit: args.unit === 'F' ? 'F' : 'C', ...(str(args.place, 80) ? { place: str(args.place, 80) } : {}) };
}
function draftArgs(args = {}) {
  const out = { body: String(args.body ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 6000) };
  const to = str(args.to, 200), subject = str(args.subject, 200);
  if (to) out.to = to;
  if (subject) out.subject = subject;
  return out;
}

const PRESENT_KINDS = new Set(['list', 'gallery', 'dashboard', 'table', 'steps', 'checklist', 'timeline', 'compare', 'places', 'calculator', 'recipe', 'forecast', 'draft', 'plan']);
// A plan is one card of a few parts the owner uses together, each a card of its own kind under
// a numbered heading: a dinner party's menu (with photos), shopping list, cooking schedule and budget.
const PLAN_PARTS = new Set(['list', 'checklist', 'timeline', 'table', 'steps']);
function planSections(value) {
  return (Array.isArray(value) ? value : []).slice(0, 5).map((section) => {
    if (!section || typeof section !== 'object') return null;
    const kind = PLAN_PARTS.has(section.kind) ? section.kind : 'list';
    const part = presentArgs({ ...section, kind, refine: undefined });
    const out = { kind, title: str(section.title, 80) };
    if (part.items.length) out.items = part.items;
    if (kind === 'table' && part.rows.length) { out.rows = part.rows; if (part.columns.some(Boolean)) out.columns = part.columns; }
    if (part.note) out.note = part.note;
    return out;
  }).filter((section) => section && ((section.items || []).length || (section.rows || []).length));
}
const strList = (value, count, max) => (Array.isArray(value) ? value : []).slice(0, count).map((v) => str(v, max)).filter(Boolean);
// "Help me choose": a few questions whose answers would change the pick (what they use now,
// what matters most, the budget), each with short options. The owner picks and sends them
// together, and the answers come back as their next message.
function refineArgs(value) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map((q) => ({
    q: str(q?.question ?? q?.q, 120),
    options: [...new Set(strList(q?.options, 6, 60))],
  })).filter((q) => q.q && q.options.length >= 2).slice(0, 3);
}
function presentArgs(args = {}) {
  const kind = PRESENT_KINDS.has(args.kind) ? args.kind : 'list';
  const card = { type: 'present', kind, title: str(args.title, 120) || 'Overview' };
  const subtitle = str(args.subtitle, 200);
  if (subtitle) card.subtitle = subtitle;
  // Short facts under the heading ("≈ 480 km", "5–7 h driving", "Serves 4").
  // A longer one is a note, not a fact: it is left out rather than cut off mid-word.
  const facts = (Array.isArray(args.facts) ? args.facts : []).map((fact) => String(fact ?? '').replace(/\s+/g, ' ').trim()).filter((fact) => fact && fact.length <= 40).slice(0, 4);
  if (facts.length) card.facts = facts;
  card.items = (Array.isArray(args.items) ? args.items : []).slice(0, 24).map((item) => {
    const row = { title: str(item?.title ?? item, 140) };
    for (const key of ['subtitle', 'meta', 'badge', 'price']) { const v = str(item?.[key], 160); if (v) row[key] = v; }
    // A timeline step's time or day ("09:00", "Day 2") and the day or section it belongs to.
    for (const key of ['when', 'group']) { const v = str(item?.[key], 40); if (v) row[key] = v; }
    const address = str(item?.address, 160);
    if (address) row.address = address;
    const rating = num(item?.rating, null);
    if (rating !== null && rating > 0 && rating <= 5) row.rating = Math.round(rating * 10) / 10;
    const image = httpsUrl(item?.image);
    const url = httpsUrl(item?.url);
    if (image) row.image = image;
    // Words for a photo the server looks up when the item has no image of its own.
    else { const query = str(item?.image_query, 80); if (query) row.imageQuery = query; }
    if (url) row.url = url;
    if (item && typeof item === 'object' && typeof item.done === 'boolean') row.done = item.done;
    // A compared option's strengths and weaknesses.
    const pros = strList(item?.pros, 5, 120), cons = strList(item?.cons, 5, 120);
    if (pros.length) row.pros = pros;
    if (cons.length) row.cons = cons;
    return row;
  }).filter((row) => row.title);
  if (kind === 'compare') {
    card.items = card.items.slice(0, 4);
    const pick = str(args.pick, 140);
    if (pick) card.pick = pick;
  }
  // A checklist is ticked off in the app: up to 60 things, in their sections.
  if (kind === 'checklist') card.items = (Array.isArray(args.items) ? args.items : []).slice(0, 60).map((item) => {
    const row = { title: str(item?.title ?? item, 140) };
    const note = str(item?.subtitle, 120), group = str(item?.group, 40);
    if (note) row.subtitle = note;
    if (group) row.group = group;
    if (item && typeof item === 'object' && item.done === true) row.done = true;
    return row;
  }).filter((row) => row.title);
  if (['compare', 'list', 'products', 'places'].includes(kind)) {
    const refine = refineArgs(args.refine);
    if (refine.length) card.refine = refine;
  }
  // A line under the card for what its figures assume ("Approximate supermarket prices").
  const note = str(args.note, 240);
  if (note) card.note = note;
  if (kind === 'plan') card.sections = planSections(args.sections);
  if (kind === 'calculator') Object.assign(card, calcArgs(args));
  if (kind === 'recipe') Object.assign(card, recipeArgs(args));
  if (kind === 'forecast') Object.assign(card, forecastArgs(args));
  if (kind === 'draft') Object.assign(card, draftArgs(args));
  // A recipe or anything else may have one photo of its own at the top.
  const image = httpsUrl(args.image);
  if (image) card.image = image;
  else if (str(args.image_query, 80) && ['recipe', 'places', 'timeline', 'list'].includes(kind)) card.imageQuery = str(args.image_query, 80);
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
    // A donut shows shares of one whole (a budget, a split): one series, no negatives.
    const donut = chart.type === 'donut' && series[0]?.values.every((v) => v >= 0) && series[0].values.some((v) => v > 0);
    if (series.length) card.chart = { type: donut ? 'donut' : chart.type === 'line' ? 'line' : 'bar', labels, series: donut ? series.slice(0, 1) : series };
  }
  card.columns = (Array.isArray(args.columns) ? args.columns : []).slice(0, 8).map((column) => str(column, 40));
  card.rows = (Array.isArray(args.rows) ? args.rows : []).slice(0, 40).map((row) => (Array.isArray(row) ? row : [row]).slice(0, 8).map((cell) => str(cell, 140)));
  return card;
}
// What the agent learns back from a present card. A card with nothing to show is not shown,
// and the note says what to fix.
function presentSummary(card) {
  const filled = card.kind === 'calculator' ? card.inputs.length > 0 && card.outputs.length > 0
    : card.kind === 'recipe' ? card.ingredients.length > 0 || card.steps.length > 0
    // A forecast without temperatures is only icons: the reply says what the results show instead.
    : card.kind === 'forecast' ? card.days.some((day) => day.high != null || day.low != null)
    : card.kind === 'draft' ? !!card.body
    // A plan of one part is that part's own card; it needs two.
    : card.kind === 'plan' ? (card.sections || []).length >= 2
    : card.items.length > 0 || card.rows.length > 0 || card.metrics.length > 0 || !!card.chart;
  if (filled) return { shown: true, kind: card.kind, title: card.title };
  const fix = { calculator: 'a calculator needs inputs (each with a short lowercase name and a default value) and outputs whose formula uses only those names, numbers, + - * / ^ ( ) and min, max, round, sqrt',
    recipe: 'a recipe needs ingredients (item, and amount as a number with its unit) and steps',
    forecast: 'a forecast needs days, each with when, sky and the high/low temperatures the results give (when they give none, answer in text instead of a card)',
    draft: 'a draft needs its body text',
    plan: 'a plan needs two to four sections, each with its kind (list, checklist, timeline, table or steps), a title and its items or rows; for one part, use that kind on its own' }[card.kind] || 'the card had no items, rows or metrics';
  return { shown: false, kind: card.kind, title: card.title, note: `Nothing to show: ${fix}. Call present again with fixed arguments.` };
}

/* ---------- photos for cards ----------
   An item the model names with image_query ("Belém Tower Lisbon") gets the photo of the
   Wikipedia article that best matches it, and a link to that article: free, licensed, fast
   (one API call), and only for things that have an article. A result whose title shares no
   word with the query is not used, so a café never shows its district's photo. */
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
// Everything on a card that can hold a photo: the card, its items and an explainer's steps.
const imageHolders = (card) => [card, ...(card.items || []), ...(Array.isArray(card.steps) ? card.steps.filter((step) => step && typeof step === 'object') : []),
  ...(Array.isArray(card.sections) ? card.sections.flatMap((section) => section?.items || []) : [])];
const imageCache = new Map();
// A query with no photo is remembered for a while: a streaming card asks again on every
// delta, which would otherwise send Wikipedia a new search each time the last one ends.
const imageMisses = new Map(), IMAGE_MISS_MS = 5 * 60000;
const foldWords = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
async function lookupImage(query, { fetch: get = globalThis.fetch, timeoutMs = 2500 } = {}) {
  const key = String(query || '').trim().toLowerCase().slice(0, 80);
  if (!key || typeof get !== 'function') return null;
  if (imageCache.has(key)) return imageCache.get(key);
  if (Date.now() - (imageMisses.get(key) || 0) < IMAGE_MISS_MS) return null;
  const job = (async () => {
    const url = `${WIKI_API}?action=query&format=json&formatversion=2&generator=search&gsrsearch=${encodeURIComponent(key)}&gsrlimit=3&prop=pageimages%7Cinfo&piprop=thumbnail&pithumbsize=500&inprop=url&redirects=1`;
    const res = await get(url, { headers: { 'Api-User-Agent': 'Belna/1.0 (https://belna.se)', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const pages = ((await res.json())?.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0));
    const words = new Set(foldWords(key));
    // The article sharing the most words with the query, then the search's own order:
    // "Gamla Linköping" is the open-air museum's article, not the city's.
    const shared = (p) => foldWords(p.title).filter((w) => words.has(w)).length;
    const page = pages.filter((p) => p.thumbnail?.source && shared(p) > 0).sort((a, b) => shared(b) - shared(a))[0];
    const image = httpsUrl(page?.thumbnail?.source), link = httpsUrl(page?.fullurl);
    return image ? { image, link } : null;
  })().catch(() => null);
  imageCache.set(key, job);
  if (imageCache.size > 500) imageCache.delete(imageCache.keys().next().value);
  const found = await job;
  if (!found) {
    imageCache.delete(key);
    imageMisses.set(key, Date.now());
    if (imageMisses.size > 500) imageMisses.delete(imageMisses.keys().next().value);
  }
  return found;
}
// Looks up every photo a card asks for at once and fills them in (the image links to its
// article when the item has no link of its own). Never waits longer than timeoutMs.
async function resolveCardImages(card, options = {}) {
  const wanted = imageHolders(card).filter((x) => x.imageQuery && !x.image).slice(0, 13);
  if (!wanted.length) return card;
  const find = options.lookup || ((query) => lookupImage(query, options));
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, options.timeoutMs || 2500); });
  await Promise.all(wanted.map(async (x) => {
    const found = await Promise.race([Promise.resolve(find(x.imageQuery)).catch(() => null), deadline]);
    if (found?.image) { x.image = found.image; if (found.link && !x.url) x.imageLink = found.link; }
  }));
  clearTimeout(timer);
  for (const x of imageHolders(card)) delete x.imageQuery;
  return card;
}
// The photos a card names, by query, for a worker's present call to carry to its card.
async function cardImages(card, options = {}) {
  const copy = JSON.parse(JSON.stringify(card));
  const queries = imageHolders(copy).map((x) => x.imageQuery).filter(Boolean);
  if (!queries.length) return {};
  await resolveCardImages(copy, options);
  const found = {};
  const copies = imageHolders(copy);
  imageHolders(card).forEach((x, i) => { const y = copies[i]; if (x.imageQuery && y?.image) found[x.imageQuery.toLowerCase()] = { image: y.image, ...(y.imageLink ? { link: y.imageLink } : {}) }; });
  return found;
}
// The photos a worker's present call found, applied to the card built from its arguments.
function applyImages(card, images) {
  if (!images || typeof images !== 'object') return card;
  for (const x of imageHolders(card)) {
    const found = x.imageQuery && images[x.imageQuery.toLowerCase()];
    if (found && httpsUrl(found.image)) { x.image = httpsUrl(found.image); if (!x.url && httpsUrl(found.link)) x.imageLink = httpsUrl(found.link); }
    delete x.imageQuery;
  }
  return card;
}

/* ---------- learning cards (learn) ----------
   Interactive cards the owner works through in the chat: a quiz, flashcards, practice
   problems with hints and a checked answer, or a graph of functions with a slider. The
   app renders and scores them locally, so nothing here calls a model. */
const LEARN_KINDS = new Set(['quiz', 'flashcards', 'problem', 'plot', 'explain', 'diagram', 'match', 'order']);
// A fixed shuffle for the same content (never the answer order itself), so a matching or
// ordering exercise does not give its answer away by position.
function seededOrder(count, seedText) {
  let seed = 0;
  for (const ch of String(seedText)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const order = Array.from({ length: count }, (_, i) => i);
  const random = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  if (count > 1 && order.every((v, i) => v === i)) order.push(order.shift());
  return order;
}
const DIAGRAM_LAYOUTS = new Set(['flow', 'cycle', 'hub']);
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
  const card = { type: 'learn', kind, title: learnText(args.title, 120) || { quiz: 'Quiz', flashcards: 'Flashcards', problem: 'Practice', plot: 'Graph', explain: 'How it works', diagram: 'Diagram', match: 'Match', order: 'Put in order' }[kind] };
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
  } else if (kind === 'explain') {
    // A walkthrough the owner steps through: a short title, the explanation, the point to keep,
    // and a photo when one helps (a named thing, looked up like a present item's).
    card.steps = (Array.isArray(args.steps) ? args.steps : []).slice(0, 8).map((step) => {
      const row = { title: learnText(step?.title, 80), text: learnText(step?.text ?? step, 700) };
      const point = learnText(step?.point, 200);
      if (point) row.point = point;
      const image = httpsUrl(step?.image);
      if (image) row.image = image;
      else if (str(step?.image_query, 80)) row.imageQuery = str(step.image_query, 80);
      return row;
    }).filter((step) => step.text);
  } else if (kind === 'diagram') {
    // How the parts connect: a flow (one thing leads to the next), a cycle (it comes round
    // again) or a hub (parts around a centre). Each part opens its detail when tapped.
    card.layout = DIAGRAM_LAYOUTS.has(args.layout) ? args.layout : 'flow';
    card.nodes = (Array.isArray(args.nodes) ? args.nodes : []).slice(0, 8).map((node) => { const detail = learnText(node?.detail, 500); return { label: learnText(node?.label ?? node, 48), ...(detail ? { detail } : {}) }; }).filter((node) => node.label);
    const center = learnText(args.center, 48);
    if (card.layout === 'hub') card.center = center || card.title;
    const caption = learnText(args.caption, 300);
    if (caption) card.caption = caption;
  } else if (kind === 'match') {
    const seen = new Set();
    card.pairs = (Array.isArray(args.pairs) ? args.pairs : []).slice(0, 8).map((pair) => ({ term: learnText(pair?.term, 100), match: learnText(pair?.match, 160) }))
      .filter((pair) => pair.term && pair.match && !seen.has(pair.match.toLowerCase()) && seen.add(pair.match.toLowerCase()));
    // The matches column in a fixed shuffled order.
    card.order = seededOrder(card.pairs.length, card.pairs.map((pair) => pair.term).join('|'));
  } else if (kind === 'order') {
    // The items in their correct order, shown shuffled; the owner taps them in order.
    card.sequence = [...new Set((Array.isArray(args.sequence) ? args.sequence : []).slice(0, 10).map((item) => learnText(item, 140)).filter(Boolean))];
    card.shuffled = seededOrder(card.sequence.length, card.sequence.join('|'));
    const explanation = learnText(args.explanation, 500);
    if (explanation) card.explanation = explanation;
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
  const count = { quiz: card.questions?.length, flashcards: card.cards?.length, problem: card.problems?.length, plot: card.functions?.length || card.points?.length,
    explain: card.steps?.length, diagram: card.nodes?.length, match: card.pairs?.length, order: card.sequence?.length }[card.kind] || 0;
  // A diagram, match or order needs a few parts to mean anything.
  const least = { diagram: 2, match: 2, order: 3, explain: 2 }[card.kind] || 1;
  return { shown: count >= least, kind: card.kind, title: card.title, count };
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
// Apple apps on the owner's device, in words: what changes or is shared, never the action
// name and raw JSON. The device shows the exact item and asks again before it acts.
const APPLE_APPS = { calendar: 'Apple Calendar', reminders: 'Apple Reminders', contacts: 'Apple Contacts', health: 'Apple Health' };
const APPLE_ITEMS = { calendar: 'an event', reminders: 'a reminder', contacts: 'a contact' };
function appleView(args = {}) {
  const [scope, verb] = String(args.action || '').split('.');
  const input = args.args && typeof args.args === 'object' && !Array.isArray(args.args) ? args.args : {};
  const appName = APPLE_APPS[scope] || 'an Apple app';
  const named = str(input.title || [input.givenName, input.familyName].filter(Boolean).join(' '), 120);
  const item = named ? `“${named}”` : APPLE_ITEMS[scope] || 'an item';
  const headline = scope === 'health' ? 'Share a wellness summary from Apple Health'
    : verb === 'list' ? `Read ${appName}`
    : verb === 'search' ? `Search ${appName}${input.query ? ` for “${str(input.query, 100)}”` : ''}`
    : verb === 'create' ? `Add ${item} to ${appName}`
    : verb === 'delete' ? `Delete ${item} from ${appName}`
    : verb === 'complete' ? `${input.completed === false ? 'Reopen' : 'Complete'} ${item} in ${appName}`
    : `Change ${item} in ${appName}`;
  const days = Math.min(7, Math.max(1, Number(input.days) || 1));
  const fields = scope === 'health'
    ? [input.start ? { k: 'Since', v: str(input.start, 80) } : { k: 'Covers', v: days === 1 ? 'The last 24 hours' : `The last ${days} days` }, { k: 'Includes', v: 'Steps, distance, exercise and sleep' }]
    // A new item's title or name is already in the headline.
    : [['Title', verb === 'create' ? '' : input.title], ['Name', verb === 'create' ? '' : [input.givenName, input.familyName].filter(Boolean).join(' ')], [verb === 'list' ? 'From' : 'Starts', input.start], [verb === 'list' ? 'To' : 'Ends', input.end],
      ['Due', input.due], ['Where', input.location], ['Email', input.email], ['Phone', input.phone], ['Notes', input.notes]]
      .filter(([, v]) => v != null && String(v).trim()).map(([k, v]) => ({ k, v: str(v, 300) }));
  const note = scope === 'health' ? 'Belna on your device shows you the numbers, and you choose whether to share them.'
    : ['list', 'search'].includes(verb) ? 'Belna must be open on your device.' : 'Belna on your device shows you the exact item and asks once more before it changes anything.';
  return { kind: 'apple', app: APPLE_APPS[scope] ? `apple_${scope}` : '', appName, headline, fields, note };
}
function approvalView(name, args = {}, detail) {
  const parsed = parse(detail) || {};
  switch (name) {
    case 'apple_execute': return appleView(args);
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
        // Payment apps (Swish, Klarna, Shop Pay…): the owner approves the payment themselves.
        ...(['payment_app','shop_pay'].includes(parsed.paymentMethod) ? { phoneApproval:str(parsed.payment,80) } : {}) };
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
  apple: (v) => v.headline,
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
  if (name === 'present' && out?.shown !== false) return { ...applyImages(presentArgs(args && args.title ? args : out), out.images), status: 'done' };
  if (name === 'learn' && out.shown) return { ...applyImages(learnArgs(args), out.images), status: 'done' };
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

// An email the model wrote out as text ("Subject: …", greeting, body, sign-off) becomes a draft
// card the owner can edit, copy or open in their mail app. Text before the subject line and after
// the signature stays the reply. Only a subject line near the top with a real body converts.
const DRAFT_FIELD = /^\s*(subject|ämne|betreff|objet|asunto|oggetto|to|till)\s*:\s*(.+?)\s*$/i;
const SIGN_OFF = /^\s*(?:best(?: regards| wishes)?|kind regards|regards|warm regards|many thanks|thanks(?: so much)?|thank you|cheers|sincerely|yours sincerely|all the best|med vänliga hälsningar|vänliga hälsningar|hälsningar|mvh|tack(?: på förhand)?|hälsar)\s*[,.!]?\s*$/i;
// The model sometimes writes its own writing-block markup instead:
// :::writing{variant="email" subject="…"} … ::: (the owner saw the markup as text).
const WRITING_BLOCK = /^[ \t]*:::writing\{([^}\n]*)\}[ \t]*\n([\s\S]*?)\n[ \t]*:::[ \t]*$/m;
function draftFromText(text) {
  const block = WRITING_BLOCK.exec(String(text || '').replace(/\r\n?/g, '\n'));
  if (block) {
    const attr = (name) => (new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(block[1]) || [])[1] || '';
    const body = block[2].trim();
    if (body) {
      const whole = String(text).replace(/\r\n?/g, '\n');
      const rest = (whole.slice(0, block.index) + whole.slice(block.index + block[0].length)).replace(/\n{3,}/g, '\n\n').trim();
      return { card: presentArgs({ kind: 'draft', title: attr('variant') === 'email' || attr('subject') ? 'Email draft' : 'Draft', subject: attr('subject'), to: attr('to') || attr('recipient'), body }), rest: rest.replace(/[:：]\s*$/, '.') };
    }
  }
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const plain = (line) => line.replace(/\*\*|__|^#+\s*/g, '');
  let subjectAt = -1, subject = '', to = '';
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const m = DRAFT_FIELD.exec(plain(lines[i]));
    if (!m) continue;
    if (/^(?:to|till)$/i.test(m[1])) to = m[2]; else { subject = m[2].replace(/^["“]|["”]$/g, ''); subjectAt = i; break; }
  }
  if (subjectAt < 0) return null;
  const after = lines.slice(subjectAt + 1);
  const sign = after.findIndex((line) => SIGN_OFF.test(plain(line)));
  // The signature: the sign-off and the name under it (or a [Your name] placeholder).
  let end = after.length;
  if (sign >= 0) { end = sign + 1; while (end < after.length && !after[end].trim()) end++; if (end < after.length && after[end].trim().length <= 40) end++; }
  const body = after.slice(0, end).map(plain).join('\n').trim();
  if (body.length < 60 || body.split('\n').filter((line) => line.trim()).length < 2) return null;
  // A letter: it opens with a greeting or ends with a sign-off ("Subject: Biology" in a study plan does not).
  const greeting = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening)|hej(?:san)?|hallå|god (?:morgon|dag|kväll)|bonjour|hola|hallo|ciao)\b/i.test(plain(after.find((line) => line.trim()) || '').trim());
  if (!greeting && sign < 0) return null;
  const intro = lines.slice(0, subjectAt).filter((line) => !DRAFT_FIELD.test(plain(line))).join('\n').trim();
  const outro = after.slice(end).join('\n').trim();
  const card = presentArgs({ kind: 'draft', title: 'Email draft', subject, to, body });
  return { card, rest: [intro.replace(/[:：]\s*$/, '.'), outro].filter(Boolean).join('\n\n') };
}

// Safety net for chat replies: an email written out as text becomes a draft card, and a markdown
// table or task list becomes a card when the reply has words of its own to keep beside it. A reply
// that is only a table or list stays text (the app draws markdown tables and lists), so the owner
// never gets a card with "Here it is." as the answer. Other text is untouched.
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim().replace(/\*\*/g, ''));
const hasWords = (rest) => String(rest || '').replace(/[#*_>\s-]+/g, ' ').trim().length >= 20;
function cardFromMarkdown(text) {
  const draft = draftFromText(text);
  if (draft) return draft;
  const found = blockFromMarkdown(text);
  return found && hasWords(found.rest) ? found : null;
}
function blockFromMarkdown(text) {
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
    // Section labels between the task items ("**Moving day**", "### Bathroom") group the items under them.
    const label = (line) => (/^\s*\*\*([^*]+)\*\*:?\s*$/.exec(line) || (line !== heading && /^#{1,4}\s+(.+)$/.exec(line)) || [])[1];
    const items = tasks.map(({ index, m }) => {
      const [title, ...more] = m[2].replace(/\*\*/g, '').split(/:\s+| — | - /);
      const group = lines.slice(0, index).reverse().map(label).find(Boolean);
      return { title: title.trim(), subtitle: more.join(': ').trim() || undefined, done: m[1].toLowerCase() === 'x', ...(group ? { group: group.trim() } : {}) };
    });
    const used = new Set(tasks.map((row) => row.index));
    const rest = lines.filter((line, index) => !used.has(index) && line !== heading && !/^#{1,4}\s+/.test(line) && !/^\s*\*\*[^*]+\*\*:?\s*$/.test(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { card: presentArgs({ kind: 'checklist', title: heading ? heading.replace(/^#+\s*/, '') : 'Checklist', items }), rest };
  }
  // A shopping, packing or to-do list written as plain bullets is still a list to tick off.
  const named = lines.findIndex((line) => /\b(?:shopping|grocery|packing|to-?do|check) ?list\b|\b(?:inköpslista|handlingslista|packlista|att göra-lista|att-göra-lista)\b/i.test(line));
  const bullets = lines.map((line, index) => ({ index, m: /^\s*[-*•]\s+(?!\[)(.+)$/.exec(line) })).filter((row) => row.m && row.index > named);
  if (named >= 0 && named <= 2 && bullets.length >= 6) {
    const label = (line) => (/^\s*\*\*([^*]+)\*\*:?\s*$/.exec(line) || /^#{1,4}\s+(.+)$/.exec(line) || [])[1];
    const items = bullets.map(({ index, m }) => {
      const group = lines.slice(named + 1, index).reverse().map(label).find(Boolean);
      return { title: m[1].replace(/\*\*/g, '').trim(), ...(group ? { group: group.trim() } : {}) };
    });
    const used = new Set(bullets.map((row) => row.index));
    const title = lines[named].replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/[:：]\s*$/, '').trim();
    const rest = lines.filter((line, index) => index !== named && !used.has(index) && !label(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { card: presentArgs({ kind: 'checklist', title: title.length <= 80 ? title : 'Checklist', items }), rest };
  }
  // A numbered list of picks ("1. **Wander Alfama** — …") stays text: as a card it had no photos
  // or links to add, and the reply around it was lost.
  return null;
}

module.exports = { questionArgs, presentArgs, presentSummary, learnArgs, learnSummary, plainMath, connectArgs, approvalView, approvalCard, resultCard, cardFromMarkdown, toolkitName, partialJson, calcCompile, calcResults, lookupImage, resolveCardImages, cardImages, applyImages };
