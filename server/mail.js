/* Belna agent mail — one mailbox per account on mail.belna.se via Resend.
   Addresses are allocated locally (Resend inbound is catch-all). The agent
   may read its inbox; every send waits for owner approval. */
const crypto = require('crypto');
const store = require('./store');
const auth = require('./auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SEND_PER_DAY = 40;
const MAX_BODY = 20000;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const RESERVED = new Set([
  'hej', 'hello', 'hi', 'hey', 'info', 'kontakt', 'contact', 'support', 'help',
  'admin', 'root', 'postmaster', 'abuse', 'noreply', 'no-reply', 'mailer-daemon',
  'privacy', 'security', 'billing', 'team', 'api', 'www', 'mail', 'email',
  'belna', 'lingon', 'agent', 'dmarc', 'webmaster', 'hostmaster',
]);

function env(name, fallback = '') {
  return String(process.env[name] || process.env['LINGON_' + name] || fallback).trim();
}
function mailDomain() {
  return (env('MAIL_DOMAIN', 'mail.belna.se') || 'mail.belna.se').toLowerCase();
}
function apiKey() { return env('RESEND_API_KEY'); }
function webhookSecret() { return env('RESEND_WEBHOOK_SECRET'); }
function configured() { return apiKey().length > 8; }

function slugifyName(name) {
  const s = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return s.length >= 2 ? s : 'agent';
}
function isReserved(part) { return RESERVED.has(String(part || '').toLowerCase()); }
function addressFor(localPart) { return String(localPart || '').toLowerCase() + '@' + mailDomain(); }
function shortUserTag(userId) {
  return crypto.createHash('sha256').update(String(userId || '')).digest('hex').slice(0, 4);
}
function assertEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 160) {
    const e = new Error('Enter a valid email address.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  return email;
}
function parseRecipients(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,;]+/);
  const out = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean).map(assertEmail))];
  if (!out.length) {
    const e = new Error('At least one recipient is required.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (out.length > 10) {
    const e = new Error('At most 10 recipients.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  return out;
}
function parseAddressList(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  return list.map((item) => {
    if (typeof item === 'string') {
      const m = item.match(/^(.*)<([^>]+)>$/);
      if (m) return { name: m[1].replace(/["']/g, '').trim(), email: m[2].trim().toLowerCase() };
      return { name: '', email: item.trim().toLowerCase() };
    }
    return { name: String(item && (item.name || item.from_name) || ''), email: String(item && (item.email || item.address || item.from) || '').trim().toLowerCase() };
  }).filter((x) => x.email);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBodyHtml(bodyText) {
  return String(bodyText || '')
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 16px;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function mascotUrl(color) {
  const safe = ['lingon','blueberry','moss','sun','rose'].includes(color) ? color : 'lingon';
  return `https://belna.se/lingon/mascot/email-${safe}.png`;
}

// Agent mail should read like a note from a person: no banner, card or
// "automated message" framing. Belna shows up only in a small signature,
// which still says plainly that the sender is an AI agent.
function brandEmailHtml({ bodyText, agentName, agentAddress, agentColor, personalCheckIn = false } = {}) {
  const name = escapeHtml(String(agentName || '').trim() || 'Your agent');
  const address = escapeHtml(String(agentAddress || '').trim());
  const content = renderBodyHtml(bodyText);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#FFFFFF;">
  <div style="max-width:600px;padding:8px 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1F2023;-webkit-text-size-adjust:100%;">
    ${content}
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;">
      <tr>
        <td style="vertical-align:top;padding-right:12px;"><img src="${mascotUrl(agentColor)}" width="40" height="40" alt="" style="display:block;border:0;width:40px;height:40px;"></td>
        <td style="vertical-align:top;font-size:13px;line-height:19px;color:#6E7076;">
          <div style="font-size:14px;font-weight:600;color:#1F2023;">${name}</div>
          ${address ? `<a href="mailto:${address}" style="color:#6E7076;text-decoration:none;">${address}</a><br>` : ''}
          Personal AI agent · <a href="https://belna.se" style="color:#6E7076;text-decoration:none;">belna</a>
        </td>
      </tr>
    </table>
    ${personalCheckIn ? '<p style="margin:22px 0 0;font-size:12px;line-height:18px;color:#9A9CA3;">Rather not get these notes? Pause them in <a href="https://belna.se/app" style="color:#9A9CA3;">Automations</a>.</p>' : ''}
  </div>
</body>
</html>`;
}

// Plain-text part: the same note with a short signature, no template text.
function brandEmailText({ bodyText, agentName, agentAddress, personalCheckIn = false } = {}) {
  const name = String(agentName || '').trim() || 'Your agent';
  const lines = [String(bodyText || '').trim(), '', '-- ', name];
  if (agentAddress) lines.push(String(agentAddress));
  lines.push('Personal AI agent · belna.se');
  if (personalCheckIn) lines.push('', 'Rather not get these notes? Pause them in Automations at https://belna.se/app.');
  return lines.join('\n');
}

function publicMailbox(row, extra = {}) {
  return {
    configured: configured(),
    domain: mailDomain(),
    address: row && row.address ? row.address : null,
    localPart: row && row.localPart ? row.localPart : null,
    displayName: row && row.displayName ? row.displayName : '',
    unread: Number(extra.unread || 0),
    messages: Array.isArray(extra.messages) ? extra.messages : [],
    drafts: Array.isArray(extra.drafts) ? extra.drafts : [],
    receivingHint: 'Add the MX record Resend shows for ' + mailDomain() + ' — never on apex belna.se.',
  };
}

function publicMessage(row, { full } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    folder: row.folder,
    direction: row.direction,
    from: row.fromAddress,
    fromName: row.fromName || '',
    to: row.toAddresses || [],
    cc: row.ccAddresses || [],
    subject: row.subject || '(no subject)',
    preview: String(row.bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    isRead: !!row.isRead,
    threadId: row.threadId || row.id,
    inReplyTo: row.inReplyTo || null,
    at: row.at,
  };
  if (full) {
    out.bodyText = row.bodyText || '';
    out.bodyHtml = row.bodyHtml || '';
    out.messageId = row.messageId || null;
  }
  return out;
}

async function allocateLocalPart(userId, agentName) {
  const base = slugifyName(agentName);
  const first = isReserved(base) ? base + '-' + shortUserTag(userId) : base;
  const candidates = [first, first + '-' + shortUserTag(userId)];
  for (let i = 2; i <= 20; i++) candidates.push(first + '-' + i);
  for (const part of candidates) {
    if (isReserved(part)) continue;
    const taken = await store.mailLocalPartTaken(part, userId);
    if (!taken) return part;
  }
  return 'agent-' + shortUserTag(userId) + crypto.randomBytes(2).toString('hex');
}

async function ensureMailbox(userId, agentName) {
  const name = String(agentName || '').trim().slice(0, 40) || 'Agent';
  const existing = await store.getMailboxByUser(userId);
  if (existing) {
    if (name && existing.displayName !== name) {
      return store.upsertMailbox(userId, { displayName: name });
    }
    return existing;
  }
  const localPart = await allocateLocalPart(userId, name);
  return store.upsertMailbox(userId, {
    localPart,
    address: addressFor(localPart),
    displayName: name,
  });
}

async function snapshot(userId, { folder = 'inbox', q = '', ensureName, limit, mailbox } = {}) {
  let box = mailbox;
  if (!box) box = ensureName != null ? await ensureMailbox(userId, ensureName) : await store.getMailboxByUser(userId);
  if (!box) box = await ensureMailbox(userId, 'Agent');
  const [messages, drafts, unread] = await Promise.all([
    store.listMailMessages(userId, { folder, q, limit: limit || 40 }),
    store.listMailDrafts(userId),
    store.countUnreadMail(userId),
  ]);
  return Object.assign(publicMailbox(box, { unread, drafts: drafts.map(publicDraft) }), {
    folder,
    messages: messages.map((m) => publicMessage(m)),
  });
}

function publicDraft(row) {
  return {
    id: row.id,
    to: row.toAddresses || [],
    subject: row.subject || '',
    bodyText: row.bodyText || '',
    inReplyTo: row.inReplyTo || null,
    at: row.at,
  };
}

async function readMessage(userId, id) {
  const row = await store.getMailMessage(userId, id);
  if (!row) {
    const e = new Error('Message not found.');
    e.code = 'NOT_FOUND';
    throw e;
  }
  if (!row.isRead && row.direction === 'inbound') await store.updateMailMessage(userId, id, { isRead: true });
  return publicMessage(Object.assign({}, row, { isRead: true }), { full: true });
}

async function markRead(userId, id, isRead) {
  const row = await store.getMailMessage(userId, id);
  if (!row) {
    const e = new Error('Message not found.');
    e.code = 'NOT_FOUND';
    throw e;
  }
  await store.updateMailMessage(userId, id, { isRead: isRead !== false });
  return { ok: true };
}

async function saveDraft(userId, input) {
  const to = input.to ? parseRecipients(input.to) : [];
  return publicDraft(await store.upsertMailDraft(userId, {
    id: input.id,
    toAddresses: to,
    subject: String(input.subject || '').slice(0, 200),
    bodyText: String(input.body || input.bodyText || '').slice(0, MAX_BODY),
    inReplyTo: input.inReplyTo || null,
  }));
}

async function rfetch(path, { method = 'GET', body, idempotencyKey } = {}) {
  if (!configured()) {
    const e = new Error('Agent mail is not configured (RESEND_API_KEY).');
    e.code = 'NO_RESEND';
    throw e;
  }
  const r = await fetch('https://api.resend.com' + path, {
    method,
    headers: { Authorization: 'Bearer ' + apiKey(), 'Content-Type': 'application/json', ...(idempotencyKey ? {'Idempotency-Key':idempotencyKey} : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) {
    const e = new Error(String((data && data.message) || text || ('Resend HTTP ' + r.status)).slice(0, 300));
    e.code = r.status === 401 || r.status === 403 ? 'NO_RESEND' : 'RESEND';
    throw e;
  }
  return data;
}

// Files the owner attaches in the Mail panel, as base64. The agent's mail tool never passes any.
function parseAttachments(list) {
  if (list == null) return [];
  const fail = (message) => {
    const e = new Error(message);
    e.code = 'BAD_INPUT';
    return e;
  };
  if (!Array.isArray(list)) throw fail('Attachments must be a list.');
  if (list.length > MAX_ATTACHMENTS) throw fail('Attach up to ' + MAX_ATTACHMENTS + ' files.');
  let total = 0;
  return list.map((a) => {
    const filename = String((a && a.filename) || '').replace(/[\\/\x00-\x1f"]/g, '_').trim().slice(0, 120);
    const content = String((a && a.content) || '');
    if (!filename || !content || content.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) throw fail('An attached file could not be read.');
    total += content.length / 4 * 3 - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0);
    if (total > MAX_ATTACHMENT_BYTES) throw fail('Attached files can be up to 8 MB together.');
    const type = String((a && a.contentType) || '');
    return type.length <= 100 && /^[\w.+-]+\/[\w.+-]+$/.test(type) ? { filename, content, content_type: type } : { filename, content };
  });
}

async function send(userId, input) {
  if (input.confirm !== true) {
    const e = new Error('Sending mail needs an explicit confirm.');
    e.code = 'NEED_CONFIRM';
    throw e;
  }
  const to = parseRecipients(input.to);
  const subject = String(input.subject || '').trim().slice(0, 200);
  const bodyText = String(input.body || input.bodyText || '').trim().slice(0, MAX_BODY);
  if (!subject) {
    const e = new Error('Subject is required.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (!bodyText) {
    const e = new Error('Message body is required.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const attachments = parseAttachments(input.attachments);
  const box = await ensureMailbox(userId, input.agentName || 'Agent');
  const today = await store.countOutboundMailToday(userId);
  if (today >= MAX_SEND_PER_DAY) {
    const e = new Error('Daily send limit reached.');
    e.code = 'LIMIT';
    throw e;
  }
  const from = (box.displayName ? box.displayName + ' ' : '') + '<' + box.address + '>';
  const context = await store.getAgentContext(userId);
  const headers = {};
  if (input.inReplyTo) {
    headers['In-Reply-To'] = String(input.inReplyTo);
    headers.References = String(input.references || input.inReplyTo);
  }
  const sent = await rfetch('/emails', {
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: {
      from,
      to,
      subject,
      text: brandEmailText({ bodyText, agentName: box.displayName, agentAddress: box.address, personalCheckIn:input.personalCheckIn === true }),
      html: brandEmailHtml({ bodyText, agentName: box.displayName, agentAddress: box.address, agentColor:context.agent?.color, personalCheckIn:input.personalCheckIn === true }),
      headers: Object.keys(headers).length ? headers : undefined,
      attachments: attachments.length ? attachments : undefined,
    },
  });
  const row = await store.insertMailMessage(userId, {
    mailboxAddress: box.address,
    direction: 'outbound',
    folder: 'sent',
    fromAddress: box.address,
    fromName: box.displayName,
    toAddresses: to,
    subject,
    bodyText,
    inReplyTo: input.inReplyTo || null,
    threadId: input.threadId || input.inReplyTo || null,
    resendId: sent && sent.id ? sent.id : null,
    messageId: sent && sent.id ? sent.id : null,
    isRead: true,
  });
  if (input.draftId) await store.deleteMailDraft(userId, input.draftId).catch(() => {});
  return publicMessage(row, { full: true });
}

// The model cannot choose a recipient. Only a still-enabled built-in routine
// may deliver to the owner's verified account email, never a contact or memory.
async function sendPersonalCheckIn(userId, { subAgentId, runId, subject, body }) {
  const routine = await store.getSubAgent(userId, subAgentId);
  if (routine?.systemKind !== 'personal_email' || !routine.enabled) return {skipped:true};
  const run = await store.getAutomationRunByDedupeKey(userId, runId);
  if (!run || (run.sub_agent_id || run.subAgentId) !== subAgentId || run.status !== 'running') return {skipped:true};
  // Resend deduplicates for 24 hours. Never replay an old pending delivery
  // after that window, when its prior outcome can no longer be guaranteed.
  if (Date.now() - Date.parse(run.started_at || run.startedAt || 0) > 23 * 60 * 60_000) throw new Error('Personal check-in expired; no email resent.');
  const client = auth.adminClient();
  if (!client) throw new Error('Personal check-ins need a verified account email.');
  const {data, error} = await client.auth.admin.getUserById(userId);
  if (error || !data?.user?.email || !data.user.email_confirmed_at) throw new Error('Personal check-ins need a verified account email.');
  const context = await store.getAgentContext(userId);
  return send(userId, {to:data.user.email, subject, body, agentName:context.agent.name, confirm:true,
    personalCheckIn:true, idempotencyKey:`personal-check-in/${run.id}`});
}

function verifyWebhook(raw, headers) {
  const secret = webhookSecret();
  if (!secret) return false;
  const id = headers['svix-id'] || headers['webhook-id'] || '';
  const ts = headers['svix-timestamp'] || headers['webhook-timestamp'] || '';
  const sig = headers['svix-signature'] || headers['webhook-signature'] || '';
  if (!id || !ts || !sig) return false;
  const payload = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret);
  const expected = crypto.createHmac('sha256', key).update(id + '.' + ts + '.' + payload).digest('base64');
  return String(sig).split(' ').some((part) => {
    const v = part.includes(',') ? part.split(',')[1] : part.replace(/^v1,/, '');
    try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v)); } catch { return expected === v; }
  });
}

async function fetchReceived(emailId) {
  try { return await rfetch('/emails/receiving/' + encodeURIComponent(emailId)); } catch { return null; }
}

async function ingestWebhook(raw, headers) {
  const payload = Buffer.isBuffer(raw) ? raw.toString('utf8') : (typeof raw === 'string' ? raw : JSON.stringify(raw || {}));
  if (!verifyWebhook(payload, headers || {})) {
    const e = new Error('Bad webhook signature.');
    e.code = 'BAD_SIGNATURE';
    throw e;
  }
  let event;
  try { event = typeof raw === 'object' && raw && !Buffer.isBuffer(raw) ? raw : JSON.parse(payload); } catch {
    const e = new Error('Invalid webhook JSON.');
    e.code = 'BAD_INPUT';
    throw e;
  }
  const type = event.type || event.event || '';
  if (type && type !== 'email.received') return { ok: true, ignored: type };
  const data = event.data || event;
  let full = data;
  const emailId = data.email_id || data.id;
  if (emailId && !(data.text || data.html || data.body_text)) {
    const fetched = await fetchReceived(emailId);
    if (fetched) full = Object.assign({}, data, fetched);
  }
  const from = parseAddressList(full.from || full.from_address)[0] || { email: '', name: '' };
  const to = parseAddressList(full.to || full.to_addresses);
  const cc = parseAddressList(full.cc || full.cc_addresses);
  const recipients = [...to, ...cc].map((x) => x.email);
  let box = null;
  for (const addr of recipients) {
    box = await store.getMailboxByAddress(addr);
    if (box) break;
  }
  if (!box) return { ok: true, unmatched: recipients };
  if (emailId && await store.getMailMessageByResendId(emailId)) return { ok: true, dup: true };
  const bodyText = String(full.text || full.body_text || '').slice(0, MAX_BODY);
  const bodyHtml = String(full.html || full.body_html || '').slice(0, MAX_BODY * 2);
  const subject = String(full.subject || '').slice(0, 200);
  const messageId = full.message_id || full.messageId || emailId || null;
  const inReplyTo = full.in_reply_to || full.inReplyTo || null;
  await store.insertMailMessage(box.userId, {
    mailboxAddress: box.address,
    direction: 'inbound',
    folder: 'inbox',
    fromAddress: from.email,
    fromName: from.name,
    toAddresses: recipients,
    ccAddresses: cc.map((x) => x.email),
    subject,
    bodyText: bodyText || bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    bodyHtml,
    messageId,
    inReplyTo,
    threadId: inReplyTo || messageId,
    resendId: emailId || null,
    isRead: false,
  });
  return { ok: true, address: box.address };
}

async function agentStatus(userId, agentName) {
  const box = await ensureMailbox(userId, agentName || 'Agent');
  const unread = await store.countUnreadMail(userId);
  return {
    address: box.address,
    displayName: box.displayName,
    unread,
    ready: configured(),
    domain: mailDomain(),
  };
}

async function agentList(userId, { folder, limit } = {}) {
  const rows = await store.listMailMessages(userId, { folder: folder || 'inbox', limit: limit || 20 });
  return rows.map((m) => publicMessage(m));
}

module.exports = {
  configured,
  mailDomain,
  slugifyName,
  isReserved,
  addressFor,
  parseRecipients,
  parseAddressList,
  brandEmailHtml,
  brandEmailText,
  mascotUrl,
  sendPersonalCheckIn,
  publicMailbox,
  publicMessage,
  ensureMailbox,
  snapshot,
  readMessage,
  markRead,
  saveDraft,
  send,
  ingestWebhook,
  verifyWebhook,
  agentStatus,
  agentList,
  MAX_SEND_PER_DAY,
  RESERVED,
};
