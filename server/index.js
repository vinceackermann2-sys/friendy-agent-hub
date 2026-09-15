/* Lingon real backend — Express.
   - Serves the frontend in app/
   - POST /api/chat   -> real Gemini answer (key stays server-side)
   - POST /api/build  -> real Gemini-generated single-file HTML page
   - POST /api/research -> real web fetch + Gemini summary (no fake stats)
   - GET  /api/github/prs -> real GitHub API (token passed per-request, never stored/logged)
   - Memories + vault secrets -> Supabase when configured, else local JSON
*/
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { callGemini, isConfigured, MODEL_DEFAULT } = require('./gemini');
const { realResearch } = require('./research');
const store = require('./store');

const app = express();
const PORT = Number(process.env.PORT || 8000);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// never log secrets/tokens
function safeLog(...a) {
  const s = a.map(String).join(' ');
  if (/ghp_|github_pat_|sk-|AQ\./.test(s)) return;
  console.log(...a);
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gemini: isConfigured(),
    model: MODEL_DEFAULT,
    supabase: store.supaConfigured(),
    time: new Date().toISOString(),
  });
});

// ---------- chat ----------
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, history, agent, memories } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt required' });
    const memTxt = Array.isArray(memories) && memories.length
      ? '\n\nWhat you remember about this user (use when relevant):\n' + memories.slice(0, 10).map((m) => `- ${m.text}`).join('\n')
      : '';
    const system = `You are ${agent?.name || 'Lingon'}, a personal AI agent (${agent?.pers || 'Playful'} style). Answer helpfully and concisely. You run with a sandboxed harness, a sealed vault (you only ever receive secret REFERENCES like sec_xxxx, never values), and approvals for sensitive actions. Never claim to have browsed, run code, or read email unless the harness trace shows it. Never invent vote counts, PR numbers, or inbox contents.${memTxt}`;
    const r = await callGemini({ prompt: String(prompt), system, history: history || [] });
    res.json({ text: r.text, model: MODEL_DEFAULT });
  } catch (e) {
    if (e.code === 'NO_KEY') return res.status(500).json({ error: 'AI key missing on server. Set GEMINI_API_KEY in .env (see .env.example).' });
    safeLog('[chat] error', e.message);
    res.status(502).json({ error: 'AI request failed: ' + e.message });
  }
});

// ---------- build a page ----------
app.post('/api/build', async (req, res) => {
  try {
    const { brief, style, agent } = req.body || {};
    const system = 'You generate a complete, single dependency-free HTML file. Output ONLY the HTML (no markdown fences, no explanation). Keep it under 12KB, mobile-friendly, no external requests except Google Fonts.';
    const prompt = `Build a landing one-pager.\nStyle: ${style || 'Minimal & calm'}\nMade by agent: ${agent?.name || 'Lingon'}\nBrief: ${String(brief || 'A personal agent that researches, builds and remembers.').slice(0, 2000)}\nInclude: hero with headline + sub + CTA button, 3 feature bullets, footer. Inline <style> only.`;
    const r = await callGemini({ prompt, system });
    let html = r.text.trim().replace(/^```html/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    if (!/<html/i.test(html)) html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Made by ${(agent?.name || 'Lingon')}</title></head><body>${html}</body></html>`;
    res.json({ html: html.slice(0, 60000) });
  } catch (e) {
    if (e.code === 'NO_KEY') return res.status(500).json({ error: 'AI key missing on server.' });
    res.status(502).json({ error: 'Build failed: ' + e.message });
  }
});

// ---------- research ----------
app.post('/api/research', async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query required' });
    const r = await realResearch(String(query));
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: 'Research failed: ' + e.message });
  }
});

// ---------- GitHub (real API, token per-request) ----------
app.get('/api/github/prs', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'GitHub token required (paste a fine-grained PAT; sent per-request, never stored).' });
    // list repos for the authenticated user, then open PRs (real data)
    const gh = async (url) => {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Lingon/1.0' } });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`GitHub ${r.status}: ${t.slice(0, 300)}`);
      }
      return r.json();
    };
    const repos = await gh('https://api.github.com/user/repos?per_page=10&sort=updated');
    const prs = [];
    for (const repo of repos.slice(0, 5)) {
      try {
        const list = await gh(`https://api.github.com/repos/${repo.full_name}/pulls?state=open&per_page=5`);
        for (const pr of list) prs.push({ repo: repo.full_name, number: pr.number, title: pr.title, url: pr.html_url, user: pr.user?.login, created_at: pr.created_at, diff_url: pr.diff_url });
      } catch {}
    }
    res.json({ repos: repos.map((r) => r.full_name), prs });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/github/diff', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    const { repo, number } = req.query;
    if (!token || !repo || !number) return res.status(400).json({ error: 'token + repo + number required' });
    const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.diff', 'User-Agent': 'Lingon/1.0' },
    });
    const diff = await r.text();
    res.json({ diff: diff.slice(0, 30000) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- memories ----------
app.get('/api/memories', async (req, res) => {
  const userId = String(req.query.userId || 'local');
  res.json({ memories: await store.listMemories(userId) });
});
app.post('/api/memories', async (req, res) => {
  const { userId, text, src } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  res.json({ memory: await store.addMemory(String(userId || 'local'), String(text), String(src || 'chat')) });
});
app.delete('/api/memories/:id', async (req, res) => {
  const userId = String(req.query.userId || req.body?.userId || 'local');
  await store.delMemory(userId, req.params.id);
  res.json({ ok: true });
});

// ---------- vault secrets (metadata only; values never go to the model) ----------
app.get('/api/secrets', async (req, res) => {
  const userId = String(req.query.userId || 'local');
  res.json({ secrets: await store.listSecrets(userId) });
});
app.post('/api/secrets', async (req, res) => {
  const { userId, name, value } = req.body || {};
  if (!name || !value) return res.status(400).json({ error: 'name + value required' });
  const s = await store.addSecret(String(userId || 'local'), String(name).slice(0, 80), String(value).slice(0, 4000));
  res.json({ secret: s });
});
app.post('/api/secrets/:id/reveal', async (req, res) => {
  const { userId } = req.body || {};
  const v = await store.revealSecret(String(userId || 'local'), req.params.id);
  if (!v) return res.status(404).json({ error: 'not found' });
  res.json({ value: v });
});
app.delete('/api/secrets/:id', async (req, res) => {
  const userId = String(req.query.userId || req.body?.userId || 'local');
  await store.delSecret(userId, req.params.id);
  res.json({ ok: true });
});

// ---------- static frontend ----------
const APP_DIR = path.join(__dirname, '..', 'app');
app.use(express.static(APP_DIR, { extensions: ['html'] }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(APP_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lingon real backend on http://localhost:${PORT}`);
  console.log(`- Gemini: ${isConfigured() ? 'configured (' + MODEL_DEFAULT + ')' : 'MISSING — set GEMINI_API_KEY in .env'}`);
  console.log(`- Supabase: ${store.supaConfigured() ? 'configured' : 'local JSON fallback (server/data.json)'}`);
});
