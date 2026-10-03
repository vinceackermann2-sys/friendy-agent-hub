// Live evaluation of the chat agent (the fast coordinator) against the real model.
// Not part of `npm test`: it spends tokens. Storage, tasks and memory are stubbed;
// the model, system prompt, tool schemas and web search are real.
//   node tests/chat-agent.eval.cjs [--runs 2] [--only clock] [--server path/to/server]
require('dotenv').config();
const path = require('node:path');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const serverDir = path.resolve(flag('server', path.join(__dirname, '..', 'server')));
const runs = Number(flag('runs', 2));
const only = flag('only', '');
const concurrency = Number(flag('concurrency', 4));

const { createCoordinator, acknowledgeTask } = require(path.join(serverDir, 'agents', 'conversation'));
const harness = require(path.join(serverDir, 'agents', 'vm-harness'));
const { TOOLS } = require(path.join(serverDir, 'agents', 'tools'));
const foundry = require(path.join(serverDir, 'foundry'));

const TZ = 'Europe/Stockholm';
const now = () => new Date();
const fmt = (d, o, tz = TZ) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(d);
const weekday = (offsetDays = 0, tz = TZ) => fmt(new Date(Date.now() + offsetDays * 864e5), { weekday: 'long' }, tz);
const monthDay = (offsetDays = 0, tz = TZ) => new Date(Date.now() + offsetDays * 864e5);
function mentionsDate(text, d, tz = TZ) {
  const day = Number(fmt(d, { day: 'numeric' }, tz)), month = fmt(d, { month: 'long' }, tz), short = fmt(d, { month: 'short' }, tz);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const sv = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'][Number(iso.slice(5, 7)) - 1];
  return new RegExp(`(${month}|${short}|${sv})\\.?\\s+${day}\\b|\\b${day}(st|nd|rd|th)?\\s+(of\\s+)?(${month}|${short}|${sv})|${iso}`, 'i').test(text);
}
function hourNear(text, tz = TZ) {
  const h = Number(fmt(now(), { hour: '2-digit', hourCycle: 'h23' }, tz));
  const found = [...text.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)].map(m => Number(m[1]));
  const pm = /\bpm\b/i.test(text);
  return found.some(x => [x, pm && x < 12 ? x + 12 : x].some(v => Math.abs(v - h) <= 1 || Math.abs(v - h) === 23));
}
const daysUntil = (month, day) => {
  const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now()) + 'T00:00:00Z');
  let target = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day));
  if (target < today) target = new Date(Date.UTC(today.getUTCFullYear() + 1, month - 1, day));
  return Math.round((target - today) / 864e5);
};
const year = () => fmt(now(), { year: 'numeric' });
// The real product search: the Shopify catalog (.env credentials) and the web (Firecrawl, or
// DuckDuckGo without a key, which may rate-limit and return no web results).
const realProductSearch = (args) => TOOLS.product_search.run(args, { userId: null, trace: () => {} });
// composio_apps as the real tool answers: connected apps, apps that can be connected, and
// what a connection cannot do (the production catalog).
const CATALOG = 'calendly dropbox excel facebook github gmail google_maps googlecalendar googledocs googledrive googlesheets hubspot instagram linear linkedin microsoft_teams notion one_drive outlook salesforce share_point shopify slack stripe telegram twitter whatsapp youtube zoom'.split(' ');
const apps = (...connected) => () => ({
  connected: connected.map((toolkit, i) => ({ id: `ca_${i}`, toolkit, account: 'owner@example.se' })),
  canConnect: CATALOG.filter((t) => !connected.includes(t)),
  limits: {
    facebook: 'Facebook Pages the owner manages only (posts, comments, Page messages); not a personal profile or personal Messenger chats.',
    instagram: 'Instagram Business and Creator accounts only; not personal accounts.',
    whatsapp: 'WhatsApp Business accounts only; not personal WhatsApp chats.',
    telegram: 'A Telegram bot the owner sets up; not their personal Telegram chats.',
    linkedin: 'Posts, comments and profile only; not LinkedIn messages.',
  },
  note: 'Only the apps listed here can be connected. Anything else, or anything a limit excludes, is reachable only through the website in your browser, where the owner signs in themselves.',
});
// An honest reply about a personal account says what the connection covers or offers the
// owner's own sign-in in the browser, and starts nothing on its own.
const honestAboutAccount = (r) => {
  const said = `${r.text} ${r.options.join(' ')}`;
  return r.route !== 'task' && /\b(pages?|business|personal|sign(?:s|ing)? in|log(?:s|ging)? in|browser|sida|sidor|företag|privata?|personliga?|logga in|webbläsare)\b/i.test(said) ? '' : `not honest about access (${r.route}): ${said.slice(0, 220)}`;
};

// Keys go into the secure card a task shows, never into chat.
const noKeyInChat = (r) => /\b(paste|send|share|give|type)\b[^.?!]{0,40}\b(key|token)\b[^.?!]{0,20}\b(here|in (the )?chat|to me)\b/i.test(r.text) ? `asked for the key in chat: ${r.text.slice(0, 200)}` : '';

// wallet_status as the real tool answers (belna-wallet.js snapshot plus paymentSelection):
// Belna Wallet active, identity check pending, so agent card checkout is off.
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const wallet = (over = {}) => () => ({
  activity: [
    { title: 'Payment received', amount: 200, currency: 'USD', status: 'recorded', at: daysAgo(1) },
    { title: 'Deposit', amount: 100, currency: 'USD', status: 'recorded', at: daysAgo(3) },
    { title: 'Sent money', amount: 20, currency: 'USD', status: 'recorded', at: daysAgo(4) },
    { title: 'Payment fee', amount: 1.5, currency: 'USD', status: 'recorded', at: daysAgo(4) },
  ],
  wallet: { configured: true, status: 'verification_required', withdrawalsAvailable: false, cardReady: false, cardProgramAvailable: true, sandbox: false, card: null,
    balance: { currency: 'USD', available: 248.5, pending: 40 }, dailyCardLimitUsd: 50, agentCardPayments: false, ...over.wallet },
  purchases: [],
  transfers: [{ quoteId: 'q_1', recipient: 'anna@example.se', amount: 20, currency: 'USD', status: 'succeeded', at: daysAgo(4) }],
  transactions: [],
  paymentSelection: { activeMethod: 'belna_wallet', merchantEnabled: true, selectionSaved: true, ...over.paymentSelection },
});
const shopPay = (over = {}) => () => ({ connected: true, email: 'owner@example.se', dailyLimitUsd: 200, remainingUsd: 200, configured: true, nativeCheckout: true, recent: [], ...over });
const addresses = () => ({ addresses: [
  { id: 'addr_home_0000000001', label: 'Home', recipient: 'Ada Lovelace', line1: 'Sveavägen 12', line2: '', city: 'Stockholm', region: '', postalCode: '11157', country: 'SE', isDefault: true, formatted: 'Ada Lovelace, Sveavägen 12, 11157 Stockholm, SE' },
  { id: 'addr_office_00000001', label: 'Office', recipient: 'Ada Lovelace', line1: 'Kungsgatan 4', line2: '', city: 'Stockholm', region: '', postalCode: '11143', country: 'SE', isDefault: false, formatted: 'Ada Lovelace, Kungsgatan 4, 11143 Stockholm, SE' },
] });

// expect: 'answer' | 'task' | 'any'. check(result) returns an error string or ''.
const CASES = [
  { id: 'clock.date', prompt: "What's today's date?", expect: 'answer',
    check: r => mentionsDate(r.text, now()) && r.text.includes(weekday()) ? '' : `wrong date: ${r.text}` },
  { id: 'clock.time', prompt: 'What time is it right now?', expect: 'answer',
    check: r => hourNear(r.text) ? '' : `wrong time: ${r.text}` },
  { id: 'clock.tomorrow', prompt: 'What day of the week is it tomorrow?', expect: 'answer',
    check: r => r.text.includes(weekday(1)) ? '' : `expected ${weekday(1)}: ${r.text}` },
  { id: 'clock.christmas', prompt: 'How many days until Christmas Day?', expect: 'answer',
    check: r => new RegExp(`\\b${daysUntil(12, 25)}\\b`).test(r.text) ? '' : `expected ${daysUntil(12, 25)}: ${r.text}` },
  { id: 'clock.swedish', prompt: 'Hej! Vilket datum är det idag?', expect: 'answer',
    check: r => mentionsDate(r.text, now()) ? '' : `wrong date: ${r.text}` },
  { id: 'clock.nextweek', prompt: 'What is the date next Monday?', expect: 'answer',
    check: r => { const wd = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(weekday()); const add = ((1 - wd + 7) % 7) || 7; return mentionsDate(r.text, monthDay(add)) ? '' : `expected ${fmt(monthDay(add), { month: 'long', day: 'numeric' })}: ${r.text}`; } },
  { id: 'know.capital', prompt: 'Capital of Australia?', expect: 'answer',
    check: r => /canberra/i.test(r.text) ? '' : r.text },
  { id: 'know.poem', prompt: 'Write a four-line poem about lingonberries.', expect: 'answer',
    check: r => r.text.split('\n').filter(l => l.trim()).length >= 4 ? '' : `short poem: ${r.text}` },
  { id: 'know.math', prompt: 'If I save 350 kr a week, how much do I have after a year?', expect: 'answer',
    check: r => /18[\s,.]?200/.test(r.text) ? '' : r.text },
  { id: 'lookup.news', prompt: 'Who won the most recent Formula 1 Grand Prix?', expect: 'any',
    check: r => r.route === 'task' || r.searched ? '' : `answered without search: ${r.text}` },
  // Weather comes from web search: the forecast passage of the pages, answered in chat.
  { id: 'lookup.weather', prompt: 'What will the weather be like in Stockholm tomorrow?', expect: 'any',
    check: r => r.route === 'task' || (/°|degrees|grader/i.test(r.text) && !/(couldn.t|could not|can.t|cannot) find|no (reliable|usable) forecast/i.test(r.text)) ? '' : `no forecast: ${r.text.slice(0, 200)}` },
  { id: 'lookup.weather.sv', prompt: 'Vad blir vädret i Stockholm i morgon?', expect: 'any',
    check: r => r.route === 'task' || (/°|grader/i.test(r.text) && !/hittar ingen|ingen (tillförlitlig|användbar) prognos/i.test(r.text)) ? '' : `no forecast: ${r.text.slice(0, 200)}` },
  // Reading a page the owner names is a quick lookup; a task added ten seconds for the same answer.
  { id: 'work.site', prompt: 'Go to timewarpdev.com and tell me what the main headline says', expect: 'any',
    check: r => r.route === 'task' || /bring anything/i.test(r.text) ? '' : `wrong or missing headline: ${r.text.slice(0, 200)}` },
  // A booking that cannot start without the owner's choice asks first, in chat, instead of
  // a task that spends half a minute (and a VM) to ask the same question.
  { id: 'ask.haircut', prompt: 'Book me a haircut', expect: 'any',
    check: r => r.route === 'ask' || (r.route === 'answer' && /\?/.test(r.text)) ? '' : `started without asking where or when (${r.route}): ${r.text.slice(0, 160)}` },
  // A plan starts with sensible defaults; a question first only slows the owner down.
  { id: 'plan.noask', prompt: 'Plan a 2 day trip to Gothenburg for me next weekend', expect: 'any',
    // Asked on a Sunday, "next weekend" may mean either coming weekend: a question about dates is fair, any other is not.
    check: r => r.route === 'task' || (r.route === 'ask' && /weekend|date|oct/i.test(r.options.join(' '))) ? '' : `needless question (${r.route}): ${r.options.join(' | ').slice(0, 200)}` },
  // An English message stays English even when memory and results are Swedish.
  { id: 'lang.memory', prompt: 'Suggest a good lunch place near me', expect: 'any',
    memories: [{ id: 'mem_1', text: 'The owner is vegetarian and lives on Södermalm in Stockholm.', category: 'user' }],
    check: r => !/[åäö]\w*\b|\b(och|är|för|du|att|jag|på)\b/i.test(r.text.replace(/Södermalm|Söder|Hermans|Fjällgatan/gi, '')) ? '' : `not English: ${r.text.slice(0, 200)}` },
  { id: 'work.game', prompt: 'Make me a tic tac toe game', expect: 'task' },
  { id: 'work.trip', prompt: 'Plan a 3 day trip to Rome for next weekend and find hotels under 150 euro', expect: 'task', allowAsk: true,
    check: r => !r.instructions || !/\b20(2[0-5])\b/.test(r.instructions) ? '' : `stale year in brief: ${r.instructions}` },
  { id: 'work.watch', prompt: 'Keep an eye on the price of AirPods Pro and tell me if it drops below 2000 kr', expect: 'task' },
  { id: 'work.spreadsheet', prompt: 'Put together a spreadsheet of the 10 biggest Swedish companies by revenue', expect: 'task' },
  { id: 'work.swedish', prompt: 'Planera en helg i Göteborg för två och hitta hotell under 1500 kr per natt', expect: 'any',
    // Hotel prices need dates, and none were given: asking which weekend is fair.
    check: r => (r.route === 'task' || (r.route === 'ask' && /helg|datum|okt|vecka/i.test(r.options.join(' ')))) && /[åäö]|\b(jag|och)\b/i.test(r.text) ? '' : `Swedish request got a reply in another language: ${r.text.slice(0, 160)}` },
  { id: 'chat.capability', prompt: 'What can you do for me?', expect: 'answer',
    check: r => r.text.length > 40 && r.modelCalls === 1 ? '' : `${r.modelCalls} model calls: ${r.text.slice(0, 160)}` },
  { id: 'chat.style', prompt: 'hi!', expect: 'answer',
    check: r => r.text.length < 220 && !/great question|happy to help|how can i assist/i.test(r.text) ? '' : `stiff or long greeting: ${r.text}` },
  // Read-only account lookups answer in chat from the tool data.
  { id: 'app.shop', prompt: 'How much can I still spend with Shop Pay today?', expect: 'answer',
    // The shape shoppay.agentStatus returns. An invented SEK shape made the model write
    // "SE,3750" when the prompt named the reply language; the real USD fields did not.
    tools: { shop_status: () => ({ connected: true, email: 'owner@example.se', dailyLimitUsd: 500, remainingUsd: 375, configured: true, nativeCheckout: true, recent: [] }) },
    check: r => /\$\s?375\b|\b375(\.00)?\s?(USD|dollars)|USD\s?375/.test(r.text) && r.fns.includes('shop_status') ? '' : `wrong budget: ${r.text}` },
  { id: 'app.mailbox', prompt: 'Did you get any new email?', expect: 'answer',
    tools: { mail_status: () => ({ address: 'everest@mail.belna.se', unread: 1, sendReady: true }),
      // The real tool returns the rows as an array.
      mail_list: () => ([{ id: 'mail_1', from: 'anna@studio.se', fromName: 'Anna Berg', subject: 'Moodboard for the launch', receivedAt: '2026-09-25T07:12:00Z', isRead: false, preview: 'Hi! Here is the moodboard we talked about.' }]) },
    check: r => r.cards.includes('present') && /anna|moodboard/i.test(r.text) ? '' : `missed the email or its card: ${r.text}` },
  { id: 'app.connected', prompt: 'Which apps have I connected?', expect: 'answer',
    tools: { composio_apps: apps('gmail', 'googlecalendar') },
    check: r => /gmail/i.test(r.text) && /calendar/i.test(r.text) ? '' : `missed connected apps: ${r.text}` },
  { id: 'app.gmail', prompt: 'Summarize the latest emails in my Gmail', expect: 'task', tools: { composio_apps: apps('gmail') } },
  { id: 'app.gmail.missing', prompt: 'Summarize the latest emails in my Gmail', expect: 'any',
    tools: { composio_apps: apps('slack'), connect_app: () => ({ toolkit: 'gmail', connected: false }) },
    check: r => r.cards.includes('connect') ? '' : `no connect card for an unconnected app (${r.route}): ${r.text.slice(0, 160)}` },
  // Personal accounts no connection covers: say so and offer the owner's own sign-in,
  // instead of starting the VM to log in (the owner's complaint, 2026-09-27).
  { id: 'honest.facebook', prompt: 'can you check my facebook messages', expect: 'any', honest: true,
    tools: { composio_apps: apps('gmail'), connect_app: () => ({ toolkit: 'facebook', connected: false }) }, check: honestAboutAccount },
  { id: 'honest.instagram', prompt: 'Read my latest Instagram DMs', expect: 'any', honest: true,
    tools: { composio_apps: apps('gmail'), connect_app: () => ({ toolkit: 'instagram', connected: false }) }, check: honestAboutAccount },
  { id: 'honest.swedish', prompt: 'Kan du kolla mina meddelanden på Facebook?', expect: 'any', honest: true,
    tools: { composio_apps: apps('gmail'), connect_app: () => ({ toolkit: 'facebook', connected: false }) },
    check: r => honestAboutAccount(r) || (/\b(och|du|att|jag|kan)\b/i.test(r.text) ? '' : `not Swedish: ${r.text.slice(0, 160)}`) },
  // Asked for the browser outright, the agent does it.
  { id: 'honest.consent', prompt: 'Open Facebook in your browser so I can log in myself, then read my latest messages', expect: 'task',
    tools: { composio_apps: apps('gmail') } },
  // The owner's own API or MCP server: a task sets it up (it finds the address and shows a key
  // card). The chat never asks for the key in chat and never says it cannot be connected.
  { id: 'own.mcp', prompt: 'Connect the DeepWiki MCP server so you can read docs for GitHub repos', expect: 'task',
    tools: { composio_apps: apps('gmail') }, check: r => noKeyInChat(r) },
  { id: 'own.api', prompt: 'Add the OpenWeatherMap API, I have an API key', expect: 'task',
    tools: { composio_apps: apps('gmail') }, check: r => noKeyInChat(r) },
  { id: 'own.url', prompt: 'Connect this MCP server: https://mcp.acme-internal-tools.com/mcp, I have a token for it', expect: 'task',
    tools: { composio_apps: apps('gmail') }, check: r => noKeyInChat(r) },
  // Product questions are answered from read_doc, not guessed.
  { id: 'doc.billing', prompt: 'How much is Pro and how many tokens does it include?', expect: 'answer',
    check: r => /\$?50/.test(r.text) && /100\s*(million|M)/i.test(r.text) ? '' : `wrong plan facts: ${r.text}` },
  { id: 'doc.approvals', prompt: 'Will you ever buy something without asking me first?', expect: 'answer',
    check: r => /approv|ask|confirm/i.test(r.text) && !/\byes\b[^.]*without asking/i.test(r.text) ? '' : `unclear approval answer: ${r.text}` },
  { id: 'memory.remember', prompt: 'Remember that I am vegetarian', expect: 'answer',
    check: r => r.text.length > 0 && r.text.length < 300 ? '' : `odd memory reply: ${r.text}` },
  // Without the per-message extraction call, the agent itself must save durable facts.
  { id: 'memory.implicit', prompt: 'A quick fact about me: my exact project codename is project-4417.', expect: 'answer',
    check: r => r.fns.includes('memory_write') ? '' : `did not save the fact: ${r.fns.join(',') || 'no calls'}` },
  // Older context survives through the running summary.
  { id: 'summary.recall', prompt: "What's my dog called again?", expect: 'answer',
    summary: 'The owner has a border collie named Pixel who is afraid of thunder. They are planning a hiking trip to Abisko in October.',
    history: [['user', 'Can you suggest a good rain jacket?'], ['agent', 'A Fjällräven Keb Eco-Shell is a solid pick.'], ['user', 'Thanks'], ['agent', 'Anytime.']],
    check: r => /pixel/i.test(r.text) ? '' : `lost the summary: ${r.text}` },
  // A message cut off by the owner's next one is handled together with it.
  { id: 'interrupt.merge', interrupt: ['Book a table at Pizzeria Bella tonight', 'Actually make it 4 people at 7pm'], expect: 'any',
    // A clarifying question about the restaurant is fine, but it must be in English.
    check: r => { const all = `${r.text} ${r.instructions}`; if (r.route === 'ask') return /bella/i.test(all) && !/\b(vilken|eller|gäller)\b/i.test(all) ? '' : `bad question: ${all}`;
      return /bella/i.test(all) && /\b(4|four)\b/i.test(all) ? '' : `dropped part of the request: ${all}`; } },
  // Cards: comparisons and picks are shown, not written as bullet lists; plain answers carry none.
  { id: 'card.compare', prompt: 'Compare iPhone 17 Pro vs Pixel 11 Pro vs Galaxy S26 Ultra', expect: 'any',
    check: r => r.route === 'task' || r.cards.includes('present') ? '' : `no comparison card: ${r.text.slice(0, 200)}` },
  { id: 'card.pick', prompt: 'Help me pick a laptop for video editing under 20000 kr', expect: 'any',
    check: r => r.route !== 'answer' || r.cards.includes('present') ? '' : `no picks card: ${r.text.slice(0, 200)}` },
  { id: 'card.list', prompt: 'Top 5 things to do in Lisbon?', expect: 'answer',
    check: r => r.cards.includes('present') ? '' : `five picks without a list card: ${r.text.slice(0, 160)}` },
  { id: 'card.table', prompt: 'Compare a Kindle Paperwhite and a Kobo Clara BW for reading in bed.', expect: 'any',
    check: r => r.route === 'task' || r.cards.includes('present') ? '' : `comparison without a table: ${r.text.slice(0, 160)}` },
  { id: 'card.connect', prompt: 'Connect my Google Calendar.', expect: 'answer',
    tools: { composio_apps: apps('gmail'), connect_app: () => ({ toolkit: 'googlecalendar', connected: false }) },
    check: r => r.cards.includes('connect') ? '' : `no connect card: ${r.text.slice(0, 160)}` },
  // Shopping: products show as cards with photos, prices and store links, found in chat
  // (no task, no VM), from web stores and Shopify stores.
  { id: 'shop.find', prompt: 'Find me trail running shoes under 1500 kr', expect: 'answer', tools: { product_search: realProductSearch },
    check: r => { const over = r.prices.filter(p => /^SEK/.test(p) && Number(p.replace(/[^\d.]/g, '')) > 1500);
      // Asked in English with a Swedish budget and time zone: the reply stays in English.
      const swedish = /\b(jag|skulle|och|för|den)\b/i.test(r.text);
      return r.cards.includes('present') && r.linked && !over.length && !swedish ? '' : `no linked product cards, over budget (${over.join(', ')}) or not English: ${r.fns.join(',')} ${r.text.slice(0, 160)}`; } },
  { id: 'shop.options', prompt: 'I want to buy a new yoga mat, show me a few options', expect: 'answer', tools: { product_search: realProductSearch },
    check: r => r.cards.includes('present') && r.linked ? '' : `no linked product cards: ${r.fns.join(',')} ${r.text.slice(0, 160)}` },
  { id: 'shop.swedish', prompt: 'Hitta en snygg ryggsäck för pendling', expect: 'answer', tools: { product_search: realProductSearch },
    check: r => r.cards.includes('present') && r.linked && /\b(och|en|för|den|jag)\b/i.test(r.text) ? '' : `no linked cards or not Swedish: ${r.fns.join(',')} ${r.text.slice(0, 160)}` },
  { id: 'card.none', prompt: 'Why is the sky blue? One short paragraph.', expect: 'answer',
    check: r => !r.cards.length ? '' : `needless card: ${r.cards.join(',')}` },
  // Connectors: a connected app goes straight to work; a missing one gets a connect card.
  { id: 'app.gmail.connected', prompt: 'Check my Gmail for anything important today', expect: 'task',
    tools: { composio_apps: apps('gmail'), connect_app: () => ({ toolkit: 'gmail', connected: true }) },
    check: r => !r.cards.includes('connect') ? '' : 'connect card for a connected app' },
  { id: 'app.slack.missing', prompt: 'Post "Standup moved to 10" in our Slack #general channel', expect: 'any',
    tools: { composio_apps: apps('gmail'), connect_app: () => ({ toolkit: 'slack', connected: false }) },
    check: r => r.cards.includes('connect') || r.route === 'task' ? '' : `neither connect card nor task: ${r.text.slice(0, 200)}` },
  // Wallet: balance, activity and the payment selection are lookups the chat answers itself;
  // moving money is a task whose worker asks for approval; owner-only steps (identity check,
  // deposits, bank withdrawals) are named honestly, with where the owner does them.
  { id: 'wallet.balance', prompt: 'How much money is in my wallet?', expect: 'answer', tools: { wallet_status: wallet() },
    check: r => /248\.50/.test(r.text) && r.fns.includes('wallet_status') ? '' : `wrong balance: ${r.text}` },
  { id: 'wallet.balance.sv', prompt: 'Hur mycket pengar finns i min plånbok?', expect: 'answer', tools: { wallet_status: wallet() },
    check: r => /248[.,]50/.test(r.text) && /[åäö]|\b(du|har|och|i)\b/i.test(r.text) ? '' : `wrong balance or not Swedish: ${r.text}` },
  { id: 'wallet.pending', prompt: 'Is any money on its way to my wallet?', expect: 'answer', tools: { wallet_status: wallet() },
    check: r => /\$?40(\.00)?\b/.test(r.text) ? '' : `missed the pending $40: ${r.text}` },
  { id: 'wallet.method', prompt: 'If you buy something for me, what do you pay with?', expect: 'answer', honest: true, tools: { wallet_status: wallet(), shop_status: shopPay() },
    check: r => /belna/i.test(r.text) && /identity|verif/i.test(r.text) ? '' : `did not say Belna Wallet needs the identity check first: ${r.text}` },
  { id: 'wallet.method.existing', prompt: 'What will you pay with when you order things for me?', expect: 'answer', honest: true,
    tools: { wallet_status: wallet({ paymentSelection: { activeMethod: 'existing_card' } }), shop_status: shopPay() },
    check: r => /shop pay|saved|existing|already/i.test(r.text) ? '' : `did not name the existing card: ${r.text}` },
  { id: 'wallet.method.none', prompt: 'Can you pay for things for me?', expect: 'any', honest: true,
    tools: { wallet_status: wallet({ paymentSelection: { activeMethod: null, merchantEnabled: false, selectionSaved: false } }), shop_status: shopPay({ connected: false }) },
    check: r => r.route !== 'task' && /wallet/i.test(`${r.text} ${r.options.join(' ')}`) ? '' : `did not point to choosing a wallet (${r.route}): ${r.text}` },
  { id: 'wallet.address', prompt: 'Where would you ship an order to?', expect: 'answer', tools: { shipping_addresses: addresses },
    check: r => /sveav[äa]gen/i.test(r.text) && r.fns.includes('shipping_addresses') ? '' : `wrong address: ${r.text}` },
  { id: 'wallet.activity', prompt: 'What came in and went out of my wallet lately?', expect: 'answer', tools: { wallet_status: wallet() },
    check: r => /200/.test(r.text) && /\b20(\.00)?\b|anna/i.test(`${r.text} ${JSON.stringify(r.cardItems)}`) ? '' : `missed activity: ${r.text}` },
  { id: 'wallet.send', prompt: 'Send $10 to anna@example.se from my Belna wallet', expect: 'task', tools: { wallet_status: wallet() },
    check: r => /anna@example\.se/.test(r.instructions) && /\b10\b/.test(r.instructions) ? '' : `brief lost the recipient or amount: ${r.instructions}` },
  { id: 'wallet.link', prompt: 'Make me a payment link for $150 for the logo design I did', expect: 'answer', tools: { wallet_status: wallet() },
    check: r => /payment.?link/i.test(r.text) && /unavailable|not (?:available|supported)|removed|can[’']?t|cannot/i.test(r.text) ? '' : `did not explain removed payment links: ${r.text}` },
  { id: 'wallet.limit', prompt: 'Raise my daily card limit to $100', expect: 'task', tools: { wallet_status: wallet() },
    check: r => /100/.test(r.instructions) ? '' : `brief lost the limit: ${r.instructions}` },
  { id: 'wallet.withdraw', prompt: 'Withdraw $100 from my wallet to my bank account', expect: 'any', honest: true, tools: { wallet_status: wallet() },
    check: r => r.route !== 'task' && /withdraw/i.test(r.text) ? '' : `did not explain bank withdrawals (${r.route}): ${r.text}` },
  { id: 'wallet.deposit', prompt: 'How do I put money into my wallet?', expect: 'answer', honest: true, tools: { wallet_status: wallet() },
    check: r => /deposit|add money/i.test(r.text) && /wallet/i.test(r.text) ? '' : `did not explain deposits: ${r.text}` },
  { id: 'wallet.setup', prompt: 'Set up a Belna wallet for me', expect: 'any', honest: true,
    tools: { wallet_status: wallet({ wallet: { status: 'not_created', balance: null, cardReady: false, agentCardPayments: false }, paymentSelection: { activeMethod: null, selectionSaved: false } }) },
    check: r => r.route !== 'task' && /wallet/i.test(r.text) && /country|create|identity|verif/i.test(r.text) ? '' : `did not guide wallet setup (${r.route}): ${r.text}` },
  { id: 'wallet.buy.notready', prompt: 'Buy me AirPods Pro with my Belna wallet', expect: 'any', honest: true, tools: { wallet_status: wallet(), shop_status: shopPay() },
    check: r => /identity|verif|not (?:yet )?(?:ready|available|set up)|isn[’']?t (?:ready|available|set up)/i.test(`${r.text} ${r.options.join(' ')} ${r.instructions}`) ? '' : `did not say wallet card checkout is not ready (${r.route}): ${r.text || r.instructions}` },
  { id: 'wallet.freeze', prompt: 'Freeze my wallet card right now', expect: 'any', honest: true, tools: { wallet_status: wallet({ wallet: { status: 'ready', cardReady: true, card: { last4: null, status: 'active', dailyLimitUsd: 50 } } }) },
    check: r => /freez|pause/i.test(`${r.text} ${r.instructions}`) ? '' : `ignored the freeze request (${r.route}): ${r.text}` },
  // The agent knows the owner's name from their profile and uses it where it belongs.
  { id: 'owner.name', prompt: "What's my name?", expect: 'answer', owner: 'Marie-Louise',
    check: r => /marie-louise/i.test(r.text) ? '' : `did not know the name: ${r.text}` },
  { id: 'owner.signed', prompt: 'Write a two-line thank-you note to my neighbour for watering my plants, signed by me.', expect: 'answer', owner: 'Marie-Louise',
    check: r => /marie-louise/i.test(r.text) ? '' : `not signed with the name: ${r.text}` },
  // The owner writes in English from a Swedish time zone: the reply stays in English.
  { id: 'chat.language', prompt: 'Any tips for a rainy Sunday?', expect: 'answer',
    check: r => /\b(the|and|you)\b/i.test(r.text) && !/\b(och|du|att)\b/i.test(r.text) ? '' : `wrong language: ${r.text}` },
];

function stubs(calls, c) {
  const tasks = {
    summaries: async () => [],
    create: async (t) => { calls.task = t; return { id: 'task_1', state: { title: t.title, status: 'queued', version: 1, events: [] }, revision: 1 }; },
    view: (row) => ({ id: row.id, title: row.state.title, status: row.state.status }),
  };
  const tools = { ...TOOLS };
  for (const name of Object.keys(tools)) if (!['web_search'].includes(name)) tools[name] = { run: async () => ({ items: [], note: 'Nothing stored yet.' }) };
  // Writes answer the way the real store does, with the saved row.
  tools.memory_write = { run: async (args) => ({ id: 'mem_eval', text: String(args.text || ''), category: args.category || 'long_term', status: 'active' }) };
  tools.memory_update = { run: async (args) => ({ id: args.id || 'mem_eval', text: String(args.text || ''), status: 'active' }) };
  for (const [name, fn] of Object.entries(c.tools || {})) tools[name] = { run: async (args) => fn(args) };
  return { tasks, tools };
}

async function runCase(c, variant) {
  const calls = { model: 0, input: 0, cached: 0, output: 0 };
  const events = [];
  const { tasks, tools } = stubs(calls, c);
  let timing = {};
  const model = async (opts) => {
    calls.model++;
    const r = await foundry.callFoundryWithTools(opts);
    calls.input += Number(r.usage?.input_tokens) || 0;
    calls.cached += Number(r.usage?.input_tokens_details?.cached_tokens) || 0;
    calls.output += Number(r.usage?.output_tokens) || 0;
    for (const f of r.functionCalls || []) { (calls.fns ||= []).push(f.name); (calls.args ||= []).push({ name: f.name, args: f.args }); }
    return r;
  };
  const coordinator = createCoordinator({ tasks, model, schemas: harness.TOOL_SCHEMAS, tools, azure: { getSandbox: async () => ({ mode: 'azure', vmName: 'vm-eval', location: 'swedencentral', vmSize: 'B2s' }) },
    store: { listMemories: async () => c.memories || [], saveTurn: async () => {},
      listChatMessages: async () => (c.history || []).map(([role, text], i) => ({ id: `h${i}`, role, text, created_at: new Date(Date.now() - (60 - i) * 60_000).toISOString() })),
      latestChatSummary: async () => (c.summary ? { text: c.summary, metadata: {} } : null) },
    permission: async () => ({ required: false }),
    buildSystem: harness.buildSystem, memoryContext: harness.memoryContext, ensureCredit: async () => {}, logUsage: async () => {},
    checkPrompt: () => {}, protect: (_, s) => s, rank: x => x, finishMemory: async () => [],
    // The message confirming a started task, written as in production.
    acknowledge: acknowledgeTask ? (request) => acknowledgeTask(request, { model: (o) => foundry.callFoundry({ ...o, model: foundry.MODEL_FALLBACK }), logUsage: async () => {} }) : undefined,
    reasoningEffort: foundry.CHAT_REASONING_EFFORT, reportTiming: t => { timing = t; }, reportError: () => {} });
  const started = Date.now();
  let error = '';
  const context = { agent: { name: 'Everest', pers: 'Calm', ...(c.owner ? { ownerName: c.owner } : {}) }, timeZone: TZ, userMessageId: 'msg_1' };
  try {
    if (c.interrupt) {
      // Two messages through the real request handler: the second arrives while the
      // first reply is still being written, as when the owner adds a correction.
      const res = () => ({ writeHead() { return this; }, flushHeaders() {}, write(chunk) { const m = /^data: (.*)\n\n$/s.exec(chunk); if (m) events.push(JSON.parse(m[1])); return true; },
        end() { return this; }, on() {}, off() {}, status() { return this; }, json() { return this; } });
      const post = (prompt, requestId) => coordinator.handle({ originalUrl: '/api/agent/conversation', method: 'POST', user: { id: `eval-${variant}` },
        body: { chatId: `eval-${c.id}-${variant}`, requestId, prompt: prompt, context } }, res());
      const first = post(c.interrupt[0], 'first');
      await new Promise((r) => setTimeout(r, 400));
      await Promise.all([first, post(c.interrupt[1], 'second')]);
    } else {
      await coordinator.run({ userId: `eval-${variant}`, chatId: `eval-${c.id}`, requestId: `${c.id}-${variant}-${Math.random().toString(36).slice(2)}`,
        prompt: c.prompt, history: [], context, onEvent: e => events.push(e) });
    }
  } catch (e) { error = e.message; }
  const final = events.filter(e => e.type === 'message').at(-1);
  const route = calls.task ? 'task' : events.some(e => e.card?.ask) ? 'ask' : 'answer';
  // A card whose items open a page (a product in its store, a place, a source).
  const linked = events.some(e => e.type === 'card' && (e.card.items || []).some(it => /^https:\/\//.test(it.url || '')));
  const prices = events.flatMap(e => (e.type === 'card' && e.card.items || []).map(it => it.price).filter(Boolean));
  const result = { id: c.id, route, text: final?.text || events.find(e => e.card?.ask)?.card.q || '', instructions: calls.task?.instructions || '', cards: events.filter(e => e.type === 'card').map(e => e.card.type), options: events.filter(e => e.card?.ask || e.card?.type === 'connect').flatMap(e => [e.card.q, e.card.note, ...(e.card.options || []).map(o => o.label || o)]).filter(Boolean), linked, prices, cardItems: events.flatMap(e => e.type === 'card' ? (e.card.items || e.card.rows || []) : []), searched: (calls.fns || []).includes('web_search'),
    ms: Date.now() - started, firstTokenMs: timing.firstTokenMs ?? null, modelCalls: calls.model, input: calls.input, cached: calls.cached, output: calls.output, fns: calls.fns || [], args: calls.args || [], error };
  const problems = [];
  if (error) problems.push(`error: ${error}`);
  if (c.expect !== 'any' && route !== c.expect && !((c.expect === 'answer' || c.allowAsk) && route === 'ask')) problems.push(`route ${route}, expected ${c.expect}${route !== 'task' ? `: ${[result.text, ...result.options].join(' | ').slice(0, 200)}` : ''}`);
  if (/could not complete that answer/i.test(result.text)) problems.push('gave up');
  if (result.output > 3000 || result.ms > 20000) problems.push(`runaway: ${result.output} output tokens in ${result.ms}ms`);
  if (route === 'task' && !result.instructions.trim()) problems.push('task started without a brief');
  // The message confirming a task follows the owner's language, not their Swedish time zone or prices.
  const asked = [c.prompt, ...(c.interrupt || [])].join(' ');
  // Place names (Södermalm) are capitalised and are not Swedish prose.
  if (route === 'task' && !/[åäö]|\b(jag|och|min|mitt|mina|kolla|hitta)\b/i.test(asked) && /[åäö]|\b(jag|och|för|att)\b/i.test(result.text.replace(/\p{Lu}[\p{L}-]*/gu, ''))) problems.push(`task reply in the wrong language: ${result.text.slice(0, 160)}`);
  // A dead end: the agent refuses work its tasks can do, or sends the owner to do it. Saying
  // what a connection cannot reach is honest, not a dead end, when it offers what remains.
  if (!c.honest && /\b(can[’']?t|cannot|unable to|not able to|don[’']?t have (?:access|a live))\b[^.]{0,40}\b(open|verify|access|browse|visit|check|see|clock|tell|find)\b|\b(paste|check your (?:device|phone))\b/i.test(result.text)) problems.push(`dead end: ${result.text.slice(0, 200)}`);
  if (!error && c.check) { const p = c.check(result); if (p) problems.push(p.slice(0, 300)); }
  result.pass = !problems.length;
  result.problems = problems;
  return result;
}

(async () => {
  if (!foundry.isConfigured?.() && !process.env.AZURE_FOUNDRY_API_KEY) throw new Error('Foundry is not configured.');
  const selected = CASES.filter(c => !only || c.id.startsWith(only));
  const jobs = [];
  for (let i = 0; i < runs; i++) for (const c of selected) jobs.push([c, i]);
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const [c, i] = jobs[next++];
      const r = await runCase(c, i);
      results.push(r);
      console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} [${r.route}] ${r.ms}ms calls=${r.modelCalls} fns=${r.fns.join(',') || '-'} cards=${r.cards.join(',') || '-'}${r.pass ? '' : '\n     ' + r.problems.join('\n     ')}`);
    }
  }));
  const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0);
  const sorted = results.map(r => r.ms).sort((a, b) => a - b);
  const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const answered = results.filter(r => r.route === 'answer').map(r => r.ms).sort((a, b) => a - b);
  const summary = {
    server: serverDir, model: foundry.MODEL_DEFAULT, effort: foundry.CHAT_REASONING_EFFORT,
    passed: `${results.filter(r => r.pass).length}/${results.length}`,
    p50ms: pct(0.5), p90ms: pct(0.9), answerP50ms: answered[Math.floor(answered.length / 2)] ?? null,
    avgInput: Math.round(sum('input') / results.length), avgCached: Math.round(sum('cached') / results.length), avgOutput: Math.round(sum('output') / results.length),
    avgModelCalls: +(sum('modelCalls') / results.length).toFixed(2),
  };
  console.log(JSON.stringify(summary, null, 2));
  const out = flag('out', '');
  if (out) require('node:fs').writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
