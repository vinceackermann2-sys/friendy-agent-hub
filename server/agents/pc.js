/* Live computer sessions — read-only shared terminal view.
   - Arbitrary code execution is DISABLED (see run() below): node:vm is not a
     security boundary, so user-supplied JS is never evaluated here.
   - Server-generated output lines are streamed to WS viewers and persisted in
     session.log (mirrored in the Live tab computer pane + chat cards).
   - Idle sessions are reaped (10 min).
*/
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

/* SECURITY: arbitrary code execution is disabled.
   This used to evaluate caller-supplied JS with node:vm, which Node documents
   as NOT a security mechanism: code in the context can walk the constructor
   chain of any injected function to reach the host realm, grab `process`,
   read every secret in process.env and spawn OS commands. Re-enabling requires
   a real isolation boundary (unprivileged container / WASM interpreter with no
   secrets and no network), not node:vm. */
const CODE_DISABLED = 'Code execution is disabled on this deployment.';

function run(s, { who, trace } = {}) {
  s.lastActive = Date.now();
  const line = { t: CODE_DISABLED, cls: 'p' };
  s.log.push({ ...line, who });
  s.log = s.log.slice(-40);
  broadcast(s, { out: [line], ok: false, state: 'idle' });
  trace && trace(entry('alert', 'pc run refused: code execution disabled'));
  return { ok: false, error: CODE_DISABLED, stdout: '', pcId: s.pcId, log: s.log.slice(-14) };
}

/* Append precomputed, server-generated output lines to the session terminal.
   No caller-supplied code is ever evaluated. */
function report(s, { lines = [], who = 'agent', trace } = {}) {
  s.lastActive = Date.now();
  const t0 = Date.now();
  broadcast(s, { state: 'working' });
  const safeLines = (Array.isArray(lines) ? lines : [])
    .map(String)
    .join('\n')
    .slice(0, 2000)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(0, 300));
  const stamped = safeLines.map((t) => ({ t, cls: 'g' }));
  s.log.push(...stamped.map((L) => ({ ...L, who })));
  s.log = s.log.slice(-40);
  broadcast(s, { out: stamped, ok: true, state: 'idle' });
  trace && trace(entry('term', `pc ${who} output: ${stamped.length} lines in ${Date.now() - t0}ms`));
  return { ok: true, error: '', stdout: safeLines.join('\n'), pcId: s.pcId, log: s.log.slice(-14) };
}

function publish(s, lines, trace) {
  return report(s, { lines, who: 'agent', trace });
}

function owned(pcId, userId) {
  const s = sessions.get(pcId);
  return s && s.userId === userId ? s : null;
}

module.exports = { getOrCreate, run, report, publish, owned, broadcast };
