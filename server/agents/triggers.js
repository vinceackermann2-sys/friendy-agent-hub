const TRIGGER_TYPES = new Set(['schedule', 'app', 'subagent']);
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 30 * 24 * 60;
const MAX_CHAIN_DEPTH = 4;

function text(value, max) {
  return String(value || '').trim().slice(0, max);
}

function bad(message) {
  const error = new Error(message);
  error.code = 'BAD_INPUT';
  throw error;
}

function normalizeTrigger(input, currentId) {
  const type = text(input?.type, 24).toLowerCase();
  if (!TRIGGER_TYPES.has(type)) bad('Choose a schedule, connected app, or sub-agent trigger.');

  if (type === 'schedule') {
    const intervalMinutes = Math.round(Number(input?.intervalMinutes || 0));
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < MIN_INTERVAL_MINUTES || intervalMinutes > MAX_INTERVAL_MINUTES) {
      bad(`Schedule interval must be between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES} minutes.`);
    }
    return { type, intervalMinutes };
  }

  if (type === 'app') {
    const app = text(input?.app, 40).toLowerCase();
    const event = text(input?.event, 80).toLowerCase();
    const connectedAccountId = text(input?.connectedAccountId, 100);
    if (!/^[a-z0-9_-]+$/.test(app) || !/^[a-z0-9_.:-]+$/.test(event)) bad('Choose a valid connected-app event.');
    if (connectedAccountId && !/^ca_[A-Za-z0-9_-]+$/.test(connectedAccountId)) bad('Choose a valid connected account.');
    return { type, app, event, ...(connectedAccountId ? {connectedAccountId} : {}) };
  }

  const sourceAgentId = text(input?.sourceAgentId, 100);
  if (!sourceAgentId || sourceAgentId === currentId) bad('Choose a different sub-agent to trigger this automation.');
  return { type, sourceAgentId, event: 'completed' };
}

function normalizeSubAgent(input, currentId) {
  const name = text(input?.name, 60);
  const prompt = text(input?.prompt, 4000);
  if (!name) bad('Sub-agent name is required.');
  if (!prompt) bad('Tell the sub-agent what to do.');
  return {
    name,
    prompt,
    enabled: input?.enabled !== false,
    trigger: normalizeTrigger(input?.trigger, currentId),
  };
}

function nextRunAt(trigger, from = Date.now()) {
  if (trigger?.type !== 'schedule') return null;
  return new Date(from + trigger.intervalMinutes * 60 * 1000).toISOString();
}

function eventMatches(trigger, event) {
  if (!trigger || !event || trigger.type !== event.type) return false;
  if (trigger.type === 'app') return trigger.app === String(event.app || '').toLowerCase() && (trigger.event === '*' || trigger.event === String(event.event || '').toLowerCase()) && (!trigger.connectedAccountId || trigger.connectedAccountId === event.connectedAccountId);
  if (trigger.type === 'subagent') return trigger.sourceAgentId === event.sourceAgentId && event.event === 'completed';
  return false;
}

function triggerLabel(trigger) {
  if (trigger?.type === 'schedule') return `Every ${trigger.intervalMinutes} minutes`;
  if (trigger?.type === 'app') return `${trigger.app}: ${trigger.event}`;
  if (trigger?.type === 'subagent') return 'After another sub-agent completes';
  return 'Unknown trigger';
}

module.exports = {
  MAX_CHAIN_DEPTH,
  MIN_INTERVAL_MINUTES,
  eventMatches,
  nextRunAt,
  normalizeSubAgent,
  normalizeTrigger,
  triggerLabel,
};
