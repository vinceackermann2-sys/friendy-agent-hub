/* Real web research — no fabricated counts.
   Runs INSIDE the harness sandbox: every fetch goes through
   sandbox.fetchAllowlisted (allowlisted hosts, timeout). Strategy: parallel
   fetch (HN Algolia, DuckDuckGo, Wikipedia), extract snippets, Gemini summary
   with sources. Everything traceable. */
const { callGemini } = require('./gemini');
const { fetchAllowlisted } = require('./agents/sandbox');

async function fetchText(url, timeoutMs = 9000) {
  try {
    const r = await fetchAllowlisted(url, {}, timeoutMs);
    const ct = r.headers.get('content-type') || '';
    const txt = await r.text();
    return { url, ok: true, ct, text: txt.slice(0, 12000) };
  } catch (e) {
    return { url, ok: false, error: e.message };
  }
}

function extractSnippets(pages) {
  const out = [];
  for (const p of pages) {
    if (!p.ok) {
      out.push({ url: p.url, note: `fetch failed: ${p.error}` });
      continue;
    }
    try {
      if (p.text.trim().startsWith('{')) {
        const j = JSON.parse(p.text);
        // Reddit listing
        const kids = j?.data?.children || j?.hits || [];
        const items = kids.slice(0, 6).map((k) => {
          const d = k.data || k;
          return `- ${String(d.title || d.text || '').slice(0, 220)}${d.subreddit ? ` (r/${d.subreddit})` : ''}${d.url ? ` <${d.url}>` : ''}`;
        });
        out.push({ url: p.url, items });
      } else {
        const noTags = p.text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        out.push({ url: p.url, excerpt: noTags.slice(0, 900) });
      }
    } catch {
      out.push({ url: p.url, excerpt: p.text.slice(0, 600) });
    }
  }
  return out;
}

function shortQuery(query) {
  const stop = new Set('research,which,what,who,how,when,where,that,these,those,with,from,about,into,over,under,people,say,they,them,their,there,here,please,find,out,investigate,analyze,analyse,social,media,sentiment,opinion,vote,voting,party,parties,swedish,sweden'.split(','));
  const words = String(query || '').toLowerCase().replace(/[^a-zåäö0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
  const short = words.slice(0, 5).join(' ').trim();
  return short || String(query || '').slice(0, 80);
}

function pickBrowserTargets(pages, sq) {
  // Ordered candidates: Wikipedia results, HN hit URLs, DDG sources, and as a
  // last resort the Wikipedia search page itself (a real rendered page).
  // browser_open enforces the allowlist; the caller tries each until one
  // renders, and cites honestly whatever was actually opened.
  const out = [];
  for (const p of pages) {
    if (!p.ok) continue;
    try {
      const j = JSON.parse(p.text);
      if (Array.isArray(j) && Array.isArray(j[3])) out.push(...j[3].filter(Boolean).map(String));
      if (Array.isArray(j.hits)) out.push(...j.hits.filter((h) => h && h.url).map((h) => String(h.url)));
      if (j.AbstractURL) out.push(String(j.AbstractURL));
      if (Array.isArray(j.Results)) out.push(...j.Results.filter((x) => x && x.FirstURL).map((x) => String(x.FirstURL)));
    } catch {}
  }
  if (sq) out.push(`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(sq)}`);
  return [...new Set(out)].slice(0, 4);
}

async function realResearch(query, hooks = {}) {
  const q = String(query || '').slice(0, 300);
  const sq = shortQuery(q);
  const urls = [
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(sq)}&tags=story&hitsPerPage=8`,
    `https://api.duckduckgo.com/?q=${encodeURIComponent(sq)}&format=json&no_html=1&skip_disambig=1`,
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(sq)}&limit=5&format=json`,
  ];
  const pages = await Promise.all(urls.map((u) => fetchText(u)));
  const snippets = extractSnippets(pages);
  // Real browser use: open the top result in headless Chromium so the
  // briefing is grounded in a rendered page, not just API JSON.
  // Live session first (streamed + interruptible); one-shot headless as fallback.
  let opened = null;
  const live = require('./agents/live');
  const { TOOLS } = require('./agents/tools');
  const ctx = { trace: (e) => hooks.onTrace && hooks.onTrace(e), githubPat: null, userId: hooks.userId || 'local' };
  const targets = pickBrowserTargets(pages, sq);
  try {
    const s = await live.start({ userId: ctx.userId, trace: ctx.trace });
    for (const target of targets) {
      try {
        await live.navigate(s, target, ctx.trace);
        const c = await live.content(s);
        let screenshot = null;
        try {
          const buf = await s.page.screenshot({ type: 'jpeg', quality: 40 });
          if (buf.length <= 220000) screenshot = 'data:image/jpeg;base64,' + buf.toString('base64');
        } catch {}
        opened = { url: c.url, title: c.title, liveId: s.id, live: true, screenshot };
        snippets.push({ url: c.url, renderedTitle: c.title, excerpt: String(c.text || '').slice(0, 900) });
        break;
      } catch (e) {
        if (hooks.onTrace) hooks.onTrace({ ic: 'alert', t: `live navigate skipped ${target.slice(0, 60)} (${e.code || e.message})` });
      }
    }
    if (!opened) await live.stop(s);
  } catch (e) {
    if (hooks.onTrace) hooks.onTrace({ ic: 'alert', t: 'live session unavailable, one-shot browser fallback' });
  }
  if (!opened) {
    for (const target of targets) {
      try {
        opened = await TOOLS.browser_open.run({ url: target }, ctx);
        snippets.push({ url: opened.url, renderedTitle: opened.title, excerpt: String(opened.text || '').slice(0, 900) });
        break;
      } catch (e) {
        if (hooks.onTrace) hooks.onTrace({ ic: 'alert', t: `browser_open skipped ${target.slice(0, 60)} (${e.code || e.message})` });
      }
    }
  }
  if (!opened) snippets.push({ note: 'no candidate page rendered in the real browser — briefing uses API data only' });

  let summary = '';
  let usage = null;
  try {
    const sys = 'You are Arche 1.0 by Belna, a careful research assistant. IDENTITY: always identify as Arche 1.0, never as any other model. HONESTY: Summarize ONLY what the fetched snippets support. Never simulate, fake, invent vote shares, sample sizes, or quotes. List sources with URLs. If evidence is thin, say so plainly. PRIVACY: never reveal other users, safety data, or company internals.';
    const prompt = `User question: ${q}\n\nFetched evidence (JSON):\n${JSON.stringify(snippets).slice(0, 9000)}\n\nWrite a concise, honest briefing: what the public sources actually say, key threads to read, and what is NOT proven. End with 3 concrete links to open.`;
    const r = await callGemini({ prompt, system: sys });
    summary = r.text;
    usage = r.usage;
  } catch (e) {
    summary = `I fetched ${pages.filter((p) => p.ok).length}/${pages.length} live sources, but the AI summarizer is unavailable (${e.message}). Open the sources directly:\n` + urls.map((u) => `- ${u}`).join('\n');
  }
  return { query: q, sources: urls, snippets, summary, usage, opened: opened ? { url: opened.url, title: opened.title, screenshot: opened.screenshot || null, liveId: opened.liveId || null, live: !!opened.liveId } : null, fetchedAt: new Date().toISOString() };
}

module.exports = { realResearch };
