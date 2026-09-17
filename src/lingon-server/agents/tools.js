/* Tool registry — Agents API shape adapted to our stack.
   Each tool: { name, type, description, approval, run(args, ctx) }.
   - Tool search: pickTools(task) loads only relevant definitions (saves tokens).
   - Programmatic calling: runParallel executes independent calls concurrently.
   ctx: { userId, sessionId, trace (push fn), githubPat }
*/
import { fetchAllowlisted } from './sandbox.js';
import { entry } from './tracing.js';
import { hostAllowed } from './sandbox.js';
import * as store from '../store.js';

const TOOLS = {
  web_search: {
    name: 'web_search', type: 'web_search', approval: false,
    description: 'Live fetch of allowlisted public sources (HN, DuckDuckGo, Wikipedia).',
    run: async ({ urls }, ctx) => {
      const out = [];
      for (const u of urls.slice(0, 4)) {
        const t0 = Date.now();
        try {
          const r = await fetchAllowlisted(u);
          const text = (await r.text()).slice(0, 12000);
          out.push({ url: u, ok: true, text });
          ctx.trace(entry('globe', `web_search: ${new URL(u).hostname} · ${Date.now() - t0}ms`));
        } catch (e) {
          out.push({ url: u, ok: false, error: e.message });
          ctx.trace(entry('alert', `web_search failed: ${e.message}`));
        }
      }
      return out;
    },
  },
  github_prs: {
    name: 'github_prs', type: 'function', approval: true,
    description: 'Read-only list of recent repos + open PRs using the user PAT.',
    run: async (_, ctx) => {
      if (!ctx.githubPat) throw Object.assign(new Error('GitHub token required.'), { code: 'NO_PAT' });
      const gh = async (url, accept = 'application/vnd.github+json') => {
        const r = await fetchAllowlisted(url, { headers: { Authorization: `Bearer ${ctx.githubPat}`, Accept: accept } });
        if (!r.ok) throw new Error(`GitHub ${r.status}`);
        return accept.includes('diff') ? r.text() : r.json();
      };
      const repos = await gh('https://api.github.com/user/repos?per_page=10&sort=updated');
      const prs = [];
      await Promise.all(repos.slice(0, 5).map(async (repo) => {
        try {
          const list = await gh(`https://api.github.com/repos/${repo.full_name}/pulls?state=open&per_page=5`);
          for (const pr of list) prs.push({ repo: repo.full_name, number: pr.number, title: pr.title, url: pr.html_url, user: pr.user?.login });
        } catch {}
      }));
      ctx.trace(entry('git', `github_prs: ${repos.length} repos, ${prs.length} open PRs (read-only)`));
      return { repos: repos.map((r) => r.full_name), prs };
    },
  },
  github_diff: {
    name: 'github_diff', type: 'function', approval: true,
    description: 'Read-only fetch of a single PR diff.',
    run: async ({ repo, number }, ctx) => {
      if (!ctx.githubPat) throw Object.assign(new Error('GitHub token required.'), { code: 'NO_PAT' });
      const r = await fetchAllowlisted(`https://api.github.com/repos/${repo}/pulls/${number}`, {
        headers: { Authorization: `Bearer ${ctx.githubPat}`, Accept: 'application/vnd.github.diff' },
      });
      const diff = (await r.text()).slice(0, 30000);
      ctx.trace(entry('git', `github_diff: ${repo}#${number} (${diff.length} chars)`));
      return { diff };
    },
  },
  browser_open: {
    name: 'browser_open', type: 'browser', approval: false,
    description: 'Open one allowlisted URL (headless browsing is unavailable in this runtime).',
    run: async ({ url }) => {
      const u = String(url || '');
      if (!hostAllowed(u)) throw Object.assign(new Error('host blocked by sandbox allowlist'), { code: 'HOST_BLOCKED' });
      throw Object.assign(new Error('browser tool unavailable in this runtime'), { code: 'DISABLED' });
    },
  },
  code_run: {
    name: 'code_run', type: 'code', approval: false,
    description: 'Disabled: arbitrary JS execution is not available (no real isolation boundary on this runtime).',
    // SECURITY: previously ran user/model-supplied JS via new Function (and
    // node:vm on the Node build). Neither is a security boundary — the code
    // could reach the host realm, process.env secrets and OS commands.
    // Executing untrusted code requires a real isolate (separate unprivileged
    // container/WASM interpreter with no secrets), which this runtime lacks.
    run: async (_args, ctx) => {
      ctx.trace(entry('alert', 'code_run: disabled — untrusted code execution is not permitted'));
      throw Object.assign(new Error('code execution is disabled on this deployment'), { code: 'DISABLED' });
    },
  },
  build_page: {
    name: 'build_page', type: 'function', approval: false,
    description: 'Generate a single-file HTML page via the model (sandboxed preview).',
    run: async ({ html }, ctx) => {
      ctx.trace(entry('code', `build_page: ${String(html || '').length} chars (sandboxed iframe)`));
      return { html: String(html || '').slice(0, 60000) };
    },
  },
  memory_write: {
    name: 'memory_write', type: 'function', approval: false,
    description: 'Persist a user-scoped memory.',
    run: async ({ text, src }, ctx) => {
      const m = await store.addMemory(ctx.userId, String(text).slice(0, 2000), src || 'agent');
      ctx.trace(entry('book', `memory_write: saved (${String(text).slice(0, 60)}…)`));
      return m;
    },
  },
  history_search: {
    name: 'history_search', type: 'function', approval: false,
    description: 'Keyword search over the user\'s own past chat turns (transcripts).',
    run: async ({ query }, ctx) => {
      const turns = await store.searchTurns(ctx.userId, String(query || '').slice(0, 200));
      ctx.trace(entry('file', `history_search: ${turns.length} past turns matched`));
      return turns.map((t) => ({ role: t.role, text: String(t.text).slice(0, 600) }));
    },
  },
};

// Tool search: load only relevant definitions for the task (token saving).
function pickTools(task) {
  const t = String(task || '').toLowerCase();
  const names = new Set(['memory_write']);
  if (/(research|investigat|social|poll|sentiment|news|search|find)/.test(t)) names.add('web_search');
  if (/(github|\bpr\b|pull request|repo|diff|code review)/.test(t)) { names.add('github_prs'); names.add('github_diff'); }
  if (/(build|landing|page|site|website|dashboard)/.test(t)) names.add('build_page');
  if (/(earlier|yesterday|last (week|time|chat)|we (talked|discussed)|discussed|previous)/.test(t)) names.add('history_search');
  if (names.size === 1) names.add('web_search'); // default research capability
  return [...names].map((n) => TOOLS[n]);
}

async function runParallel(calls, ctx) {
  return Promise.all(calls.map((c) => TOOLS[c.tool].run(c.args || {}, ctx)));
}

export { TOOLS, pickTools, runParallel };
