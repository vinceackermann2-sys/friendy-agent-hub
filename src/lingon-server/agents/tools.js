/* Tool registry — Agents API shape adapted to our stack.
   Each tool: { name, type, description, approval, run(args, ctx) }.
   - Tool search: pickTools(task) loads only relevant definitions (saves tokens).
   - Programmatic calling: runParallel executes independent calls concurrently.
   ctx: { userId, sessionId, trace (push fn), signal }
*/
import { fetchAllowlisted } from './sandbox.js';
import { entry } from './tracing.js';
import { hostAllowed } from './sandbox.js';
import * as store from '../store.js';
import { normalizeSubAgent, nextRunAt } from './triggers.js';
import * as composio from '../composio.js';
import * as privy from '../privy.js';
import * as mail from '../mail.js';
import { execInSandbox, isAzureConfigured } from './azure-vm.js';

const TOOLS = {
  web_search: {
    name: 'web_search', type: 'web_search', approval: false,
    description: 'Live fetch of allowlisted public sources (HN, DuckDuckGo, Wikipedia).',
    run: async ({ urls }, ctx) => {
      return Promise.all(urls.slice(0, 4).map(async (u) => {
        const t0 = Date.now();
        try {
          const r = await fetchAllowlisted(u, { signal: ctx.signal });
          const text = (await r.text()).slice(0, 12000);
          ctx.trace(entry('globe', `web_search: ${new URL(u).hostname} · ${Date.now() - t0}ms`));
          return { url: u, ok: true, text };
        } catch (e) {
          ctx.trace(entry('alert', `web_search failed: ${e.message}`));
          return { url: u, ok: false, error: e.message };
        }
      }));
    },
  },
  github_prs: {
    name: 'github_prs', type: 'function', approval: true,
    description: 'Read-only list of recent repos + open PRs using the user PAT.',
    run: async (_, ctx) => {
      if (!ctx.githubPat) throw Object.assign(new Error('GitHub token required.'), { code: 'NO_PAT' });
      const gh = async (url, accept = 'application/vnd.github+json') => {
        const r = await fetchAllowlisted(url, { headers: { Authorization: `Bearer ${ctx.githubPat}`, Accept: accept }, signal: ctx.signal });
        if (!r.ok) throw new Error(`GitHub ${r.status}`);
        return accept.includes('diff') ? r.text() : r.json();
      };
      const repos = await gh('https://api.github.com/user/repos?per_page=10&sort=updated');
      const prs = [];
      await Promise.all(repos.slice(0, 5).map(async (repo) => {
        try {
          const list = await gh(`https://api.github.com/repos/${repo.full_name}/pulls?state=open&per_page=5`);
          for (const pr of list) prs.push({ repo: repo.full_name, number: pr.number, title: pr.title, url: pr.html_url, user: pr.user?.login });
        } catch {}
      }));
      ctx.trace(entry('git', `github_prs: ${repos.length} repos, ${prs.length} open PRs (read-only)`));
      return { repos: repos.map((r) => r.full_name), prs };
    },
  },
  composio_apps: {
    name: 'composio_apps', type: 'function', approval: false,
    description: 'List the user’s Composio-connected apps.',
    run: async (_, ctx) => {
      const connected = await composio.listConnected(ctx.userId);
      const active = connected.filter((c) => String(c.status).toUpperCase() === 'ACTIVE');
      ctx.trace(entry('box', `composio_apps: ${active.length} connected`));
      return active;
    },
  },
  composio_execute: {
    name: 'composio_execute', type: 'function', approval: true,
    description: 'Run a Composio tool on behalf of the user via their connected app.',
    run: async ({ tool, args, connectedAccountId }, ctx) => {
      const slug = String(tool || '').toUpperCase().trim();
      if (!/^[A-Z0-9_]+$/.test(slug)) throw Object.assign(new Error('Valid tool slug required.'), { code: 'BAD_INPUT' });
      const out = await composio.executeTool(ctx.userId, { tool: slug, args: args || {}, connectedAccountId });
      if (out && out.successful === false) throw new Error(String(out.error || 'App action failed.').slice(0, 400));
      ctx.trace(entry('box', `composio_execute: ${slug} done`));
      return out.data || out;
    },
  },
  github_diff: {
    name: 'github_diff', type: 'function', approval: true,
    description: 'Read-only fetch of a single PR diff.',
    run: async ({ repo, number }, ctx) => {
      if (!ctx.githubPat) throw Object.assign(new Error('GitHub token required.'), { code: 'NO_PAT' });
      const r = await fetchAllowlisted(`https://api.github.com/repos/${repo}/pulls/${number}`, {
        headers: { Authorization: `Bearer ${ctx.githubPat}`, Accept: 'application/vnd.github.diff' }, signal: ctx.signal,
      });
      const diff = (await r.text()).slice(0, 30000);
      ctx.trace(entry('git', `github_diff: ${repo}#${number} (${diff.length} chars)`));
      return { diff };
    },
  },
  shell: {
    name: 'shell', type: 'code', approval: false,
    description: 'Run a bash command in the user Azure VM workspace. Files persist on the VM disk.',
    run: async ({ command }, ctx) => {
      const out = await execInSandbox(ctx.userId, 'shell', { command }, { alreadyRunning: ctx.vmReady === true, taskId: ctx.taskId });
      ctx.trace(entry('term', `shell: exit on ${out.vmName}`));
      return out;
    },
  },
  computer_screenshot: {
    name: 'computer_screenshot', type: 'browser', approval: false,
    description: 'Screenshot a page in the user Azure VM browser.',
    run: async ({ url }, ctx) => {
      const u = String(url || '');
      if (!hostAllowed(u)) throw Object.assign(new Error('host blocked by sandbox allowlist'), { code: 'HOST_BLOCKED' });
      const out = await execInSandbox(ctx.userId, 'computer_screenshot', { url: u, sessionId: ctx.sessionId }, { alreadyRunning: ctx.vmReady === true, taskId: ctx.taskId });
      ctx.trace(entry('globe', `computer_screenshot: ${new URL(u).hostname}`));
      return out;
    },
  },
  browser_open: {
    name: 'browser_open', type: 'browser', approval: false,
    description: 'Open one allowlisted URL in the user Azure VM browser.',
    run: async ({ url }, ctx) => {
      const u = String(url || '');
      if (!hostAllowed(u)) throw Object.assign(new Error('host blocked by sandbox allowlist'), { code: 'HOST_BLOCKED' });
      if (ctx.signal?.aborted) throw Object.assign(new Error('Task interrupted'), { name: 'AbortError' });
      if (!isAzureConfigured()) throw Object.assign(new Error('browser tool unavailable until Azure VM is configured'), { code: 'DISABLED' });
      const out = await execInSandbox(ctx.userId, 'browser_open', { url: u, sessionId: ctx.sessionId }, { alreadyRunning: ctx.vmReady === true, taskId: ctx.taskId });
      ctx.trace(entry('globe', `browser_open: ${new URL(u).hostname} on ${out.vmName}`));
      return out;
    },
  },
  browser_action: {
    name: 'browser_action', type: 'browser', approval: false,
    description: 'Click or scroll the current Azure VM browser page.',
    run: async (args, ctx) => {
      const type = String(args.type || '');
      if (!['click', 'click_text', 'scroll'].includes(type)) throw Object.assign(new Error('Unsupported browser action.'), { code: 'BAD_INPUT' });
      const event = { type };
      if (type === 'click') {
        if (!Number.isFinite(args.x) || !Number.isFinite(args.y) || args.x < 0 || args.x > 1280 || args.y < 0 || args.y > 900) throw Object.assign(new Error('Click coordinates must be inside the browser viewport.'), { code: 'BAD_INPUT' });
        event.x = args.x; event.y = args.y;
      } else if (type === 'scroll') {
        if (!Number.isFinite(args.dy) || Math.abs(args.dy) > 3000) throw Object.assign(new Error('Invalid scroll distance.'), { code: 'BAD_INPUT' });
        event.dy = args.dy;
      } else if (type === 'click_text') {
        event.text = String(args.text || '').slice(0, 200);
        if (!event.text) throw Object.assign(new Error('Browser action text required.'), { code: 'BAD_INPUT' });
      }
      const out = await execInSandbox(ctx.userId, 'browser_action', { event, sessionId: ctx.sessionId }, { alreadyRunning: ctx.vmReady === true, taskId: ctx.taskId });
      ctx.trace(entry('globe', `browser_action: ${type} on ${out.vmName}`));
      return out;
    },
  },
  code_run: {
    name: 'code_run', type: 'code', approval: false,
    description: 'Execute js/python/bash ONLY inside the user Azure VM via Run Command. Disabled without Azure.',
    run: async (args, ctx) => {
      const out = await execInSandbox(ctx.userId, 'code_run', args, { alreadyRunning: ctx.vmReady === true, taskId: ctx.taskId });
      ctx.trace(entry('code', `code_run: ${out.language} on ${out.vmName}`));
      return out;
    },
  },
  build_page: {
    name: 'build_page', type: 'function', approval: false,
    description: 'Generate a single-file HTML page via the model (sandboxed preview).',
    run: async ({ html }, ctx) => {
      ctx.trace(entry('code', `build_page: ${String(html || '').length} chars (sandboxed iframe)`));
      return { html: String(html || '').slice(0, 60000) };
    },
  },
  memory_write: {
    name: 'memory_write', type: 'function', approval: false,
    description: 'Persist a user-scoped memory.',
    run: async ({ text, src }, ctx) => {
      const m = await store.addMemory(ctx.userId, String(text).slice(0, 2000), src || 'agent');
      ctx.trace(entry('book', `memory_write: saved (${String(text).slice(0, 60)}…)`));
      return m;
    },
  },
  history_search: {
    name: 'history_search', type: 'function', approval: false,
    description: 'Keyword search over the user\'s own past chat turns (transcripts).',
    run: async ({ query }, ctx) => {
      const turns = await store.searchTurns(ctx.userId, String(query || '').slice(0, 200));
      ctx.trace(entry('file', `history_search: ${turns.length} past turns matched`));
      return turns.map((t) => ({ role: t.role, text: String(t.text).slice(0, 600) }));
    },
  },
  canvas_show: {
    name: 'canvas_show', type: 'function', approval: false,
    description: 'Present a card or text file in the user Canvas.',
    run: async ({ title, format, content }, ctx) => {
      const allowed = new Set(['text','md','json','csv','html','svg','code']);
      const out = { title:String(title || 'Canvas item').slice(0,120), format:allowed.has(format) ? format : 'text', content:String(content || '').slice(0,60000) };
      ctx.trace(entry('board', `canvas_show: ${out.title}`));
      return out;
    },
  },
  trigger_list: {
    name: 'trigger_list', type: 'function', approval: false,
    description: 'List the user’s schedule, connected-app, and sub-agent watchers.',
    run: async (_, ctx) => {
      const agents = await store.listSubAgents(ctx.userId);
      ctx.trace(entry('clock', `trigger_list: ${agents.length} automation watchers`));
      return agents.map(({ id, name, enabled, trigger, lastStatus, nextRunAt }) => ({ id, name, enabled, trigger, lastStatus, nextRunAt }));
    },
  },
  wallet_status: {
    name: 'wallet_status', type: 'function', approval: false,
    description: 'Read this account’s agent wallet address, balances, attached card status (last4 only), and remaining daily spend. Never invent numbers.',
    run: async (_, ctx) => {
      const snap = await privy.agentStatus(ctx.userId);
      ctx.trace(entry('wallet', `wallet_status: ${snap.address ? 'ready' : 'missing'}`));
      return snap;
    },
  },
  wallet_transfer: {
    name: 'wallet_transfer', type: 'function', approval: true,
    description: 'Send USDC or ETH from the agent wallet. REQUIRES owner approval. Never send without an explicit destination and amount.',
    run: async ({ to, amount, asset }, ctx) => {
      const out = await privy.transfer(ctx.userId, { to, amount, asset: asset || 'usdc', confirm: true });
      ctx.trace(entry('wallet', `wallet_transfer: ${out.asset} ${out.amount} sent`));
      return { status: out.status, asset: out.asset, amount: out.amount, to: String(out.to).slice(0, 6) + '…' + String(out.to).slice(-4), hash: out.hash };
    },
  },
  wallet_purchase: {
    name: 'wallet_purchase', type: 'function', approval: true,
    description: 'Ask the owner to approve a purchase. method=card authorizes a matching charge without revealing the card number. method=wallet sends USDC to to=. REQUIRES owner approval.',
    run: async ({ amount, merchant, reason, method, to }, ctx) => {
      const out = await privy.purchase(ctx.userId, { amount, merchant, reason, method, to, confirm: true });
      ctx.trace(entry('wallet', `wallet_purchase: ${out.method} ${out.amount} ${out.merchant} ${out.status}`));
      return out;
    },
  },
  mail_status: {
    name: 'mail_status', type: 'function', approval: false,
    description: 'Read this agent’s own mailbox address, unread count, and whether sending is ready. Never invent the address.',
    run: async ({ agent_name }, ctx) => {
      const snap = await mail.agentStatus(ctx.userId, agent_name);
      ctx.trace(entry('mail', `mail_status: ${snap.address || 'missing'}`));
      return snap;
    },
  },
  mail_list: {
    name: 'mail_list', type: 'function', approval: false,
    description: 'List recent messages in this agent’s own inbox or sent folder. Never invent emails.',
    run: async ({ folder, limit }, ctx) => {
      const rows = await mail.agentList(ctx.userId, { folder: folder === 'sent' ? 'sent' : 'inbox', limit });
      ctx.trace(entry('mail', `mail_list: ${rows.length} ${folder || 'inbox'}`));
      return rows;
    },
  },
  mail_read: {
    name: 'mail_read', type: 'function', approval: false,
    description: 'Read one message from this agent’s mailbox by id. Marks inbound mail read.',
    run: async ({ id }, ctx) => {
      const msg = await mail.readMessage(ctx.userId, String(id || ''));
      ctx.trace(entry('mail', `mail_read: ${msg.subject}`));
      return msg;
    },
  },
  mail_draft: {
    name: 'mail_draft', type: 'function', approval: false,
    description: 'Save a draft in this agent’s mailbox. Does not send.',
    run: async ({ to, subject, body, id }, ctx) => {
      const draft = await mail.saveDraft(ctx.userId, { to, subject, body, id });
      ctx.trace(entry('mail', `mail_draft: ${draft.subject}`));
      return draft;
    },
  },
  mail_send: {
    name: 'mail_send', type: 'function', approval: true,
    description: 'Send email from this agent’s own mailbox (name@mail.belna.se). REQUIRES owner approval of exact to/subject/body.',
    run: async ({ to, subject, body, in_reply_to, agent_name }, ctx) => {
      const out = await mail.send(ctx.userId, { to, subject, body, inReplyTo: in_reply_to, agentName: agent_name, confirm: true });
      ctx.trace(entry('mail', `mail_send: ${out.subject} → ${(out.to || []).join(', ')}`));
      return { id: out.id, to: out.to, subject: out.subject, from: out.from };
    },
  },
  trigger_create: {
    name: 'trigger_create', type: 'function', approval: true,
    description: 'Create an isolated automation chat with a schedule, connected-app, or sub-agent trigger.',
    run: async (args, ctx) => {
      const input = normalizeSubAgent(args || {});
      const existing = await store.listSubAgents(ctx.userId);
      if (existing.length >= 25) throw Object.assign(new Error('Sub-agent limit reached.'), { code: 'BAD_INPUT' });
      if (input.trigger.type === 'subagent' && !existing.some((agent) => agent.id === input.trigger.sourceAgentId)) throw Object.assign(new Error('Source sub-agent not found.'), { code: 'BAD_INPUT' });
      if (input.trigger.type === 'app') {
        const ok = await composio.isToolkitConnected(ctx.userId, input.trigger.app);
        if (!ok) throw Object.assign(new Error('Connected app required — connect it under Apps first.'), { code: 'BAD_INPUT' });
      }
      const agent = await store.createSubAgent(ctx.userId, input, nextRunAt(input.trigger));
      ctx.trace(entry('clock', `trigger_create: ${agent.name}`));
      return agent;
    },
  },
};

// Tool search: load only relevant definitions for the task (token saving).
function pickTools(task) {
  const t = String(task || '').toLowerCase();
  const names = new Set(['memory_write']);
  if (/(research|investigat|social|poll|sentiment|news|search|find)/.test(t)) names.add('web_search');
  if (/(gmail|slack|calendar|notion|drive|sheet|github|\bpr\b|pull request|repo|diff|code review|tweet|linkedin|hubspot|stripe|task|issue|ticket)/.test(t)) { names.add('composio_apps'); names.add('composio_execute'); }
  if (/(email|e-mail|inbox|mailbox|mail |reply to|send (a |an )?mail|skriv (ett )?mejl|mejl)/.test(t)) { names.add('mail_status'); names.add('mail_list'); names.add('mail_read'); names.add('mail_draft'); names.add('mail_send'); }
  if (/(build|landing|page|site|website|dashboard)/.test(t)) names.add('build_page');
  if (/(earlier|yesterday|last (week|time|chat)|we (talked|discussed)|discussed|previous)/.test(t)) names.add('history_search');
  if (/(trigger|watch|schedule|recurring|every (?:hour|day|week)|sub.?agent|automation)/.test(t)) { names.add('trigger_list'); names.add('trigger_create'); }
  if (/(wallet|pay|payment|transfer|usdc|\beth\b|invoice|payout|spend|debit card|virtual card|buy |purchase)/.test(t)) { names.add('wallet_status'); names.add('wallet_transfer'); names.add('wallet_purchase'); }
  if (names.size === 1) names.add('web_search'); // default research capability
  return [...names].map((n) => TOOLS[n]);
}

async function runParallel(calls, ctx) {
  return Promise.all(calls.map((c) => TOOLS[c.tool].run(c.args || {}, ctx)));
}

export { TOOLS, pickTools, runParallel };
