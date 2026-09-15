/* Live computer sessions — a REAL shared sandbox terminal.
   - One persistent node:vm context per (user, chat). No I/O, no require,
     3s timeout per execution — same bounds as the one-shot code_run tool.
   - Every execution streams its stdout lines to WS viewers AND persists them
     in session.log (mirrored in the Live tab computer pane + chat cards).
   - `input` and `last` stay bound in the context, so the user can take over
     and run their own lines against the same live data the agent just used.
   - Idle sessions are reaped (10 min); contexts never touch disk/network.
*/
const vm = require('node:vm');
const { entry } = require('./tracing');

const sessions = new Map(); // pcId -> { pcId, userId, chatId, context, log[], userControl, viewers:Set, lastActive }
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
  const lines = [];
  const sandbox = {
    input: null,
    last: null,
    console: { log: (...a) => {
      const line = a.map(String).join(' ');
      lines.push(line);
    } },
  };
  vm.createContext(sandbox);
  s = { pcId, userId, chatId, context: sandbox, lines, log: [], userControl: false, viewers: new Set(), lastActive: Date.now() };
  sessions.set(pcId, s);
  if (!sweepTimer) sweepTimer = setInterval(sweep, 60000);
  return s;
}

function run(s, { code, input, who, trace }) {
  s.lastActive = Date.now();
  s.lines.length = 0;
  if (input !== undefined) s.context.input = JSON.parse(JSON.stringify(input));
  const t0 = Date.now();
  broadcast(s, { state: who === 'user' ? 'user' : 'working', run: String(code).slice(0, 120) });
  let ok = true, error = '';
  try {
    const result = vm.runInContext(String(code).slice(0, 4000), s.context, { timeout: 3000 });
    s.context.last = result === undefined ? s.context.last : JSON.parse(JSON.stringify(result ?? null));
  } catch (e) {
    ok = false;
    error = e.message;
  }
  const stdout = s.lines.join('\n').slice(0, 2000);
  const stamped = stdout.split('\n').filter(Boolean).map((t) => ({ t, cls: ok ? 'g' : 'p' }));
  s.log.push(...stamped.map((L) => ({ ...L, who })));
  s.log = s.log.slice(-40);
  broadcast(s, { out: stamped, ok, state: s.userControl ? 'user' : 'idle' });
  trace && trace(entry('term', `pc ${who} run: ${stamped.length} output lines in ${Date.now() - t0}ms`));
  return { ok, error, stdout, pcId: s.pcId, log: s.log.slice(-14) };
}

function takeOver(s, on) {
  s.userControl = !!on;
  s.lastActive = Date.now();
  broadcast(s, { state: s.userControl ? 'user' : 'idle' });
  return { userControl: s.userControl };
}

function owned(pcId, userId) {
  const s = sessions.get(pcId);
  return s && s.userId === userId ? s : null;
}

module.exports = { getOrCreate, run, takeOver, owned, broadcast };
