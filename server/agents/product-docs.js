/* Product facts the agent reads on demand (read_doc) instead of carrying them in
   every system prompt. Keep each page short, factual and in sync with the code it
   cites; the index line is what the model sees before it decides to read. */
const DOCS = {
  wallet: {
    title:'Belna Wallet and payment methods',
    text:`The Wallet panel holds the owner's USDC on Base. Belna Wallet uses a user-owned Privy embedded wallet. Only the owner can authorize money movements; the app and agent have no delegated signer. Balances are USDC, a dollar-denominated stablecoin, not bank deposits. Never claim regulatory exemption, guaranteed yield or a completed transfer from a pending result.
wallet_status reads the actual available balance, activity, owner requests and Earn availability. wallet_send prepares an exact USDC request to a Base wallet address or a confirmed Belna email with an existing wallet. Owner approval in chat only creates an awaiting_owner request; it never transfers money. Tell the owner to open Wallet, review the recipient, amount and network, then authorize that request themselves. The rolling allowance is at most $50 through Belna. An uncertain outcome must be checked using the same request; never create a duplicate payment.
wallet_earn prepares an owner-requested deposit or withdrawal in the configured USDC vault. Check Earn availability first. Do not choose investments or allocate funds autonomously. The owner must accept the variable-yield, loss and withdrawal-delay risks and authorize each action in Wallet. Earn is unavailable until a reviewed production vault is configured. Payment-link creation remains unavailable.
Settings → Wallet shows the receive address, owner-only key export, daily allowance and pause controls. wallet_set_limit changes the allowance only after approval of the exact amount. wallet_pause stops new app requests immediately when asked; resuming requires approval. These controls do not freeze the user's wallet outside Belna or cancel submitted transactions. The owner creates the wallet and adds funds with Privy's modal. Withdraw means a EUR bank payout by SEPA through Bridge. wallet_bank_accounts reads verification status and masked linked bank IDs. wallet_withdraw prepares only an exact owner-requested withdrawal to a verified linked bank ID; chat approval never moves funds, and the owner must separately authorize in Wallet. The owner accepts Bridge terms, completes hosted identity verification, and links their own IBAN in Wallet. Never collect these details through chat. Bank receives EUR after conversion and fees; a Swedish bank may charge EUR/SEK conversion. A pending payout is not completed bank settlement. Funding availability, fees and identity checks depend on the provider and country.
Cards remain an Apply interest waitlist in Sweden. agentCardPayments is false; never use Belna Wallet for card checkout or claim a card has been issued. Existing Whop balances remain at the previous provider and are never silently migrated.
Payment methods opens Settings → Wallet. saved_card, payment_apps and shop_pay are the owner's own methods; each must be turned on by the owner and never spends the USDC balance. Turning on saved cards does not prove a merchant is signed in. In Shopify, shop_checkout prepares a checkout the owner pays on the store's page. For other payment apps (Klarna, Swish, PayPal, Afterpay or Sezzle), the owner approves the order and completes the bank or app payment. When a store requires typed card details, the owner finishes on their own device. Payment success needs a merchant receipt. shipping_addresses reads the default delivery address; include its id and formatted value in purchase details. Delivery addresses remain available without a wallet.`,
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

module.exports = { DOCS, DOC_INDEX, READ_DOC_SCHEMA, READ_DOC_TOOL, readDoc };
