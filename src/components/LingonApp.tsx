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
    el.dataset.lingon = src;
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

export function LingonApp() {
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
    </div> : status === "loading" ? <p role="status" style={{ padding: 32 }}>Opening your agent…</p> : null}
  </>;
}

export default LingonApp;
