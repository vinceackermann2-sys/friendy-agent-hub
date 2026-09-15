/* Agents-API-style tracing: runs → subagent spans → tool spans.
   Each Runner.run() returns { output, trace } where trace entries render in the
   frontend Trace tab. Persisted via store.logToolRun (Supabase or local). */
const store = require('../store');

async function persistRun({ userId, sessionId, kind, name, status, detail, ms }) {
  try {
    await store.logToolRun({ userId, sessionId, kind, name, status, detail, ms });
  } catch {}
}

function entry(ic, t) {
  return { ic, t, at: Date.now() };
}

module.exports = { persistRun, entry };
