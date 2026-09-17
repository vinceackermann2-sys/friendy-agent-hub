/* Agent harness — the real (non-Codex) tool boundary.
   NOTE (honest): this is NOT the OpenAI Codex Agents API. It is our own
   Gemini-backed harness with the same safety shape: tools run server-side,
   secrets never enter model context, sensitive tools need explicit approval,
   every run is traceable. Frontend Trace tab renders these entries.

   Tools:
   - web_fetch      (no approval, allowlisted hosts, 9s timeout)
   - github_prs     (needs approval + per-request user PAT, read-only)
   - github_diff    (needs approval + per-request user PAT, read-only)
    - build_page     (no approval, output is sandboxed iframe HTML)
    - memory_write   (no approval, user-scoped)
    - trigger_create (approval required, user-scoped automation watcher)
    - trigger_list   (no approval, user-scoped)
*/
const ALLOW_HOSTS = new Set([
  'hn.algolia.com', 'api.duckduckgo.com', 'en.wikipedia.org',
  'api.github.com',
  'generativelanguage.googleapis.com',
]);

function hostAllowed(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && ALLOW_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

const TOOL_POLICY = {
  web_fetch: { approval: false, desc: 'Live HTTP fetch (allowlisted hosts only)' },
  github_prs: { approval: true, desc: 'Read-only GitHub PR list with user PAT' },
  github_diff: { approval: true, desc: 'Read-only GitHub diff with user PAT' },
  build_page: { approval: false, desc: 'Gemini-generated sandboxed HTML' },
  memory_write: { approval: false, desc: 'User-scoped memory write' },
  trigger_create: { approval: true, desc: 'Create a user-scoped schedule, app, or sub-agent trigger' },
  trigger_list: { approval: false, desc: 'List the user’s own trigger watchers' },
};

function traceLine(tool, detail) {
  return { ic: tool === 'github_prs' || tool === 'github_diff' ? 'git' : tool === 'web_fetch' ? 'globe' : tool === 'build_page' ? 'code' : 'spark', t: `${tool}: ${detail}` };
}

export { ALLOW_HOSTS, hostAllowed, TOOL_POLICY, traceLine };
