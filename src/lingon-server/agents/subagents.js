/* Multi-agent fan-out (Agents API multi_agent pattern).
   Each subagent gets its own context (task slice); the main agent coordinates
   and aggregates. max_concurrent_subagents: 3.
*/
import { entry, persistRun } from './tracing.js';

async function fanOut({ userId, sessionId, items, max = 3, runOne, trace }) {
  const results = new Array(items.length);
  let i = 0;
  async function worker(wid) {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      const t0 = Date.now();
      trace(entry('box', `subagent ${item.name || 'worker' + wid} started`));
      try {
        results[idx] = await runOne(item, idx);
        trace(entry('box', `subagent ${item.name || 'worker' + wid} done · ${Date.now() - t0}ms`));
        persistRun({ userId, sessionId, kind: 'subagent', name: item.name || String(idx), status: 'done', detail: item.desc || '', ms: Date.now() - t0 });
      } catch (e) {
        results[idx] = { error: e.message };
        trace(entry('alert', `subagent failed: ${e.message}`));
        persistRun({ userId, sessionId, kind: 'subagent', name: item.name || String(idx), status: 'error', detail: e.message, ms: Date.now() - t0 });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, (_, w) => worker(w)));
  return results;
}

export { fanOut };
