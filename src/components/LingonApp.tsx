import type React from "react";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    LingonAppRuntime?: { mount: (root: HTMLElement) => Promise<void> };
  }
}

const scriptLoads = new Map<string, Promise<void>>();

function loadScript(src: string) {
  const pending = scriptLoads.get(src);
  if (pending) return pending;
  const request = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    el.dataset["lingon"] = src;
    el.onload = () => resolve();
    el.onerror = () => {
      el.remove();
      scriptLoads.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    document.body.appendChild(el);
  });
  scriptLoads.set(src, request);
  return request;
}

const SCRIPTS = [
  "/lingon/config.js",
  "/lingon/auth.js",
  "/lingon/mascot.js",
  "/lingon/task-routing.js",
  "/lingon/engine.real.js",
  "/lingon/engine.managed.js",
  "/lingon/app.js",
];

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

function CrawlableOverview({ page }: { page: "home" | "app" }) {
  return (
    <main style={{ maxWidth: 900, margin: "64px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif" }}>
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
      for (const src of SCRIPTS) {
        if (cancelled) return;
        await loadScript(src);
      }
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
