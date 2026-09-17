/* Read-only tool output sessions. Only trusted server-side tools can publish
   lines here; user-supplied JavaScript is never evaluated in the app process. */
const { entry } = require('./tracing');

const sessions = new Map(); // pcId -> { pcId, userId, chatId, log[], viewers:Set, lastActive }
const IDLE_MS = 600000;
let sweepTimer = null;

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function sweep() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > IDLE_MS) sessions.delete(id);
  }
  if (!sessions.size && sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}

function broadcast(s, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of s.viewers) {
    try { ws.readyState === 1 && ws.send(msg); } catch {}
  }
}

function getOrCreate(userId, chatId) {
  const pcId = 'pc_' + String(chatId || 'unsorted').slice(0, 24);
  let s = sessions.get(pcId);
  if (s && s.userId === userId) { s.lastActive = Date.now(); return s; }
  s = { pcId, userId, chatId, log: [], viewers: new Set(), lastActive: Date.now() };
  sessions.set(pcId, s);
  if (!sweepTimer) sweepTimer = setInterval(sweep, 60000);
  return s;
}

function publish(s, lines, trace) {
  s.lastActive = Date.now();
  const t0 = Date.now();
  broadcast(s, { state: 'working' });
  const safeLines = (Array.isArray(lines) ? lines : []).map(String).join('\n').slice(0, 2000).split('\n').filter(Boolean);
  const stamped = safeLines.map((t) => ({ t, cls: 'g' }));
  s.log.push(...stamped.map((line) => ({ ...line, who: 'agent' })));
  s.log = s.log.slice(-40);
  broadcast(s, { out: stamped, ok: true, state: 'idle' });
  trace && trace(entry('term', `tool output: ${stamped.length} lines in ${Date.now() - t0}ms`));
  return { ok: true, stdout: safeLines.join('\n'), pcId: s.pcId, log: s.log.slice(-14) };
}

function owned(pcId, userId) {
  const s = sessions.get(pcId);
  return s && s.userId === userId ? s : null;
}

module.exports = { getOrCreate, publish, owned, broadcast };
