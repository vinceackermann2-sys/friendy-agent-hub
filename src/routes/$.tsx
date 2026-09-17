import { createFileRoute, notFound } from "@tanstack/react-router";

/**
 * Catch-all route: redirects clean URLs (/pricing, /research, etc.)
 * to their static HTML counterparts (/pricing.html, /research.html).
 * Unknown paths fall through to TanStack's 404 component.
 */
const PAGES = new Set([
  "pricing",
  "research",
  "research-arche-1-0",
  "research-100m",
  "research-stlm-sla",
  "terms",
  "privacy",
  "security",
  "cookies",
]);

export const Route = createFileRoute("/$")({
  beforeLoad: ({ params }) => {
    const slug = (params as Record<string, string>)["_splat"] || "";
    if (PAGES.has(slug)) {
      // Server: 301 redirect; Client: full navigation to the static .html page
      throw new Response(null, {
        status: 301,
        headers: { Location: `/${slug}.html` },
      });
    }
    throw notFound();
  },
  component: () => null,
});
