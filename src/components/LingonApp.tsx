import type React from "react";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    LingonAppRuntime?: { mount: (root: HTMLElement) => Promise<void> };
    __lingonBoot?: Promise<void>;
  }
}

const SCRIPTS = [
  "/lingon/config.js",
  "/lingon/auth.js",
  "/lingon/apple-native.js",
  "/lingon/mascot.js",
  "/lingon/task-routing.js",
  "/lingon/engine.real.js",
  "/lingon/engine.managed.js",
  "/lingon/app.js",
];

// All app scripts are added at once and run in order (async=false), so they download in
// parallel instead of one after another.
function loadScripts() {
  return Promise.all(
    SCRIPTS.map(
      (src) =>
        new Promise<void>((resolve, reject) => {
          const el = document.createElement("script");
          el.src = src;
          el.async = false;
          el.dataset["lingon"] = src;
          el.onload = () => resolve();
          el.onerror = () => reject(new Error(`Failed to load ${src}`));
          document.head.appendChild(el);
        }),
    ),
  ).then(() => undefined);
}

// Runs from the page head on a full page load: the app scripts start while React itself is
// still loading, and the app begins loading the account. It draws only when LingonApp
// hands it the host after hydration (LingonDeferMount), so React's markup is untouched.
// An async module never pauses HTML parsing (a classic inline script after the
// stylesheets would wait for them, fonts included). After a client-side navigation this
// script does not run and LingonApp loads the scripts itself.
export const lingonBootScript = `if(!window.__lingonBoot){window.LingonDeferMount=true;window.__lingonBoot=Promise.all(${JSON.stringify(SCRIPTS)}.map(src=>new Promise((ok,fail)=>{const e=document.createElement("script");e.src=src;e.async=false;e.dataset.lingon=src;e.onload=()=>ok();e.onerror=()=>fail(new Error("Failed to load "+src));document.head.appendChild(e)}))).then(()=>{})}`;

export const lingonHeadScripts = [{ type: "module", async: true, children: lingonBootScript }];

export const lingonHeadLinks: Array<
  React.DetailedHTMLProps<React.LinkHTMLAttributes<HTMLLinkElement>, HTMLLinkElement>
> = [
  { rel: "stylesheet", href: "/lingon/styles.css" },
  ...SCRIPTS.map((href) => ({ rel: "preload", href, as: "script" })),
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap",
  },
  {
    rel: "icon",
      href: "/favicon.svg",
  },
];

// Server-rendered for crawlers and link previews, but visually hidden so
// visitors see the app background instead of an unstyled page while
// the vanilla app scripts load.
const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

function CrawlableOverview({ page }: { page: "home" | "app" }) {
  return (
    <main style={visuallyHidden}>
      <nav aria-label="Public pages" style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 64 }}>
        <a href="/">Belna</a>
        <a href="/research">Research</a>
        <a href="/pricing">Pricing</a>
        <a href="/security">Security</a>
      </nav>
      {page === "home" ? (
        <>
          <h1>Bring anything to life with Belna</h1>
          <p>Belna is a personal AI agent that can research, build, and handle work for you. Arche 1.0 is built on open Kimi K3 weights inside an agentic harness designed for privacy and safety.</p>
          <section id="agent">
            <h2>One personal agent that does the work</h2>
            <p>Your agent has a personal identity, private mailbox, secure wallet, and its own computer, under your control.</p>
          </section>
          <section>
            <h2>Safe Swedish AI</h2>
            <p>Explore the <a href="/research-arche-1-0">Arche 1.0 model card</a>, read about our <a href="/security">security approach</a>, or see <a href="/pricing">plans and credits</a>.</p>
          </section>
          <p><a href="/app">Get started with your agent</a></p>
        </>
      ) : (
        <>
          <h1>Belna Arche 1.0 personal AI agent</h1>
          <p>Use your agent to chat, research, build artifacts, and manage private information. Sign in to access your own agent and its workspace.</p>
          <p>Learn about <a href="/">Belna</a>, <a href="/research">our research</a>, and <a href="/pricing">pricing</a>.</p>
        </>
      )}
      <footer style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 64 }}>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/cookies">Cookies</a>
        <a href="/withdrawal">Withdraw from a purchase</a>
        <a href="mailto:support@belna.se">support@belna.se</a>
      </footer>
    </main>
  );
}

export function LingonApp({ page = "home" }: { page?: "home" | "app" }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      window.__lingonBoot ??= loadScripts();
      await window.__lingonBoot;
      if (cancelled || !host.current) return;
      if (!window.LingonAppRuntime) throw new Error("App did not initialize");
      await window.LingonAppRuntime.mount(host.current);
      if (!cancelled) setStatus("ready");
    })().catch((e) => {
      console.error(e);
      if (!cancelled) setStatus("error");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return <><div id="root" ref={host} />
    {status === "error" ? <div role="alert" style={{ padding: 32 }}>
      <p>We couldn’t open your agent. Your setup and saved request are still here.</p>
      <button onClick={() => window.location.reload()}>Try again</button>
    </div> : null}
    {status !== "ready" ? <CrawlableOverview page={page} /> : null}
  </>;
}

export default LingonApp;
