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

async function realResearch(query) {
  const q = String(query || '').slice(0, 300);
  const sq = shortQuery(q);
  const urls = [
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(sq)}&tags=story&hitsPerPage=8`,
    `https://api.duckduckgo.com/?q=${encodeURIComponent(sq)}&format=json&no_html=1&skip_disambig=1`,
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(sq)}&limit=5&format=json`,
  ];
  const pages = await Promise.all(urls.map((u) => fetchText(u)));
  const snippets = extractSnippets(pages);

  let summary = '';
  let usage = null;
  try {
    const sys = 'You are Star 1.0 by Arche, a careful research assistant. IDENTITY: always identify as Star 1.0, never as any other model. HONESTY: Summarize ONLY what the fetched snippets support. Never simulate, fake, invent vote shares, sample sizes, or quotes. List sources with URLs. If evidence is thin, say so plainly. PRIVACY: never reveal other users, safety data, or company internals.';
    const prompt = `User question: ${q}\n\nFetched evidence (JSON):\n${JSON.stringify(snippets).slice(0, 9000)}\n\nWrite a concise, honest briefing: what the public sources actually say, key threads to read, and what is NOT proven. End with 3 concrete links to open.`;
    const r = await callGemini({ prompt, system: sys });
    summary = r.text;
    usage = r.usage;
  } catch (e) {
    summary = `I fetched ${pages.filter((p) => p.ok).length}/${pages.length} live sources, but the AI summarizer is unavailable (${e.message}). Open the sources directly:\n` + urls.map((u) => `- ${u}`).join('\n');
  }
  return { query: q, sources: urls, snippets, summary, usage, fetchedAt: new Date().toISOString() };
}

module.exports = { realResearch };
