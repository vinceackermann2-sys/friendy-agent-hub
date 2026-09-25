/* Product facts the agent reads on demand (read_doc) instead of carrying them in
   every system prompt. Keep each page short, factual and in sync with the code it
   cites; the index line is what the model sees before it decides to read. */
const DOCS = {
  capabilities: {
    title: 'What the agent can do',
    text: `Chat answers questions, writes, explains, does quick lookups (web search, the agent's own mailbox, Shop Pay status and orders, automations, which apps are connected), manages goals and library files, and saves memory.
Tasks run in the background on the agent's own computer: a real browser (open sites, click, fill forms), a shell for code, the owner's connected apps (Gmail, Calendar, Slack, GitHub, Notion and more), Shop Pay purchases, image generation, pages and documents. The owner can keep chatting while a task works; a task can be steered or stopped from the chat.
Approval is always asked before anything that sends, buys, books, posts, deletes or changes an account.
The agent cannot make phone calls or send SMS, and never types passwords or card numbers it can see; saved secrets are filled from the vault without being shown.`,
  },
  approvals: {
    title: 'Approvals and permissions',
    text: `Settings > Browser has two modes for websites and for connected apps: "Ask for some" (default) and "Always ask".
Websites: with "Ask for some", web searches and pages on sites the agent has already visited run without asking; a new site, and any click or typing on a page, asks first. "Always ask" asks for every web step.
Connected apps: with "Ask for some", listing apps and reading data in them (mail, calendar, files, messages) runs without asking; every write (send, create, change, delete) asks first. "Always ask" asks for everything, reads included.
Final steps that buy, pay, book, send, post, delete or change account settings always need a one-time approval that shows the exact action. Approvals never carry over to a later action.`,
  },
  billing: {
    title: 'Plans, tokens and billing',
    text: `Usage is measured in tokens. Free: 50 million tokens a month, 5 images and 10 voice transcriptions a day, no card. Pro: $50/month, 100 million tokens, 10 images and 15 transcriptions a day. Max: $100/month, 200 million tokens, 15 images and 20 transcriptions a day.
Monthly tokens reset at the start of each billing period. Token packs (10M for $15 up to 500M for $500) add tokens that never expire.
Upgrade under Billing; buy token packs under Usage. A referral gives the owner and the friend 10 million tokens each, once per friend.
When tokens run out the agent stops working until the allowance resets or a pack is added.`,
  },
  'connected-apps': {
    title: 'Connected apps',
    text: `Apps connect with secure OAuth from the Apps page, or from a connect card the agent shows in chat. The agent never asks for app passwords.
Once connected, tasks can read and act in the app within the approval rules (see approvals). The chat can tell which apps are connected; reading or acting inside an app happens in a task, which asks the owner before any write.
Disconnect an app on the Apps page to remove the agent's access to it.`,
  },
  mailbox: {
    title: "The agent's own mailbox",
    text: `The agent has its own email address on mail.belna.se (mail_status shows it). It can receive mail there, and send up to 40 emails a day after the owner approves each one.
This is separate from the owner's own email; the owner's Gmail or Outlook is a connected app.`,
  },
  'privacy-and-credentials': {
    title: 'Privacy, credentials and the vault',
    text: `Passwords, card numbers, API keys and one-time codes are never typed into chat. The agent asks for them with a secure vault request; the owner saves them in Settings, and the agent uses them only by reference (sec_••••) with approval, without seeing the value.
For website purchases the agent uses a card already saved in the merchant account and shows only masked details.
Each account's chats, memory, files and tasks are private to that account.`,
  },
  'memory-and-files': {
    title: 'Memory, agent files and the library',
    text: `The agent remembers durable facts, preferences and corrections: stable facts about the owner (USER.md), long-term facts (MEMORY.md) and daily notes. The owner can say "remember ..." or "forget ...", and can view and edit memory under Settings > Memory.
Agent files shape how the agent works: IDENTITY.md (name and character), SOUL.md (persona), USER.md (who the owner is), AGENTS.md (working lessons). They are editable in the Library.
Files the agent creates, and files the owner uploads, collect in the Library.
Between conversations the agent tidies memory hourly and reflects nightly on what worked, updating its files when the owner has given a lasting preference.`,
  },
  automations: {
    title: 'Automations and reminders',
    text: `The agent can run work on a schedule (every 5 minutes up to every 30 days), when a connected app reports an event, or after another automation finishes. Scheduled runs are checks, not live watchers: timing can drift by a few minutes.
Results arrive in the automation's own chat. The owner can pause, edit or delete automations at any time; creating one asks for approval.`,
  },
};

const DOC_INDEX = Object.entries(DOCS).map(([id, doc]) => `${id}: ${doc.title}`).join('; ');

const READ_DOC_SCHEMA = {
  name: 'read_doc',
  description: `Read a short product page before answering how the app works, what it costs, what needs approval, or what you can do. Pages: ${DOC_INDEX}.`,
  parameters: { type: 'object', properties: { page: { type: 'string', enum: Object.keys(DOCS) } }, required: ['page'] },
};

function readDoc(page) {
  const doc = DOCS[String(page || '')];
  if (!doc) return { error: `Unknown page. Pages: ${Object.keys(DOCS).join(', ')}` };
  return { page, title: doc.title, text: doc.text };
}

const READ_DOC_TOOL = { name: 'read_doc', type: 'function', approval: false, run: async ({ page }) => readDoc(page) };

module.exports = { DOCS, DOC_INDEX, READ_DOC_SCHEMA, READ_DOC_TOOL, readDoc };
