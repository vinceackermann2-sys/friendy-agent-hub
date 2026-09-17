/**
 * Serves a static HTML document at a clean URL (e.g. /pricing instead of
 * /pricing.html) and rewrites internal ".html" links to their clean form.
 */
export function cleanHtml(html: string): string {
  return html.replace(/href="([^"]+)\.html"/g, (_m, path: string) => {
    if (/^https?:\/\//i.test(path)) {
      return `href="${path.replace(/\/index$/, "/")}"`;
    }
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `href="${normalized}"`;
  });
}

export function htmlResponse(html: string): Response {
  return new Response(cleanHtml(html), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
