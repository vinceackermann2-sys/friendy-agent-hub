const crypto = require('crypto');
const { adminClient } = require('./auth');

// Device commands are durable across workers. Only metadata stays after a result
// is consumed; personal arguments/results are encrypted and expire after 2 min.
const APPLE_ACTIONS = Object.freeze({
  'calendar.list': { scope: 'calendar', read: true },
  'calendar.create': { scope: 'calendar', read: false },
  'calendar.update': { scope: 'calendar', read: false },
  'calendar.delete': { scope: 'calendar', read: false },
  'reminders.list': { scope: 'reminders', read: true },
  'reminders.create': { scope: 'reminders', read: false },
  'reminders.update': { scope: 'reminders', read: false },
  'reminders.complete': { scope: 'reminders', read: false },
  'reminders.delete': { scope: 'reminders', read: false },
  'contacts.search': { scope: 'contacts', read: true },
  'contacts.create': { scope: 'contacts', read: false },
  'contacts.update': { scope: 'contacts', read: false },
  'contacts.delete': { scope: 'contacts', read: false },
  'health.summary': { scope: 'health', read: true },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message, code = 'BAD_INPUT') => Object.assign(new Error(message), { code });
function jsonSize(value, limit) {
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json) > limit) throw fail('Apple request is too large.');
  return json;
}
function validateAppleAction(action, args = {}) {
  if (!Object.hasOwn(APPLE_ACTIONS, action)) throw fail('Unsupported Apple action.');
  if (!args || Array.isArray(args) || typeof args !== 'object') throw fail('Apple arguments must be an object.');
  jsonSize(args, 12000);
  if (action === 'contacts.search' && (!String(args.query || '').trim() || String(args.query).length > 100)) throw fail('Search Contacts with a specific name; bulk export is unavailable.');
  if (action === 'health.summary' && args.purpose !== 'wellness') throw fail('Health summaries are only available for the owner’s own fitness and wellness.');
  if (action === 'health.summary' && args.start != null && !(Date.parse(args.start) < Date.now() && Date.now() - Date.parse(args.start) <= 7 * 86400000)) throw fail('A health summary start must be an ISO 8601 time within the last 7 days.');
  if (action === 'calendar.list' && (!Number.isFinite(Date.parse(args.start)) || !Number.isFinite(Date.parse(args.end)) || Date.parse(args.end) <= Date.parse(args.start) || Date.parse(args.end) - Date.parse(args.start) > 31 * 86400000)) throw fail('Calendar reads need start/end dates covering at most 31 days.');
  if (action.endsWith('.create') && !String(args.title || args.givenName || '').trim()) throw fail('A title or contact name is required.');
  if (/\.(update|delete|complete)$/.test(action) && !String(args.id || '').trim()) throw fail('Use an exact item id returned by an earlier Apple read.');
  return { ...APPLE_ACTIONS[action], action };
}
function cipherKey() {
  const value = String(process.env.ENCRYPTION_KEY || process.env.LINGON_ENCRYPTION_KEY || '').trim();
  if (value.length < 16) throw fail('Apple connections require server encryption configuration.', 'UNAVAILABLE');
  return /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : crypto.createHash('sha256').update(value).digest();
}
function seal(value, aad) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') };
}
function unseal(value, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(value.iv, 'hex'));
  decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(value.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'hex')), decipher.final()]).toString('utf8'));
}
function createAppleDeviceBroker({ client = adminClient, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const db = () => { const c = client(); if (!c) throw fail('Apple connections require the account database.', 'UNAVAILABLE'); return c; };
  const checked = async query => { const { data, error } = await query; if (error) throw fail('Apple connection storage is unavailable. Apply the Apple device migration.', 'UNAVAILABLE'); return data; };
  const validId = id => { if (!UUID.test(String(id || ''))) throw fail('Valid device or request id required.'); return id; };
  async function devices(userId) {
    const rows = await checked(db().from('apple_devices').select('id,name,platform,capabilities,last_seen_at').eq('user_id', userId).order('last_seen_at', { ascending: false }));
    return (rows || []).map(row => ({ ...row, online: now() - Date.parse(row.last_seen_at) < 45000 }));
  }
  async function register(userId, input) {
    validId(input.id);
    if (!['ios', 'mac'].includes(input.platform)) throw fail('Unsupported device platform.');
    const capabilities = Object.fromEntries(['calendar','reminders','contacts','health'].map(scope => [scope, input.capabilities?.[scope] === true]));
    await checked(db().from('apple_devices').upsert({ id: input.id, user_id: userId, name: String(input.name || (input.platform === 'ios' ? 'iPhone / iPad' : 'Mac')).slice(0, 80), platform: input.platform, capabilities, last_seen_at: new Date(now()).toISOString() }, { onConflict: 'user_id,id' }));
    return { ok: true };
  }
  async function disconnect(userId, id) {
    validId(id);
    await checked(db().from('apple_device_commands').update({ status: 'cancelled', payload: null, result: null, lease_token: null }).eq('user_id', userId).eq('device_id', id).in('status', ['pending','running','done']));
    await checked(db().from('apple_devices').delete().eq('user_id', userId).eq('id', id));
    return { ok: true };
  }
  async function claim(userId, deviceId) {
    validId(deviceId);
    const device = (await devices(userId)).find(d => d.id === deviceId);
    if (!device?.online) return { commands: [] };
    // Expired commands are never replayed: a device might have completed a write
    // just before losing its connection. The owner must inspect before retrying.
    await checked(db().from('apple_device_commands').update({ status: 'expired', payload: null, result: null, lease_token: null }).eq('user_id', userId).lt('expires_at', new Date(now()).toISOString()).in('status', ['pending','running','done']));
    const rows = await checked(db().from('apple_device_commands').select('id,action').eq('user_id', userId).eq('device_id', deviceId).eq('status', 'pending').gt('expires_at', new Date(now()).toISOString()).order('created_at').limit(1));
    const commands = [];
    for (const row of rows || []) {
      if (!(await state(userId,deviceId,row.id)).active) continue;
      const token = crypto.randomUUID();
      const claimed = await checked(db().from('apple_device_commands').update({ status: 'running', lease_token: token }).eq('user_id', userId).eq('device_id', deviceId).eq('id', row.id).eq('status', 'pending').gt('expires_at', new Date(now()).toISOString()).select('id,action,payload,expires_at'));
      if (claimed?.[0]) commands.push({ id: row.id, action: row.action, leaseToken: token, args: unseal(claimed[0].payload, `${userId}:${row.id}:args`), expiresAt: claimed[0].expires_at });
    }
    return { commands };
  }
  async function complete(userId, deviceId, id, input) {
    validId(deviceId); validId(id); validId(input.leaseToken);
    const result = input.error ? { error: String(input.error).slice(0, 400) } : input.result;
    jsonSize(result, 48000);
    const sealed = seal(result, `${userId}:${id}:result`);
    const updated = await checked(db().from('apple_device_commands').update({ status: 'done', payload: null, result: sealed }).eq('user_id', userId).eq('device_id', deviceId).eq('id', id).eq('lease_token', input.leaseToken).eq('status', 'running').gt('expires_at', new Date(now()).toISOString()).select('id'));
    if (!updated?.length) {
      const prior = await checked(db().from('apple_device_commands').select('status,lease_token').eq('user_id', userId).eq('device_id', deviceId).eq('id', id).maybeSingle());
      if (prior?.lease_token === input.leaseToken && ['done','consumed'].includes(prior.status)) return { ok: true };
      throw fail('Apple request expired or was cancelled; its outcome may be uncertain.', 'CONFLICT');
    }
    return { ok: true };
  }
  async function state(userId, deviceId, id) {
    validId(deviceId); validId(id);
    const row = await checked(db().from('apple_device_commands').select('status,expires_at,task_id').eq('user_id',userId).eq('device_id',deviceId).eq('id',id).maybeSingle());
    let active = !!row && ['pending','running'].includes(row.status) && Date.parse(row.expires_at) > now();
    if (active && row.task_id) {
      const task = await checked(db().from('agent_chat_tasks').select('state').eq('user_id',userId).eq('id',row.task_id).maybeSingle());
      active = !!task && ['queued','running','waiting_peers','waiting_approval'].includes(task.state?.status);
      if (!active) await checked(db().from('apple_device_commands').update({status:'cancelled',payload:null,result:null,lease_token:null}).eq('user_id',userId).eq('id',id).in('status',['pending','running']));
    }
    return { active, status: row?.status || 'missing' };
  }
  async function submit(userId, { deviceId, action, args = {} }, { taskId } = {}) {
    const meta = validateAppleAction(action, args);
    const list = await devices(userId);
    const eligible = list.filter(d => d.online && d.capabilities[meta.scope]);
    const device = deviceId ? eligible.find(d => d.id === deviceId) : eligible.length === 1 ? eligible[0] : null;
    if (!device) throw fail(eligible.length > 1 ? 'Choose an exact Apple device id from apple_devices.' : 'Open Belna on your Apple device and connect this app under Apple apps.', 'DEVICE_OFFLINE');
    const id = crypto.randomUUID(), expiresAt = now() + 120000;
    await checked(db().from('apple_device_commands').insert({ id, user_id: userId, device_id: device.id, task_id: taskId || null, action, status: 'pending', payload: seal(args, `${userId}:${id}:args`), expires_at: new Date(expiresAt).toISOString() }));
    return { pending: true, requestId: id, deviceId: device.id, action, expiresAt: new Date(expiresAt).toISOString(), note: 'Request sent to the device. It has not completed. Call apple_result with requestId; never repeat apple_execute to check progress.' };
  }
  async function result(userId, id) {
    validId(id);
    const row = await checked(db().from('apple_device_commands').select('status,result,expires_at').eq('user_id', userId).eq('id', id).maybeSingle());
    if (!row) throw fail('Apple request not found.', 'NOT_FOUND');
    if (row.status === 'consumed') return { requestId: id, status: 'consumed', note: 'The result was already retrieved. Do not repeat a write; inspect the Apple app if its outcome is unclear.' };
    if (Date.parse(row.expires_at) <= now() || ['cancelled','expired'].includes(row.status)) {
      await checked(db().from('apple_device_commands').update({ status: 'expired', payload: null, result: null, lease_token: null }).eq('user_id', userId).eq('id', id).in('status',['pending','running','done']));
      throw fail('Apple request expired or was cancelled. Inspect the Apple app before retrying a write.', 'DEVICE_EXPIRED');
    }
    if (row.status !== 'done') return { requestId: id, pending: true, status: row.status, note: 'Keep Belna open on the device. Retrieve this same request with apple_result. The action is not confirmed.' };
    const value = unseal(row.result, `${userId}:${id}:result`);
    const consumed = await checked(db().from('apple_device_commands').update({ status: 'consumed', result: null, payload: null }).eq('user_id', userId).eq('id', id).eq('status','done').select('id'));
    if (!consumed?.length) return { requestId: id, status: 'consumed', note: 'Another call already retrieved this result. Never repeat an uncertain write.' };
    if (value?.error) throw fail(value.error, 'DEVICE_ERROR');
    return { requestId: id, status: 'done', result: value };
  }
  // Bounded waiting is useful for tests and Node callers. Agent tools use the
  // durable submit/result protocol, so serverless invocations stay short.
  async function execute(userId, args, { signal } = {}) {
    const request = await submit(userId, args), id = request.requestId;
    const expiresAt = Date.parse(request.expiresAt);
    try {
      while (now() < expiresAt) {
        if (signal?.aborted) throw fail('Apple request cancelled. Inspect the device before retrying a write.', 'CANCELLED');
        const out = await result(userId, id);
        if (out.status === 'done') return out.result;
        if (!out.pending) throw fail('Apple result was already retrieved. Inspect the device before retrying a write.', 'CANCELLED');
        await wait(700);
      }
      throw fail('The Apple device did not return a result. Keep Belna open. Inspect Calendar, Contacts or Reminders before retrying a write.', 'DEVICE_OFFLINE');
    } finally {
      await checked(db().from('apple_device_commands').update({ status: 'expired', payload: null, result: null, lease_token: null }).eq('user_id', userId).eq('id', id).in('status', ['pending','running','done']));
    }
  }
  return { devices, register, disconnect, claim, complete, state, submit, result, execute };
}
const appleDevices = createAppleDeviceBroker();
function installAppleDeviceRoutes(app, { requireAuth, rateLimit }) {
  const wrap = fn => requireAuth(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await fn(req)); }
    catch (error) { res.status(error.code === 'BAD_INPUT' ? 400 : error.code === 'CONFLICT' ? 409 : 503).json({ error: error.message }); }
  });
  app.get('/api/apple/devices', rateLimit(120,60000), wrap(req => appleDevices.devices(req.user.id).then(devices => ({ devices }))));
  app.post('/api/apple/devices', rateLimit(90,60000), wrap(req => appleDevices.register(req.user.id, req.body || {})));
  app.delete('/api/apple/devices/:id', rateLimit(20,60000), wrap(req => appleDevices.disconnect(req.user.id, req.params.id)));
  app.get('/api/apple/devices/:id/commands', rateLimit(120,60000), wrap(req => appleDevices.claim(req.user.id, req.params.id)));
  app.get('/api/apple/devices/:id/commands/:commandId', rateLimit(120,60000), wrap(req => appleDevices.state(req.user.id,req.params.id,req.params.commandId)));
  app.post('/api/apple/devices/:id/commands/:commandId', rateLimit(60,60000), wrap(req => appleDevices.complete(req.user.id, req.params.id, req.params.commandId, req.body || {})));
}
module.exports = { APPLE_ACTIONS, validateAppleAction, createAppleDeviceBroker, appleDevices, installAppleDeviceRoutes, seal, unseal };
