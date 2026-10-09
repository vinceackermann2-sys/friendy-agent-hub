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
// The formulas a calculator card shows, worked out as the app does (from this checkout, so a
// baseline server without calculators is judged the same way).
const { calcResults } = require('../server/agents/cards');

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

// Apple apps on the owner's iPhone, as the real composio_apps lists them beside the OAuth apps.
const iphone = (scopes, over = {}) => [{ id: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f', name: 'iPhone', platform: 'ios', capabilities: Object.fromEntries(['calendar', 'reminders', 'contacts', 'health'].map((s) => [s, scopes.includes(s)])), last_seen_at: new Date().toISOString(), online: true, ...over }];
const ALL_APPLE = ['calendar', 'reminders', 'contacts', 'health'];
// The notes come from the checkout under test, so a baseline server is judged with its own wording.
const appleNote = (devices) => { try { return require(path.join(serverDir, 'agents', 'apple-tools')).appleNote?.(devices); } catch { return undefined; } };
const withApple = (devices, ...connected) => () => ({ ...apps(...connected)(), appleDevices: devices,
  appleNote: appleNote(devices) || 'Apple Calendar, Reminders, Contacts and read-only wellness summaries use apple_devices / apple_execute in the native Belna app. Open the app and connect each scope under Apple apps. Notes, Mail and Messages have no general Apple connector here.' });
const appleTools = (devices, ...connected) => ({ composio_apps: withApple(devices, ...connected), apple_devices: () => ({ devices, note: appleNote(devices) || 'Open the native Belna app, tap Apple apps and connect the needed scope. Devices must remain open for agent actions.' }),
  connect_app: (a) => ({ toolkit: a.toolkit || 'googlecalendar', connected: false }) });
// Work in a connected Apple app is a task (only workers run apple_execute), never a Google connect card.
const appleTask = (r) => r.route === 'task' && !r.cards.includes('connect') ? '' : `expected an Apple task (${r.route}, cards ${r.cards.join(',') || '-'}): ${r.text.slice(0, 200)}`;

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
  paymentSelection: { activeMethod: 'belna_wallet', merchantEnabled: true, selectionSaved: true, methods: { payment_apps: false, shop_pay: false, saved_card: true, belna_wallet: true }, ...over.paymentSelection },
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
    // One calculation with the numbers given is a sentence, not a calculator.
    check: r => /18[\s,.]?200/.test(r.text) && !r.cards.length ? '' : `${r.cards.length ? `carded (${r.cards.join(',')}): ` : ''}${r.text}` },
  { id: 'lookup.news', prompt: 'Who won the most recent Formula 1 Grand Prix?', expect: 'any',
    check: r => r.route === 'task' || r.searched ? '' : `answered without search: ${r.text}` },
  // Weather comes from web search: the forecast passage of the pages, answered in chat.
  { id: 'lookup.weather', prompt: 'What will the weather be like in Stockholm tomorrow?', expect: 'any',
    // A forecast card with temperatures shows the forecast; the reply must not say there is none.
    check: r => r.route === 'task' || ((/°|degrees|grader/i.test(r.text) || r.present.some(c => c.kind === 'forecast' && c.days.some(d => Number.isFinite(d.high)))) && !/(couldn.t|could not|can.t|cannot) find|no (reliable|usable) forecast/i.test(r.text)) ? '' : `no forecast: ${r.text.slice(0, 200)}` },
  // Part of the answer is known and part is current: the known part may be written while the
  // lookup runs, never a figure that may be out of date, and the rest continues it.
  { id: 'mix.ferry', prompt: 'How do I get to Vaxholm from Stockholm, and what does the boat cost right now?', expect: 'any',
    check: r => r.route === 'task' || (/boat|ferr|waxholm/i.test(r.text) && /\d/.test(r.text) && r.searched) ? '' : `no route or price: ${r.text.slice(0, 200)}` },
  { id: 'mix.museum', prompt: 'What is the Vasa Museum, and is it open today?', expect: 'any',
    check: r => r.route === 'task' || (/ship|warship|1628/i.test(r.text) && /open|close|\d/i.test(r.text)) ? '' : `missing what it is or the hours: ${r.text.slice(0, 200)}` },
  { id: 'mix.rate', prompt: 'What is the Riksbank policy rate, and what is it now?', expect: 'any',
    check: r => r.route === 'task' || (/interest|rate|ränt/i.test(r.text) && /\d(?:[.,]\d+)?\s?%|percent/i.test(r.text) && r.searched) ? '' : `missing the rate: ${r.text.slice(0, 200)}` },
  { id: 'lookup.weather.sv', prompt: 'Vad blir vädret i Stockholm i morgon?', expect: 'any',
    check: r => r.route === 'task' || (/°|grader/i.test(r.text) && !/hittar ingen|ingen (tillförlitlig|användbar) prognos/i.test(r.text)) ? '' : `no forecast: ${r.text.slice(0, 200)}` },
  // Reading a page the owner names is a quick lookup; a task added ten seconds for the same answer.
  { id: 'work.site', prompt: 'Go to timewarpdev.com and tell me what the main headline says', expect: 'any',
    // The site's headline changed in October 2026; either one is the page read, not a guess.
    check: r => r.route === 'task' || /bring anything|speed of light/i.test(r.text) ? '' : `wrong or missing headline: ${r.text.slice(0, 200)}` },
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
  // Apple apps connected in the Belna iPhone app: everyday requests reach them without the word "Apple".
  { id: 'apple.calendar', prompt: "What's on my calendar today?", expect: 'task', tools: appleTools(iphone(ALL_APPLE), 'gmail'), check: appleTask },
  { id: 'apple.event', prompt: 'Put the dentist in my calendar on Friday at 15:00', expect: 'task', tools: appleTools(iphone(ALL_APPLE), 'gmail'), check: appleTask },
  { id: 'apple.steps', prompt: 'How many steps have I walked today?', expect: 'task', tools: appleTools(iphone(ALL_APPLE), 'gmail'), check: appleTask },
  { id: 'apple.sleep', prompt: 'How did I sleep last night?', expect: 'task', tools: appleTools(iphone(ALL_APPLE)), check: appleTask },
  { id: 'apple.contact', prompt: "What's Sara Lind's phone number? She's in my contacts.", expect: 'task', tools: appleTools(iphone(ALL_APPLE)), check: appleTask },
  { id: 'apple.reminder', prompt: 'Add "buy oat milk" to my reminders', expect: 'task', tools: appleTools(iphone(ALL_APPLE)), check: appleTask },
  { id: 'apple.sv', prompt: 'Vad har jag i kalendern i morgon?', expect: 'task', tools: appleTools(iphone(ALL_APPLE)), check: appleTask },
  // Not connected anywhere: say where Apple Health connects (the Belna iPhone app), start nothing.
  { id: 'apple.none', prompt: 'How many steps have I walked today?', expect: 'any', honest: true, tools: appleTools([]),
    check: r => r.route !== 'task' && /\b(app|iphone|connect|koppla|anslut)/i.test(r.text) ? '' : `not told where Apple Health connects (${r.route}): ${r.text.slice(0, 200)}` },
  // The phone is registered but Belna is closed on it: ask the owner to open it.
  { id: 'apple.offline', prompt: 'How many steps have I walked today?', expect: 'any', honest: true, tools: appleTools(iphone(ALL_APPLE, { online: false, last_seen_at: new Date(Date.now() - 3 * 3600e3).toISOString() })),
    check: r => r.route === 'task' || /\bopen\b/i.test(r.text) ? '' : `offline phone not explained (${r.route}): ${r.text.slice(0, 200)}` },
  { id: 'apple.connect', prompt: 'Connect my Apple Health', expect: 'any', honest: true, tools: appleTools([]),
    check: r => r.route !== 'task' && /connectors|apple apps|belna app|iphone/i.test(r.text) ? '' : `no way to connect Apple Health (${r.route}): ${r.text.slice(0, 200)}` },
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
    // Five picks as a card (photos, map links) or as a well-formatted list in the text.
    check: r => r.cards.includes('present') || r.text.split('\n').filter(l => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l)).length >= 5 ? '' : `five picks neither as a card nor a list: ${r.text.slice(0, 160)}` },
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
    check: r => /saved|store/i.test(r.text) && /belna|balance/i.test(r.text) && /can[’']?t|cannot|not (?:yet )?(?:ready|available)|isn[’']?t|doesn[’']?t (?:yet )?pay|identity|verif/i.test(r.text) ? '' : `did not name the saved card that is on and that the Belna balance cannot pay yet: ${r.text}` },
  { id: 'wallet.method.existing', prompt: 'What will you pay with when you order things for me?', expect: 'answer', honest: true,
    tools: { wallet_status: wallet({ paymentSelection: { activeMethod: 'existing_card', methods: { payment_apps: true, shop_pay: true, saved_card: true, belna_wallet: false } } }), shop_status: shopPay() },
    check: r => /shop pay|saved|existing|already/i.test(r.text) ? '' : `did not name the existing card: ${r.text}` },
  { id: 'wallet.method.none', prompt: 'Can you pay for things for me?', expect: 'any', honest: true,
    tools: { wallet_status: wallet({ paymentSelection: { activeMethod: null, merchantEnabled: false, selectionSaved: false, methods: { payment_apps: false, shop_pay: false, saved_card: false, belna_wallet: false } } }), shop_status: shopPay({ connected: false }) },
    check: r => r.route !== 'task' && /wallet|swish|klarna/i.test(`${r.text} ${r.options.join(' ')}`) ? '' : `did not point to choosing a wallet or paying on the phone (${r.route}): ${r.text}` },
  { id: 'wallet.address', prompt: 'Where would you ship an order to?', expect: 'answer', tools: { shipping_addresses: addresses },
    check: r => /sveav[äa]gen/i.test(r.text) && r.fns.includes('shipping_addresses') ? '' : `wrong address: ${r.text}` },
  { id: 'wallet.activity', prompt: 'What came in and went out of my wallet lately?', expect: 'answer', tools: { wallet_status: wallet() },
    // The activity can come as a card; what the owner sees is the reply and the card together.
    check: r => /200/.test(`${r.text} ${JSON.stringify(r.cardItems)}`) && /\b20(\.00)?\b|anna/i.test(`${r.text} ${JSON.stringify(r.cardItems)}`) ? '' : `missed activity: ${r.text}` },
  { id: 'wallet.send', prompt: 'Send $10 to anna@example.se from my Belna wallet', expect: 'task', tools: { wallet_status: wallet() },
    check: r => /anna@example\.se/.test(r.instructions) && /\b10\b/.test(r.instructions) ? '' : `brief lost the recipient or amount: ${r.instructions}` },
  { id: 'wallet.link', prompt: 'Make me a payment link for $150 for the logo design I did', expect: 'answer', tools: { wallet_status: wallet() },
    check: r => /payment.?link/i.test(r.text) && /unavailable|not (?:available|supported)|(?:aren|isn)[’']?t available|removed|can[’']?t|cannot|doesn[’']?t (?:create|make|support)/i.test(r.text) ? '' : `did not explain removed payment links: ${r.text}` },
  { id: 'wallet.limit', prompt: 'Raise my daily card limit to $100', expect: 'task', tools: { wallet_status: wallet() },
    check: r => /100/.test(r.instructions) ? '' : `brief lost the limit: ${r.instructions}` },
  { id: 'wallet.withdraw', prompt: 'Withdraw $100 from my wallet to my bank account', expect: 'any', honest: true, tools: { wallet_status: wallet() },
    check: r => r.route !== 'task' && /withdraw/i.test(r.text) ? '' : `did not explain bank withdrawals (${r.route}): ${r.text}` },
  { id: 'wallet.deposit', prompt: 'How do I put money into my wallet?', expect: 'answer', honest: true, tools: { wallet_status: wallet() },
    check: r => /deposit|add money/i.test(r.text) && /wallet/i.test(r.text) ? '' : `did not explain deposits: ${r.text}` },
  { id: 'wallet.setup', prompt: 'Set up a Belna wallet for me', expect: 'any', honest: true,
    tools: { wallet_status: wallet({ wallet: { status: 'not_created', balance: null, cardReady: false, agentCardPayments: false }, paymentSelection: { activeMethod: null, selectionSaved: false } }) },
    check: r => r.route !== 'task' && /wallet/i.test(r.text) && /country|create|identity|verif/i.test(r.text) ? '' : `did not guide wallet setup (${r.route}): ${r.text}` },
  // Payment apps on (Swish is one) need no Belna card: the owner approves the payment in the app.
  { id: 'wallet.buy.swish', prompt: 'Buy the oak desk lamp on lampor.se for me and pay with Swish', expect: 'task',
    tools: { wallet_status: wallet({ paymentSelection: { activeMethod: null, merchantEnabled: false, selectionSaved: true, methods: { ...{ payment_apps: false, shop_pay: false, saved_card: false, belna_wallet: false }, payment_apps: true } } }), shop_status: shopPay({ connected: false }) } },
  // Payment apps off: say it is off and where to turn it on, instead of starting the purchase.
  { id: 'wallet.buy.swish.off', prompt: 'Buy the oak desk lamp on lampor.se for me and pay with Swish', expect: 'any', honest: true,
    tools: { wallet_status: wallet({ paymentSelection: { activeMethod: null, merchantEnabled: false, selectionSaved: true, methods: { payment_apps: false, shop_pay: false, saved_card: false, belna_wallet: false } } }), shop_status: shopPay({ connected: false }) },
    check: r => r.route !== 'task' && /swish|payment app/i.test(r.text) && /turn|off|enable|wallet/i.test(`${r.text} ${r.options.join(' ')}`) ? '' : `did not say Swish is off (${r.route}): ${r.text || r.instructions}` },
  // Shop Pay is one of the payment apps: off with them, even when the Shop account is connected.
  { id: 'wallet.buy.shoppay.off', prompt: 'Buy the oak desk lamp on lampor.se for me and pay with Shop Pay', expect: 'any', honest: true,
    tools: { wallet_status: wallet({ paymentSelection: { activeMethod: null, merchantEnabled: true, selectionSaved: true, methods: { payment_apps: false, shop_pay: false, saved_card: true, belna_wallet: false } } }), shop_status: shopPay() },
    check: r => r.route !== 'task' && /shop pay|payment app/i.test(r.text) && /turn|off|enable|wallet|settings/i.test(`${r.text} ${r.options.join(' ')}`) ? '' : `did not say Shop Pay is off with the payment apps (${r.route}): ${r.text || r.instructions}` },
  { id: 'wallet.shoppay.on', prompt: 'Can you pay with Shop Pay when you buy things for me?', expect: 'answer', honest: true,
    tools: { wallet_status: wallet({ paymentSelection: { activeMethod: null, merchantEnabled: false, selectionSaved: true, methods: { payment_apps: true, shop_pay: true, saved_card: false, belna_wallet: false } } }), shop_status: shopPay({ connected: false }) },
    check: r => /shop pay/i.test(r.text) && /\byes\b|\bcan\b|turned on|is on|\bon\b/i.test(r.text) && !/connect (?:your |the )?shop(?: pay| account)? first|need(?:s)? to connect/i.test(r.text) ? '' : `did not say Shop Pay works with payment apps on, without a connection: ${r.text}` },
  { id: 'wallet.buy.notready', prompt: 'Buy me AirPods Pro with my Belna wallet', expect: 'any', honest: true, tools: { wallet_status: wallet(), shop_status: shopPay() },
    check: r => /identity|verif|not (?:yet )?(?:ready|available|set up|enabled)|isn[’']?t (?:yet )?(?:ready|available|set up|enabled)|can[’']?t use it|can[’']?t (?:yet )?pay/i.test(`${r.text} ${r.options.join(' ')} ${r.instructions}`) ? '' : `did not say wallet card checkout is not ready (${r.route}): ${r.text || r.instructions}` },
  { id: 'wallet.freeze', prompt: 'Freeze my wallet card right now', expect: 'any', honest: true, tools: { wallet_status: wallet({ wallet: { status: 'ready', cardReady: true, card: { last4: null, status: 'active', dailyLimitUsd: 50 } } }) },
    check: r => /freez|pause/i.test(`${r.text} ${r.instructions}`) ? '' : `ignored the freeze request (${r.route}): ${r.text}` },
  // The agent knows the owner's name from their profile and uses it where it belongs.
  { id: 'owner.name', prompt: "What's my name?", expect: 'answer', owner: 'Marie-Louise',
    check: r => /marie-louise/i.test(r.text) ? '' : `did not know the name: ${r.text}` },
  { id: 'owner.signed', prompt: 'Write a two-line thank-you note to my neighbour for watering my plants, signed by me.', expect: 'answer', owner: 'Marie-Louise',
    // A note can come as a draft card; its body is what the owner sends.
    check: r => /marie-louise/i.test(`${r.text} ${r.present.map(c => c.body || '').join(' ')}`) ? '' : `not signed with the name: ${r.text}` },
  // The owner writes in English from a Swedish time zone: the reply stays in English.
  { id: 'chat.language', prompt: 'Any tips for a rainy Sunday?', expect: 'answer',
    check: r => /\b(the|and|you)\b/i.test(r.text) && !/\b(och|du|att)\b/i.test(r.text) ? '' : `wrong language: ${r.text}` },
  // Doing what the owner said: their format, count, language, tools and corrections win
  // over the agent's own habits (cards, searches, tasks).
  { id: 'obey.oneword', prompt: "What's the capital of Japan? Answer with one word only.", expect: 'answer',
    check: r => /^\W*tokyo\W*$/i.test(r.text.trim()) ? '' : `not one word: ${r.text}` },
  { id: 'obey.plainlist', prompt: 'List eight Swedish fruits and berries on one line, separated by commas. No card, just text.', expect: 'answer',
    check: r => !r.cards.length && r.text.split(',').length >= 8 && r.text.trim().split('\n').filter(l => l.trim()).length <= 2 ? '' : `ignored the format (cards: ${r.cards.join(',') || '-'}): ${r.text.slice(0, 200)}` },
  { id: 'obey.count', prompt: 'Give me exactly 3 name ideas for a small coffee shop.', expect: 'answer',
    check: r => { const n = r.cardItems.length || r.text.split('\n').filter(l => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l)).length; return n === 3 ? '' : `${n} ideas, wanted 3: ${r.text.slice(0, 200)}`; } },
  { id: 'obey.french', prompt: 'Explain photosynthesis in one sentence, in French.', expect: 'answer',
    check: r => /\b(la|les|des|est|lumière|plantes?)\b/i.test(r.text) && !/\b(the|and|is)\b/i.test(r.text) ? '' : `not French: ${r.text}` },
  { id: 'obey.nosearch', prompt: "Don't search the web, just from memory: roughly how tall is the Eiffel Tower?", expect: 'answer',
    check: r => !r.fns.includes('web_search') && /3[0-3]\d\s?(m|meters|metres)|1[,.]?0\d\d\s?(ft|feet)/i.test(r.text) ? '' : `searched or wrong (${r.fns.join(',')}): ${r.text.slice(0, 160)}` },
  { id: 'obey.search', prompt: 'Search the web for the latest news about the Artemis moon program and summarize it in two sentences.', expect: 'any',
    check: r => r.route === 'task' || r.fns.includes('web_search') ? '' : `answered without the search the owner asked for: ${r.text.slice(0, 160)}` },
  { id: 'obey.table', prompt: 'Show me a table of the eight planets with their number of known moons.', expect: 'any',
    // A table card, or a markdown table in the text (the app draws it as a table).
    check: r => r.route === 'task' || (r.cards.includes('present') && r.cardItems.length >= 8) || r.text.split('\n').filter(l => /^\s*\|.*\|\s*$/.test(l)).length >= 10 ? '' : `no table (cards ${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` },
  { id: 'obey.notask', prompt: "Don't start a task, just give me one quick vegetarian dinner idea.", expect: 'answer',
    check: r => r.text.length > 20 ? '' : `empty: ${r.text}` },
  { id: 'obey.convert', prompt: 'In Fahrenheit please', expect: 'answer',
    history: [['user', 'What oven temperature should I roast vegetables at?'], ['agent', 'Roast them at 220°C for about 25–30 minutes, turning once.']],
    check: r => /4[23]\d\s?°?\s?F|4[23]\d\s?(degrees )?fahrenheit/i.test(r.text) ? '' : `no Fahrenheit: ${r.text}` },
  { id: 'obey.shorter', prompt: 'Shorter. One sentence.', expect: 'answer',
    history: [['user', 'Why do cats purr?'], ['agent', 'Cats purr for several reasons. Most often it signals contentment, like when they are being petted or are relaxed in a warm spot. But cats also purr when they are stressed, injured or giving birth, which suggests purring can be self-soothing. Some research even suggests that the vibrations, at 25–150 Hz, may help bones and tissues heal. Mother cats purr to guide their kittens, and kittens purr while nursing to signal that all is well.']],
    check: r => r.text.split(/(?<=[.!?])\s+/).filter(Boolean).length === 1 && r.text.length < 260 ? '' : `not one sentence: ${r.text}` },
  { id: 'obey.translate', prompt: "Translate into Swedish: 'Good morning, did you sleep well?'", expect: 'answer',
    check: r => /god morgon/i.test(r.text) && /sov/i.test(r.text) ? '' : `bad translation: ${r.text}` },
  { id: 'obey.noquestions', prompt: "Pick a movie for me to watch tonight. Don't ask me anything, just choose.", expect: 'answer',
    check: r => r.route === 'answer' && !/\?\s*$/.test(r.text.trim()) ? '' : `asked instead of choosing (${r.route}): ${r.text.slice(0, 160)}` },
  { id: 'obey.code', prompt: 'Give me a Python one-liner that reverses a string.', expect: 'answer',
    check: r => /\[::-1\]|reversed\(/.test(r.text) ? '' : `no code: ${r.text.slice(0, 160)}` },
  { id: 'obey.continents', prompt: 'What are the seven continents?', expect: 'answer',
    check: r => /antarctica/i.test(`${r.text} ${JSON.stringify(r.cardItems)}`) ? '' : `missing continents: ${r.text.slice(0, 160)}` },
  // Learning: quizzes, flashcards, practice problems and graphs are interactive cards the
  // owner works through, with the number of items asked for and correct answers.
  { id: 'learn.quiz', prompt: 'Quiz me on European capitals, 5 questions.', expect: 'answer',
    check: r => { const q = learnCard(r, 'quiz'); if (!q) return `no quiz card (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`;
      if (q.questions.length !== 5) return `${q.questions.length} questions, wanted 5`;
      const wrong = q.questions.filter(x => { const country = Object.keys(CAPITALS).find(k => new RegExp(`\\b${k}\\b`, 'i').test(x.question)); return country && !new RegExp(CAPITALS[country], 'i').test(x.options[x.answer]); });
      return wrong.length ? `wrong answers: ${wrong.map(x => `${x.question} → ${x.options[x.answer]}`).join('; ')}` : leaked(r, q); } },
  { id: 'learn.times', prompt: 'Make a 4 question multiplication quiz for my 8 year old.', expect: 'answer',
    check: r => { const q = learnCard(r, 'quiz'); if (!q) return `no quiz card: ${r.text.slice(0, 160)}`;
      if (q.questions.length !== 4) return `${q.questions.length} questions, wanted 4`;
      const wrong = q.questions.filter(x => { const m = /(\d+)\s*(?:[×x*·]|times)\s*(\d+)/i.exec(x.question); return m && Number(String(x.options[x.answer]).replace(/[^\d.]/g, '')) !== m[1] * m[2]; });
      return wrong.length ? `wrong answers: ${wrong.map(x => `${x.question} → ${x.options[x.answer]}`).join('; ')}` : ''; } },
  { id: 'learn.flash', prompt: 'Make me flashcards for 8 common Spanish verbs.', expect: 'answer',
    check: r => { const f = learnCard(r, 'flashcards'); return !f ? `no flashcards (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` : f.cards.length === 8 ? '' : `${f.cards.length} cards, wanted 8`; } },
  { id: 'learn.problem', prompt: 'Give me a practice problem on solving linear equations, with hints.', expect: 'answer',
    check: r => { const p = learnCard(r, 'problem'); return !p ? `no problem card (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` : p.problems.every(x => x.steps.length >= 2) ? leaked(r, p) : 'a problem without step-by-step hints'; } },
  { id: 'learn.solve', prompt: 'Teach me how to solve 3x - 5 = 10, step by step.', expect: 'answer',
    check: r => { const p = learnCard(r, 'problem'); const said = p ? p.problems.map(x => `${x.answer} ${x.accept || ''}`).join(' ') : r.text; return /\b5\b/.test(said) ? '' : `wrong or missing answer: ${said.slice(0, 200)}`; } },
  { id: 'learn.plot', prompt: 'Show me what the graph of y = x^2 - 4 looks like.', expect: 'answer',
    check: r => { const p = learnCard(r, 'plot'); return !p ? `no graph (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` : p.functions.some(f => /x\s*\^\s*2/.test(f.expr) && /-\s*4/.test(f.expr)) ? '' : `wrong function: ${JSON.stringify(p.functions)}`; } },
  { id: 'learn.slider', prompt: 'Help me understand how a changes the parabola y = a*x^2.', expect: 'answer',
    check: r => { const p = learnCard(r, 'plot'); return p && p.slider?.name === 'a' && p.functions.some(f => /\ba\b/.test(f.expr)) ? '' : `no graph with an a slider: ${JSON.stringify(p || r.cards)}`; } },
  { id: 'learn.swedish', prompt: 'Förhör mig på fem engelska glosor, översätt till svenska.', expect: 'answer',
    check: r => { const c = learnCard(r, 'quiz') || learnCard(r, 'flashcards'); const n = c ? (c.questions || c.cards).length : 0;
      return !c ? `no learning card: ${r.text.slice(0, 160)}` : n !== 5 ? `${n} items, wanted 5` : /[åäö]|\b(du|och|att|på)\b/i.test(r.text) ? '' : `reply not Swedish: ${r.text}`; } },
  { id: 'learn.plain', prompt: "What's 15% of 80?", expect: 'answer',
    check: r => /\b12\b/.test(r.text) && !r.cards.length ? '' : `wrong or carded (${r.cards.join(',') || '-'}): ${r.text}` },
  { id: 'learn.ten', prompt: 'Quiz me with 10 questions on European capitals.', expect: 'answer',
    check: r => { const q = learnCard(r, 'quiz'); if (!q) return `no quiz: ${r.text.slice(0, 160)}`; if (q.questions.length !== 10) return `${q.questions.length} questions, wanted 10`;
      const wrong = q.questions.filter(x => { const country = Object.keys(CAPITALS).find(k => new RegExp(`\\b(${k})\\b`, 'i').test(x.question)); return country && !new RegExp(CAPITALS[country], 'i').test(x.options[x.answer]); });
      return wrong.length ? `wrong answers: ${wrong.map(x => x.question).join(' | ')}` : leaked(r, q); } },
  // Visual answers: a schedule is a timeline, a tool to work numbers out is a calculator whose
  // formulas give the right result, and a choice between options is shown side by side.
  { id: 'ui.timeline', prompt: 'Give me a timing plan for a roast chicken dinner that is on the table at 7pm.', expect: 'answer',
    // A timeline card, or a table of times: either shows the schedule at a glance.
    check: r => { const table = presentCard(r, 'table'); if (table && table.rows.filter(row => /\d{1,2}[:.]\d{2}|\d\s?(?:am|pm)/i.test(row[0] || '')).length >= 4) return '';
      const t = presentCard(r, 'timeline') || presentCard(r, 'steps'); if (!t) return `no timeline (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`;
      return t.kind === 'timeline' && t.items.filter(it => it.when).length >= 4 ? '' : `timeline without times (${t.kind}): ${JSON.stringify(t.items.map(it => it.when || it.title)).slice(0, 200)}`; } },
  { id: 'ui.calc.bill', prompt: 'Make me a calculator to split a restaurant bill with a tip between friends.', expect: 'answer',
    check: r => { const c = presentCard(r, 'calculator'); if (!c) return `no calculator (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`;
      // By name first ("Tip (% of bill)" is the tip, not the bill), each input once.
      const used = new Set(), find = (rx) => { const i = c.inputs.find(x => !used.has(x) && rx.test(x.name)) || c.inputs.find(x => !used.has(x) && rx.test(x.label)); if (i) used.add(i); return i; };
      const tip = find(/tip|dricks/i), people = find(/people|friends|persons|split|ways|guests|diners|personer/i), bill = find(/bill|total|amount|subtotal|nota|summa/i);
      if (!bill || !people || !tip) return `missing inputs: ${c.inputs.map(i => i.name).join(',')}`;
      const out = calcResults(c, { [bill.name]: 1000, [people.name]: 4, [tip.name]: tip.unit === '%' || tip.max > 1 || tip.value >= 1 ? 10 : 0.1 }).map(o => o.value);
      return out.some(v => v != null && Math.abs(v - 275) < 0.6) ? '' : `no output gives 275 per person for 1000 + 10% between 4: ${JSON.stringify(out)} ${JSON.stringify(c.outputs.map(o => o.formula))}`; } },
  { id: 'ui.calc.savings', prompt: 'Build me a quick calculator for how my savings grow with a monthly deposit and yearly interest.', expect: 'answer',
    check: r => { const c = presentCard(r, 'calculator'); if (!c) return `no calculator (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`;
      const out = calcResults(c).map(o => o.value);
      return c.inputs.length >= 3 && out.some(v => v != null && v > 0) ? '' : `incomplete: ${c.inputs.map(i => i.name).join(',')} → ${JSON.stringify(out)}`; } },
  { id: 'ui.compare', prompt: 'Should I get the Kindle Paperwhite or the Kobo Clara BW? Help me choose.', expect: 'any',
    check: r => { if (r.route === 'task') return ''; const c = presentCard(r, 'compare') || presentCard(r, 'table'); if (!c) return `no comparison (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`;
      return c.kind === 'table' || (c.items.length === 2 && c.items.some(it => (it.pros || []).length)) ? '' : `compare without options or pros: ${JSON.stringify(c.items).slice(0, 200)}`; } },
  // More components: places with photos, recipes that scale, forecasts, drafts, donuts, and
  // the sources a looked-up answer shows.
  { id: 'ui.places', prompt: 'What are the must-see sights in Lisbon? Show me the places.', expect: 'answer',
    check: r => { const p = presentCard(r, 'places') || presentCard(r, 'list') || presentCard(r, 'timeline') || presentCard(r, 'gallery'); if (!p) return `no places (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`;
      const photos = p.items.filter(it => /^https:\/\//.test(it.image || '')).length; return p.items.length >= 4 && photos >= 2 ? '' : `${p.kind} with ${p.items.length} items, ${photos} photos`; } },
  { id: 'ui.recipe', prompt: 'Give me a recipe for pancakes for 4 people.', expect: 'answer',
    check: r => { const c = presentCard(r, 'recipe'); if (!c) return `no recipe card (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`;
      return c.servings === 4 && c.ingredients.filter(g => g.amount > 0).length >= 3 && c.steps.length >= 3 ? '' : `incomplete recipe: ${JSON.stringify({ servings: c.servings, ingredients: c.ingredients.length, steps: c.steps.length })}`; } },
  { id: 'ui.weather', prompt: 'What will the weather be like in Stockholm this weekend?', expect: 'any',
    check: r => { if (r.route === 'task') return ''; const c = presentCard(r, 'forecast');
      if (c && !c.days.some(d => Number.isFinite(d.high))) return `forecast without temperatures: ${JSON.stringify(c.days)}`;
      return c || /°|degrees|grader/i.test(r.text) ? '' : `no temperature in the reply: ${r.text.slice(0, 160)}`; } },
  { id: 'ui.draft', prompt: 'Write a short email to my landlord asking them to fix the dripping kitchen tap this week.', expect: 'any',
    check: r => { if (r.route === 'task') return ''; const c = presentCard(r, 'draft'); return c && /tap|faucet/i.test(c.body) ? '' : `no draft card (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`; } },
  { id: 'ui.donut', prompt: 'My monthly budget: rent 11000, food 5500, transport 1800, savings 6000, other 3200 kr. Show me how it splits.', expect: 'answer',
    check: r => { const c = r.present.find(x => x.chart); return c && c.chart.type === 'donut' && c.chart.series[0].values.length === 5 ? '' : `no donut (${r.present.map(x => x.kind + ':' + (x.chart?.type || '-')).join(',') || '-'})`; } },
  // Understanding: a walkthrough or a diagram when the owner wants to know how something works,
  // matching and ordering exercises, a graph to see a result change; a quick fact stays a sentence.
  { id: 'learn.explain', prompt: 'Walk me through how a bill becomes law in the US, step by step.', expect: 'answer',
    check: r => { const c = learnCard(r, 'explain') || learnCard(r, 'diagram'); const n = c ? (c.steps || c.nodes).length : 0;
      return n >= 4 && /committee/i.test(JSON.stringify(c)) && /president|veto|sign/i.test(JSON.stringify(c)) ? '' : `no walkthrough (${r.cards.join(',') || '-'}, ${n} parts): ${r.text.slice(0, 160)}`; } },
  { id: 'learn.diagram', prompt: 'Help me understand the water cycle.', expect: 'answer',
    check: r => { const c = learnCard(r, 'diagram') || learnCard(r, 'explain'); const all = JSON.stringify(c || {});
      return c && /evaporat/i.test(all) && /condens/i.test(all) && /precipitat|rain/i.test(all) ? '' : `no diagram or explainer of the cycle (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`; } },
  { id: 'learn.match', prompt: 'Give me a matching exercise: 5 European countries and their capitals.', expect: 'answer',
    check: r => { const c = learnCard(r, 'match'); if (!c) return `no match card (${r.cards.join(',') || '-'})`; if (c.pairs.length !== 5) return `${c.pairs.length} pairs, wanted 5`;
      const wrong = c.pairs.filter(p => { const k = Object.keys(CAPITALS).find(x => new RegExp(`^(${x})$`, 'i').test(p.term.trim())); return !k || !new RegExp(CAPITALS[k], 'i').test(p.match); });
      return wrong.length ? `wrong pairs: ${JSON.stringify(wrong)}` : leaked(r, { questions: [], problems: c.pairs.map(p => ({ answer: p.match })) }); } },
  { id: 'learn.order', prompt: 'Test me on the order of the planets from the Sun.', expect: 'answer',
    check: r => { const c = learnCard(r, 'order'); const want = 'mercury venus earth mars jupiter saturn uranus neptune';
      return c && c.sequence.map(s => s.toLowerCase().replace(/[^a-z]/g, '')).join(' ') === want ? '' : `no correct order card (${r.cards.join(',') || '-'}): ${JSON.stringify(c?.sequence || r.text.slice(0, 120))}`; } },
  { id: 'ui.calc.graph', prompt: 'Show me how saving 2000 kr a month at 7% a year grows over 30 years. Something I can play with.', expect: 'answer',
    check: r => { const c = presentCard(r, 'calculator'); if (!c) return `no calculator (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`;
      const end = calcResults(c).map(o => o.value).filter(v => v != null); return c.graph && end.some(v => v > 1.9e6 && v < 2.6e6) ? '' : `graph ${!!c.graph}, results ${JSON.stringify(end)}`; } },
  // Text first: explanations, ideas, advice and stories are written answers; a card would only restate them.
  { id: 'text.concept', prompt: 'What is inflation?', expect: 'answer',
    check: r => !r.cards.length && r.text.length > 80 ? '' : `carded or thin (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` },
  { id: 'text.ideas', prompt: 'Give me three ideas for a rainy Sunday at home.', expect: 'answer',
    check: r => !r.cards.length ? '' : `needless card (${r.cards.join(',')}): ${r.text.slice(0, 160)}` },
  { id: 'text.advice', prompt: 'How can I sleep better?', expect: 'answer',
    check: r => !r.cards.length && r.text.length > 80 ? '' : `carded or thin (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` },
  { id: 'text.story', prompt: 'Tell me briefly about the history of the Eiffel Tower.', expect: 'answer',
    check: r => !r.cards.length && /1889/.test(r.text) ? '' : `carded or missing 1889 (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` },
  { id: 'learn.quickfact', prompt: 'In one sentence: what does the heart do?', expect: 'answer',
    check: r => !r.cards.length && r.text.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2 ? '' : `carded or long (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` },
  // Checklists: things the owner ticks off, in sections, in the app (ChatGPT's shopping checklist).
  { id: 'ui.checklist', prompt: 'Make me a packing list for a weekend of hiking in the mountains.', expect: 'answer',
    check: r => { const c = presentCard(r, 'checklist'); if (!c) return `no checklist (${r.cards.join(',') || '-'}; ${(r.present[0] || {}).kind || ''}): ${r.text.slice(0, 160)}`;
      return c.items.length >= 8 && new Set(c.items.map(it => it.group).filter(Boolean)).size >= 2 ? '' : `thin or ungrouped checklist: ${JSON.stringify(c.items).slice(0, 200)}`; } },
  { id: 'ui.shopping', prompt: "I'm making lasagne and a green salad for 6 people on Saturday. Give me the shopping list.", expect: 'answer',
    check: r => { const c = presentCard(r, 'checklist'); if (!c) return `no checklist (${r.cards.join(',') || '-'}; ${(r.present[0] || {}).kind || ''}): ${r.text.slice(0, 160)}`;
      return c.items.length >= 8 && c.items.some(it => /pasta|lasagn/i.test(it.title)) ? '' : `checklist misses the pasta: ${JSON.stringify(c.items).slice(0, 200)}`; } },
  // Help me choose: a recommendation that depends on the owner asks what would change the pick.
  { id: 'ui.refine', prompt: 'AirPods Pro 3 or Sony WF-1000XM5? Help me decide.', expect: 'any',
    check: r => { if (r.route === 'task') return ''; const c = presentCard(r, 'compare'); if (!c) return `no comparison (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}`;
      return (c.refine || []).every(q => q.options.length >= 2) ? '' : `bad refine questions: ${JSON.stringify(c.refine)}`; } },
  // The owner's answers from that form come back as a message: a clear pick, not more questions.
  { id: 'ui.refine.answer', expect: 'answer',
    history: [['user', 'iPhone 17 or Pixel 10? Help me choose.'], ['agent', 'Both are strong; the iPhone is the safer all-rounder, the Pixel wins on zoom and price. Answer the questions under the comparison and I will pick for you.']],
    prompt: 'Help me choose. What phone do you have now? Android (Samsung, Pixel). What matters most to you? Camera and photos. How do the prices compare where you buy? The Pixel 10 is cheaper.',
    check: r => /pixel/i.test(r.text) && !r.cards.includes('question') && !/\?\s*$/.test(r.text.trim()) ? '' : `no clear pick (${r.cards.join(',') || '-'}): ${r.text.slice(0, 200)}` },
  // A plan of several parts is one card with a section per part (ChatGPT's dinner-party answer).
  { id: 'ui.plan.dinner', prompt: 'Plan a dinner party for 6 people: a menu and a shopping list.', expect: 'answer',
    check: r => { const p = presentCard(r, 'plan'); if (!p) return `no plan (${r.cards.join(',') || '-'}; ${r.present.map(c => c.kind).join(',')}): ${r.text.slice(0, 160)}`;
      return p.sections.length >= 2 && p.sections.some(s => s.kind === 'checklist' && s.items.length >= 6) && p.sections.some(s => s.kind === 'list' || s.kind === 'timeline') ? '' : `plan misses the menu or the shopping list: ${JSON.stringify(p.sections.map(s => [s.kind, s.title, (s.items || s.rows || []).length]))}`; } },
  { id: 'ui.plan.move', prompt: "I'm moving to a new flat in three weeks. Help me plan it.", expect: 'answer',
    check: r => presentCard(r, 'plan') || presentCard(r, 'checklist') || presentCard(r, 'timeline') ? '' : `no plan, checklist or timeline (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` },
  // Fewer visuals: asked once in the conversation, or saved as a preference, no card follows.
  { id: 'obey.novisual', expect: 'answer',
    history: [['user', 'From now on, no cards or visuals please. Just text.'], ['agent', 'Got it, text only from now on.']],
    prompt: 'Compare cats and dogs as pets for someone who lives in a small flat.',
    check: r => !r.cards.some(t => t === 'present' || t === 'learn') && /cat/i.test(r.text) && /dog/i.test(r.text) ? '' : `used a card after "no cards" (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` },
  // The same comparison with no such request is shown side by side.
  { id: 'ui.compare.pets', prompt: 'Compare cats and dogs as pets for someone who lives in a small flat.', expect: 'answer',
    check: r => presentCard(r, 'compare') || presentCard(r, 'table') ? '' : `no comparison (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` },
  { id: 'obey.novisual.memory', expect: 'answer', memories: [{ id: 'mem_2', text: 'The owner wants plain text answers, without cards or visuals.', category: 'user' }],
    prompt: 'Make me a packing list for a weekend in Paris.',
    check: r => !r.cards.some(t => t === 'present' || t === 'learn') && r.text.split('\n').length >= 5 ? '' : `ignored the saved preference (${r.cards.join(',') || '-'}): ${r.text.slice(0, 160)}` },
];
function presentCard(r, kind) { return r.present.find(c => c.kind === kind) || null; }
const CAPITALS = { France: 'Paris', Germany: 'Berlin', Spain: 'Madrid', Italy: 'Rome', Portugal: 'Lisbon', Sweden: 'Stockholm', Norway: 'Oslo', Denmark: 'Copenhagen', Finland: 'Helsinki', Poland: 'Warsaw', Austria: 'Vienna', Hungary: 'Budapest', Greece: 'Athens', Ireland: 'Dublin', Netherlands: 'Amsterdam', Belgium: 'Brussels', Switzerland: 'Bern', 'Czech Republic|Czechia': 'Prague', Romania: 'Bucharest', Bulgaria: 'Sofia', Croatia: 'Zagreb', Slovakia: 'Bratislava', Slovenia: 'Ljubljana', Estonia: 'Tallinn', Latvia: 'Riga', Lithuania: 'Vilnius', Iceland: 'Reykjav', Ukraine: 'Kyiv|Kiev', Serbia: 'Belgrade', 'United Kingdom|UK': 'London' };
function learnCard(r, kind) { return r.learn.find(c => c.kind === kind) || null; }
// The reply around a learning card must not give its answers away.
function leaked(r, card) {
  const answers = (card.questions || []).map(q => q.options[q.answer]).concat((card.problems || []).map(p => p.answer)).filter(a => String(a).length > 2);
  const hit = answers.filter(a => r.text.toLowerCase().includes(String(a).toLowerCase()));
  return hit.length > 1 ? `reply gives away answers: ${hit.join(', ')}` : '';
}

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
  // Each event keeps when it arrived, for the time until the owner first sees something.
  const t0 = Date.now();
  events.push = function (...xs) { for (const x of xs) if (x && typeof x === 'object' && x._t == null) x._t = Date.now() - t0; return Array.prototype.push.apply(this, xs); };
  const { tasks, tools } = stubs(calls, c);
  let timing = {};
  const model = async (opts) => {
    calls.model++;
    const r = await foundry.callFoundryWithTools(opts);
    calls.input += Number(r.usage?.input_tokens) || 0;
    calls.cached += Number(r.usage?.input_tokens_details?.cached_tokens) || 0;
    calls.output += Number(r.usage?.output_tokens) || 0;
    for (const f of r.functionCalls || []) { (calls.fns ||= []).push(f.name); (calls.args ||= []).push({ name: f.name, args: f.args }); }
    // What each model call did, in order (a lookup round, a card, a text answer).
    (calls.rounds ||= []).push((r.functionCalls || []).map(f => f.name).join('+') || 'text');
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
  // What stays on screen: the start of an answer written while it looked things up, then the rest.
  const screen = new Map();
  for (const e of events) {
    if (e.type === 'message_delta') screen.set(e.id, (screen.get(e.id) || '') + (e.delta || ''));
    else if (e.type === 'message') screen.set(e.id, e.text || '');
    else if (e.type === 'message_retract') screen.delete(e.id);
  }
  const shown = c.interrupt ? final?.text || '' : [...screen.values()].map(t => t.trim()).filter(Boolean).join('\n\n');
  const route = calls.task ? 'task' : events.some(e => e.card?.ask) ? 'ask' : 'answer';
  // A card whose items open a page (a product in its store, a place, a source).
  const linked = events.some(e => e.type === 'card' && (e.card.items || []).some(it => /^https:\/\//.test(it.url || '')));
  const prices = events.flatMap(e => (e.type === 'card' && e.card.items || []).map(it => it.price).filter(Boolean));
  const result = { id: c.id, route, text: shown || events.find(e => e.card?.ask)?.card.q || '', instructions: calls.task?.instructions || '', cards: events.filter(e => e.type === 'card').map(e => e.card.type), options: events.filter(e => e.card?.ask || e.card?.type === 'connect').flatMap(e => [e.card.q, e.card.note, ...(e.card.options || []).map(o => o.label || o)]).filter(Boolean), linked, prices, learn: events.filter(e => e.type === 'card' && e.card.type === 'learn').map(e => e.card), sources: final?.sources || [], present: events.filter(e => e.type === 'card' && e.card.type === 'present').map(e => e.card), cardItems: events.flatMap(e => e.type === 'card' ? (e.card.items?.length ? e.card.items : e.card.rows || []) : []), searched: (calls.fns || []).includes('web_search'),
    ms: Date.now() - started, firstTokenMs: timing.firstTokenMs ?? null, openings: timing.openings || 0,
    // First text or card on screen; a card that streams counts from its first part.
    firstVisibleMs: events.find(e => (['message_delta', 'message'].includes(e.type) && String(e.delta || e.text || '').trim()) || e.type === 'card' || e.type === 'card_delta')?._t ?? null,
    firstCardMs: events.find(e => e.type === 'card' || e.type === 'card_delta')?._t ?? null,
    modelCalls: calls.model, input: calls.input, cached: calls.cached, output: calls.output, fns: calls.fns || [], args: calls.args || [], rounds: calls.rounds || [], error };
  const problems = [];
  if (error) problems.push(`error: ${error}`);
  if (c.expect !== 'any' && route !== c.expect && !((c.expect === 'answer' || c.allowAsk) && route === 'ask')) problems.push(`route ${route}, expected ${c.expect}${route !== 'task' ? `: ${[result.text, ...result.options].join(' | ').slice(0, 200)}` : ''}`);
  if (/could not complete that answer/i.test(result.text)) problems.push('gave up');
  // Every answer is written: a card comes with words of its own, never alone or with filler.
  if (route === 'answer' && !result.cards.includes('connect') && (!result.text.trim() || /^(?:here it is|här är den|sure|okay|ok)[.!]?$/i.test(result.text.trim()))) problems.push(`no real text with the answer: ${JSON.stringify(result.text)}`);
  if (result.output > 3000 || result.ms > 20000) problems.push(`runaway: ${result.output} output tokens in ${result.ms}ms`);
  // An answer continued after a lookup does not say the same thing twice, or announce the lookup.
  const said = result.text.split(/(?<=[.!?])\s+/).map(x => x.trim().toLowerCase()).filter(x => x.length > 40);
  if (new Set(said).size < said.length) problems.push(`repeats itself: ${result.text.slice(0, 200)}`);
  if (result.openings && /\b(let me (check|look)|i(?:'|’)ll (check|look))\b/i.test(result.text)) problems.push(`filler in the answer: ${result.text.slice(0, 200)}`);
  if (route === 'task' && !result.instructions.trim()) problems.push('task started without a brief');
  // The message confirming a task follows the owner's language, not their Swedish time zone or prices.
  const asked = [c.prompt, ...(c.interrupt || [])].join(' ');
  // Place names (Södermalm) are capitalised and are not Swedish prose.
  if (route === 'task' && !/[åäö]|\b(jag|och|min|mitt|mina|kolla|hitta)\b/i.test(asked) && /[åäö]|\b(jag|och|för|att)\b/i.test(result.text.replace(/\p{Lu}[\p{L}-]*/gu, ''))) problems.push(`task reply in the wrong language: ${result.text.slice(0, 160)}`);
  // A dead end: the agent refuses work its tasks can do, or sends the owner to do it. Saying
  // what a connection cannot reach is honest, not a dead end, when it offers what remains.
  if (!c.honest && /\b(can[’']?t|cannot|unable to|not able to|don[’']?t have (?:access|a live))\b[^.]{0,40}\b(open|verify|access|browse|visit|check|see|clock|tell|find)\b|\b(paste (?:it|the|this|that|them|here|in)|check your (?:device|phone))\b/i.test(result.text)) problems.push(`dead end: ${result.text.slice(0, 200)}`);
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
  const median = (k, keep = () => true) => { const v = results.filter(keep).map(r => r[k]).filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const carded = (r) => r.cards.some(t => t !== 'task');
  const summary = {
    server: serverDir, model: foundry.MODEL_DEFAULT, effort: foundry.CHAT_REASONING_EFFORT,
    passed: `${results.filter(r => r.pass).length}/${results.length}`,
    p50ms: pct(0.5), p90ms: pct(0.9), answerP50ms: answered[Math.floor(answered.length / 2)] ?? null,
    firstVisibleP50ms: median('firstVisibleMs'), cardRepliesP50ms: median('ms', carded), firstCardP50ms: median('firstCardMs', carded),
    // How often an answer comes with a card; the rest are text only.
    answersWithCard: `${results.filter(r => r.route === 'answer' && r.cards.some(t => t === 'present' || t === 'learn')).length}/${results.filter(r => r.route === 'answer').length}`,
    // Answers from a lookup that show where they came from.
    lookupAnswersWithSources: `${results.filter(r => r.route === 'answer' && r.searched && r.sources.length).length}/${results.filter(r => r.route === 'answer' && r.searched).length}`,
    // Lookup answers whose start was on screen while the lookup ran, and when their first words came.
    lookupAnswersStartedEarly: `${results.filter(r => r.route === 'answer' && r.searched && r.openings).length}/${results.filter(r => r.route === 'answer' && r.searched).length}`,
    lookupFirstVisibleP50ms: median('firstVisibleMs', r => r.route === 'answer' && r.searched), lookupAnswerP50ms: median('ms', r => r.route === 'answer' && r.searched),
    avgInput: Math.round(sum('input') / results.length), avgCached: Math.round(sum('cached') / results.length), avgOutput: Math.round(sum('output') / results.length),
    avgModelCalls: +(sum('modelCalls') / results.length).toFixed(2),
  };
  console.log(JSON.stringify(summary, null, 2));
  const out = flag('out', '');
  if (out) require('node:fs').writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
