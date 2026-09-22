/* Sessions: persistent, long-running runs with context compaction.
   Mirrors Agents API sessions: create once, keep appending input, compact when
   near the context window instead of failing. Here compaction = model summary
   of the oldest turns, stored and prepended as a running brief.
*/
import { callFoundry } from '../foundry.js';

const MAX_TURNS = 20;

async function compactIfNeeded({ history, model }) {
  if (!Array.isArray(history) || history.length <= MAX_TURNS) return { history, compacted: false };
  const head = history.slice(0, history.length - 11);
  const tail = history.slice(-11);
  const prompt = `Compress this agent session history into 8 bullet facts the agent must retain (decisions, names, preferences, open loops). No new content:\n\n` + head.map((h) => `${h.role}: ${h.text}`.slice(0, 600)).join('\n').slice(0, 8000);
  try {
    const r = await callFoundry({ prompt, system: 'You compact agent context. Facts only.', model });
    return { history: [{ role: 'user', text: '[compacted context]\n' + r.text }, ...tail], compacted: true, costUsage: r.usage };
  } catch {
    return { history: tail, compacted: true, costUsage: null };
  }
}

export { compactIfNeeded, MAX_TURNS };
