# Lingon — your personal agent

An app where every user **claims, names and customizes their own personal agent**,
then works with it through a chat full of rich action cards, with a **visual canvas**
on the right, separate **Apps** connections, and **Settings** for secrets and preferences.

Styling follows the reference screenshots: off-white surfaces, black pill buttons,
soft rounded cards, cute mascot characters, purple/lingon accents.

## Run it

```bash
cd app && python3 -m http.server 8000 --bind 0.0.0.0
```

Open `http://localhost:8000`. State (agent claim, chats, vault, memory) persists
in `localStorage`.

## The journey

1. **Landing** — website-compatible marketing page with the mascot sitting on the
   prompt box. Type anything: the agent answers inline, then invites you to claim it
   (your prompt is carried into your first real chat).
2. **Onboarding** — claim → name (dice for suggestions) → color + personality →
   safety briefing. Confetti on claim.
3. **Chat** — an always-available main agent delegates actionable work to
   cancellable sub-agents. Follow-ups can redirect or stop the active worker;
   unrelated tasks automatically open in a new chat. Includes streaming answers,
   tool traces, and cards for:
   approvals (approve / always-allow / deny), connect-app, **secrets box**,
   questions, sub-agents, browser use, sandboxed computer use, files, artifacts,
   memory saves.
4. **Canvas (right, chat-only)** — live artifacts, sandboxed HTML previews,
   diffs/code, plans and task activity. Artifact cards in chat carry inline previews.
5. **Apps** — connect multiple accounts to a supported app, inspect its available
   tools, and turn individual tool permissions on or off.
6. **Settings** — secrets, approvals, memory, files, profiles, billing and theme.
   Secrets remain masked (reveal is owner-only) and always-allow rules are revocable.
7. **Memory** — real working memory the agent reads and writes: it recalls relevant
   memories in answers, lists them on demand ("what do you remember?"), and remembers
   your choices; inspectable and deletable anytime.
8. **Profile** — rename, recolor, re-personality your agent; release it anytime.
9. **Sub Agents** — isolated automation chats in the right-side agent panel. A
   sub-agent can run on a schedule, on a real connected-app event, or after
   another sub-agent completes; chained handoffs are bounded by the harness.

## Safety model (the point of the app)

- Secret values are stored in the vault and **never enter model context, logs or
  traces** — the agent receives references like `sec_••••` only (watch the trace
  during the GitHub flow).
- Sensitive actions pause for approval unless explicitly always-allowed (revocable).
- Browser/computer/code run "in a sandboxed harness" with a visible trace.

## Architecture

- `mascot.js` — code-drawn recolorable **star** mascot (idle/happy/think/wave moods),
  also used as logo and floating chat status avatar.
- `engine.real.js` and `engine.managed.js` — browser adapters for the real
  server-side Gemini agent and managed task runtime. The server owns auth,
  tools, task state and the isolated Azure VM.
- `app.js` — state, router, chat/cards/canvas/vault UI, persistence.
- `styles.css` — the design system.

Demo scenarios to try from the composer:
*“Research Swedish party sentiment on social media”*, *“Review my GitHub pull
requests”*, *“Build me a landing page”*, *“Summarize my inbox”*,
*“Remember that I prefer concise answers”*, *“How do you keep me safe?”*
