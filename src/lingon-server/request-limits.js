const MB = 1024 * 1024;
const normalizePath = path => String(path || '').toLowerCase().replace(/\/+$/, '');

function rawWebhook(path) {
  return ['/api/stripe/webhook', '/api/mail/webhook', '/api/composio/webhook'].includes(normalizePath(path));
}

// Keep upload allowances identical in the Node and edge runtimes.
function requestBodyLimit(method, path) {
  path = normalizePath(path);
  if (method === 'POST') {
    if (path === '/api/composio/webhook') return 256 * 1024;
    if (rawWebhook(path)) return 100 * 1024;
    if (['/api/chat', '/api/chat/stream', '/api/agent/conversation'].includes(path)) return 72 * MB;
    if (path === '/api/library') return 15 * MB;
    if (['/api/voice/transcribe', '/api/support/submissions', '/api/mail/send'].includes(path)) return 12 * MB;
  }
  if (method === 'PUT' && path.startsWith('/api/client-state/')) return 12 * MB;
  if (method === 'PATCH' && path.startsWith('/api/library/')) return 15 * MB;
  return MB;
}

export { requestBodyLimit, rawWebhook };
