import { chromium } from "playwright";

const base = process.env.UI_BASE || "http://127.0.0.1:8080";
const routes = [
  "/",
  "/app",
  "/pricing",
  "/research",
  "/research-arche-1-0",
  "/research-100m",
  "/research-stlm-sla",
  "/terms",
  "/privacy",
  "/security",
  "/cookies",
  "/promo",
];
const sizes = [
  { name: "small-mobile", width: 320, height: 700 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet-wide", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
];
const browser = await chromium.launch({ headless: true });
const results = [];
for (const size of sizes) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of routes) {
    errors.length = 0;
    const response = await page.goto(base + route, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(route === "/" || route === "/app" ? 2200 : 300);
    const state = await page.evaluate(() => {
      const visible = (element) => {
        const s = getComputedStyle(element);
        const r = element.getBoundingClientRect();
        return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
      };
      const controls = [
        ...document.querySelectorAll('a,button,[role="button"],[role="tab"],input[type="submit"]'),
      ]
        .filter(visible)
        .map((el) => ({
          tag: el.tagName,
          label: (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 55),
          href: el.getAttribute("href"),
          act: el.getAttribute("data-act"),
        }));
      const overflow = [...document.querySelectorAll("body *")]
        .filter(visible)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < -2 || r.right > innerWidth + 2;
        })
        .slice(0, 12)
        .map((el) => ({
          tag: el.tagName,
          cls: String(el.className).slice(0, 60),
          x: Math.round(el.getBoundingClientRect().left),
          right: Math.round(el.getBoundingClientRect().right),
        }));
      const signIn = document.querySelector('.anav-cta a[href="/app"]');
      return {
        title: document.title,
        h1: document.querySelector("h1")?.textContent?.trim().slice(0, 100),
        width: document.documentElement.scrollWidth,
        signInVisible: signIn ? visible(signIn) : null,
        controls,
        overflow,
      };
    });
    results.push({
      size: size.name,
      route,
      status: response?.status(),
      errors: [...errors],
      ...state,
    });
    if (
      process.env.UI_SCREENSHOTS === "1" &&
      size.name === "mobile" &&
      ["/", "/app", "/pricing", "/research", "/promo"].includes(route)
    ) {
      await page.screenshot({
        path: `test-results/ui-${size.name}-${route === "/" ? "home" : route.slice(1)}.png`,
        fullPage: true,
      });
    }
  }
  await context.close();
}
await browser.close();
const widths = Object.fromEntries(sizes.map((size) => [size.name, size.width]));
const failures = results.filter(
  (result) =>
    result.status !== 200 ||
    result.width > widths[result.size] ||
    result.errors.length ||
    (result.route !== "/app" && result.signInVisible !== true),
);
const linkedPaths = [
  ...new Set(
    results
      .flatMap((result) => result.controls.map((control) => control.href))
      .filter(Boolean)
      .map((href) => {
        const url = new URL(href, base);
        return url.origin === new URL(base).origin ? url.pathname : null;
      })
      .filter(Boolean),
  ),
];
for (const path of linkedPaths) {
  const response = await fetch(base + path);
  if (!response.ok)
    failures.push({ size: "link", route: path, status: response.status, width: null, errors: [] });
}
console.log(
  `UI route audit: ${routes.length} routes at ${sizes.length} viewport sizes, ${linkedPaths.length} internal link destinations; ${failures.length} failures.`,
);
for (const result of failures)
  console.error(
    JSON.stringify({
      size: result.size,
      route: result.route,
      status: result.status,
      width: result.width,
      signInVisible: result.signInVisible,
      errors: result.errors,
    }),
  );
if (process.env.UI_VERBOSE === "1")
  for (const result of results)
    console.log(
      JSON.stringify({
        size: result.size,
        route: result.route,
        status: result.status,
        width: result.width,
        controls: result.controls,
      }),
    );
if (failures.length) process.exitCode = 1;
