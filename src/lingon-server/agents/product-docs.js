/* Product facts the agent reads on demand (read_doc) instead of carrying them in
   every system prompt. Keep each page short, factual and in sync with the code it
   cites; the index line is what the model sees before it decides to read. */
const DOCS = {
  wallet: {
    title:'Belna Wallet and payment methods',
    text:`The Wallet tab in the right-side panel shows Belna Wallet: the owner's balance, money actions, activity and the card waitlist. Its Payment methods button opens Settings → Wallet, where the owner's own payment methods (cards saved in stores, payment apps such as Klarna, Swish, PayPal, Afterpay and Sezzle, and Shop Pay) are switched on or off; they are charged to the owner's own accounts and never spend the Belna balance. There is no separate Payments tab. The human owner owns the account, card and balance, completes identity verification, can pause spending and approves payments. Availability depends on server setup, country and provider approval. Amounts are displayed in dollars; no crypto knowledge is required in Belna.
Settings → Wallet manages Belna Wallet and its card controls, the card waitlist, each of the owner's own payment methods (each has an on/off switch and starts off), Shop Pay, payment logins and delivery addresses. wallet_status.paymentSelection.methods reports which methods are on (saved_card, payment_apps, shop_pay, belna_wallet); the server refuses a purchase with a method that is off. Never turn a method on for the owner or claim one is on. Turning on cards saved in stores does not prove the store is signed in. Belna Wallet shows the balance, money on the way, Add money, Send, Withdraw, card setup steps and activity. Withdraw opens the payment partner’s bank withdrawal for the owner only when wallet_status.wallet.withdrawalsAvailable is true. The agent never withdraws or deposits money. A one-time virtual card is created only for an approved Belna Wallet purchase. Connect card starts the human owner's card application; native issuer approval must be verified. shipping_addresses reads the saved default delivery address; include its id and formatted value in purchase details. The owner manages addresses in Wallet settings even without a Belna Wallet.
Paying yourself: the owner approves every payment on their own phone and Belna never sees card or bank details. In Shopify stores the agent prepares the checkout with shop_checkout and the owner opens it from the checkout card in the chat, then pays on the store's own checkout with any method it offers (Swish, Klarna, PayPal, card). In other stores, with payment apps on, the agent fills the cart and delivery, selects a payment app the store offers (Klarna, Swish, PayPal, Afterpay, Sezzle and similar) and places the order after the owner approves the order card; the owner then approves the payment in that app, with BankID or by signing in. Apple Pay and Google Pay need the owner's own device and are not used. If the checkout shows a QR code, the owner scans it from the live browser. Swish, Klarna and PayPal are the store's methods, not Belna integrations, and not every store offers them. When a store only takes typed card details, the owner finishes it on their own device. A placed order is confirmed by the store's receipt, not by the agent.
wallet_set_limit changes the daily spending allowance only after explicit approval of the exact new limit. Never raise it silently or remove purchase approvals. wallet_pause pauses card spending at once when the owner asks to freeze or pause the card, and cancels purchase cards still waiting; resuming needs the owner’s approval.
wallet_status reads actual balance and activity. Earning and payment-link creation are unavailable. wallet_send transfers USD between connected Whop wallet accounts after approval. Both people must already have Belna Wallets; the recipient’s confirmed Belna sign-in email resolves their wallet account ID. An email is not a destination Whop accepts directly. Arbitrary email addresses, standalone Whop users and crypto addresses are unsupported. Transfers run with a $50 transfer allowance per 24 hours, separate from the card limit. Payment partner fees may apply. Money and card credentials never go to the model. Check wallet_status.agentCardPayments before using browser_submit with payment.method=belna_wallet. When false, agent card checkout is not available yet; do not claim a purchase or bypass this restriction. The amount-limited purchase card backend uses the exact USD total, prevents duplicate submissions, and requests cancellation on the first transaction or after 15 minutes. Cancellation is asynchronous and is only confirmed when the issuer reports it. The separate private checkout service handles card entry; its browser and any bank verification belong only to the owner. A submitted checkout is not confirmed payment. Tell the owner to open Wallet when a bank verification is required. Unsupported or changed checkouts require owner assistance; never retry an unknown payment outcome.
Existing card uses Shop Pay or a card already saved in a merchant account for approved purchases. The model never sees the number or security code. This option cannot receive wallet transfers or hold an agent balance. Both wallet types can be available together.
Wallet setup, identity verification, deposits and bank withdrawals are completed by the owner in the Wallet panel. Hosted verification and payment pages belong to the payment partner and may show its required branding.`,
  },
  capabilities: {
    title: 'What the agent can do',
    text: `Chat answers questions, writes, explains, does quick lookups (web search, the agent's own mailbox, Shop Pay status and orders, automations, which apps are connected), manages goals and library files, and saves memory.
Tasks run in the background on the agent's own computer: a real browser (open sites, click, fill forms), a shell for code, the owner's connected apps (Gmail, Calendar, Slack, GitHub, Notion and more) and their own APIs and MCP servers, Shop Pay purchases, image generation, pages and documents. The owner can keep chatting while a task works; a task can be steered or stopped from the chat.
Approval is always asked before anything that sends, buys, books, posts, deletes or changes an account.
The agent cannot make phone calls or send SMS, and never types passwords or card numbers it can see; saved secrets are filled from the vault without being shown.`,
  },
  approvals: {
    title: 'Approvals and permissions',
    text: `Settings > Browser has two modes for websites and for connected apps: "Ask for some" (default) and "Always ask".
Websites: with "Ask for some" (the default), web searches and using any public page (opening, reading, clicking, typing) run without asking; signing in with a saved login and the final step that buys, pays, books, sends, posts or deletes ask first. "Always ask" asks for every web step.
Connected apps: with "Ask for some", listing apps and reading data in them (mail, calendar, files, messages) runs without asking; every write (send, create, change, delete) asks first. "Always ask" asks for everything, reads included. The owner's own APIs and MCP servers follow the same setting: GET requests and read-only tools are reads; other requests and tools ask first.
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
Disconnect an app on the Apps page to remove the agent's access to it.
The agent can also add the owner's own connectors: a remote MCP server or a REST API. The owner asks in chat; a task finds the address and sign-in in the service's docs, and the owner pastes the key into a secure card in chat. The key is encrypted in the vault and never shown to the agent. There is no form for adding one by hand: the agent sets it up. Each connector shows as connected with its tools or HTTP methods as permissions the owner can turn off; removing it deletes its key. MCP servers must be reachable over https with a token or no sign-in; servers that allow only browser sign-in (OAuth) or run only on the owner's own computer (stdio) cannot be added yet.`,
  },
  mailbox: {
    title: "The agent's own mailbox",
    text: `The agent has its own email address on mail.belna.se (mail_status shows it). It can receive mail there, and send up to 40 emails a day after the owner approves each one.
This is separate from the owner's own email; the owner's Gmail or Outlook is a connected app.`,
  },
  'privacy-and-credentials': {
    title: 'Privacy, credentials and the vault',
    text: `Passwords, API keys and one-time codes are never typed into chat. The agent asks for logins and keys with a secure vault request: a card in chat where the owner types the value, which is encrypted straight into the vault. To save a login, an API key or any other credential, or to connect an API or MCP server, the owner just asks in chat; Settings > Secrets has no form for adding them, only the saved list, where the owner can reveal or delete each one. The agent uses them only by reference (sec_••••) with approval, without seeing the value.
Card details are never saved in Belna, not even masked. For website purchases the agent signs in to the merchant and pays with Shop Pay or a card the owner already saved in that merchant account; the owner approves each order first.
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
The owner describes what they want done and when in chat. The agent works out the setup and creates the automation with trigger_create after approval. There is no manual creation form; never ask the owner to configure triggers or schedules in the Automations panel.
Results arrive in the automation's own chat. The Automations panel lets the owner view, run, pause, enable or delete existing automations.`,
  },
};

const DOC_INDEX = Object.entries(DOCS).map(([id, doc]) => `${id}: ${doc.title}`).join('; ');

const READ_DOC_SCHEMA = {
  name: 'read_doc',
  description: `Read a short product page before answering how the app works, what it costs or what needs approval. Pages: ${DOC_INDEX}.`,
  parameters: { type: 'object', properties: { page: { type: 'string', enum: Object.keys(DOCS) } }, required: ['page'] },
};

function readDoc(page) {
  const doc = DOCS[String(page || '')];
  if (!doc) return { error: `Unknown page. Pages: ${Object.keys(DOCS).join(', ')}` };
  return { page, title: doc.title, text: doc.text };
}

const READ_DOC_TOOL = { name: 'read_doc', type: 'function', approval: false, run: async ({ page }) => readDoc(page) };

export { DOCS, DOC_INDEX, READ_DOC_SCHEMA, READ_DOC_TOOL, readDoc };
