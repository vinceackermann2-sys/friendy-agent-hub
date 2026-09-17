import type React from "react";
import { useEffect } from "react";

const SCRIPTS = [
  "/lingon/config.js",
  "/lingon/auth.js",
  "/lingon/mascot.js",
  "/lingon/task-routing.cjs",
  "/lingon/engine.real.js",
  "/lingon/app.js",
];

export const lingonHeadLinks: Array<
  React.DetailedHTMLProps<React.LinkHTMLAttributes<HTMLLinkElement>, HTMLLinkElement>
> = [
  { rel: "stylesheet", href: "/lingon/styles.css" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap",
  },
  {
    rel: "icon",
    href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Ccircle cx='60' cy='70' r='42' fill='%234A7FD4'/%3E%3Cpath d='M53 14q-16-9-27 1 11 11 27-1Z' fill='%235F9E63'/%3E%3C/svg%3E",
  },
];

export function LingonApp() {
  useEffect(() => {
    let cancelled = false;
    const load = (src: string) =>
      new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(`script[data-lingon="${src}"]`);
        if (existing) return resolve();
        const el = document.createElement("script");
        el.src = src;
        el.async = false;
        el.dataset["lingon"] = src;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.body.appendChild(el);
      });

    (async () => {
      for (const src of SCRIPTS) {
        if (cancelled) return;
        await load(src);
      }
    })().catch((e) => console.error(e));

    return () => {
      cancelled = true;
    };
  }, []);

  return <div id="root" />;
}

export default LingonApp;
