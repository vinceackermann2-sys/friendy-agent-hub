import { chromium } from "playwright";

const base = process.env.UI_BASE || "http://127.0.0.1:8080";
const browser = await chromium.launch();
const output = [];
const run = async (name, viewport, task, mockSession = false) => {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  if (mockSession) {
    await context.addInitScript(() => {
      localStorage.setItem(
        "lingon.session",
        JSON.stringify({
          access_token: "ui-audit",
          user: { id: "ui-audit", email: "ui-audit@example.invalid" },
        }),
      );
      localStorage.setItem(
        "lingon.v1",
        JSON.stringify({
          ownerId: "ui-audit",
          onboarded: true,
          agent: { name: "Audit", color: "lingon", pers: "Precise" },
          view: "chat",
          chats: [],
          vault: { secrets: [], apps: [], approvals: [], mode: "default" },
        }),
      );
    });
    await context.route("**/api/**", async (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await task(page);
    output.push({ name, ok: errors.length === 0, errors });
  } catch (e) {
    output.push({ name, ok: false, message: e.message, errors });
  }
  await context.close();
};
const mobile = { width: 390, height: 844 };

await run("home tabs and prompt", mobile, async (page) => {
  await page.goto(base);
  await page.locator('[data-act="landing-passport-tab"]').first().waitFor();
  for (const tab of ["mail", "wallet", "computer", "name"]) {
    await page.locator(`[data-passport-tab="${tab}"]`).click();
    if (await page.locator(`[data-passport-panel="${tab}"]`).isHidden())
      throw Error(`${tab} panel hidden`);
  }
  if ((await page.locator("#lform").getByRole("button", { name: "Attach files" }).count()) !== 1)
    throw Error("landing attachment control is not accessible");
  const chooser = page.waitForEvent("filechooser");
  await page.locator('#lform [data-act="attach"]').click();
  await chooser;
  await page.locator("#lprompt").fill("Test the agent");
  await page.locator('#lform button[type="submit"]').click();
  await page.locator("#aemail").waitFor();
  if (
    !(await page
      .locator("body")
      .innerText()
      .then((t) => t.includes("Test the agent")))
  )
    throw Error("prompt lost");
  await page.locator('[data-act="back-home"]').click();
  await page.locator("#lprompt").waitFor();
  output.push({ name: "home back route", url: page.url() });
});

await run("home get started", mobile, async (page) => {
  await page.goto(base);
  await page.locator('.anav [data-act="open-app"]').click();
  await page.waitForURL("**/app");
  await page.locator("#aemail").waitFor();
});

await run("auth controls", mobile, async (page) => {
  await page.goto(base + "/app");
  await page.locator("#aemail").waitFor();
  await page.locator('[data-act="auth-mode"]').click();
  await page.locator('[data-act="pw-mode"]').click();
  await page.locator("#apass").waitFor({ state: "visible" });
  if ((await page.locator("#pwgo").innerText()) !== "Create account")
    throw Error("signup mode lost");
  await page.locator('[data-act="auth-back"]').last().click();
  await page.locator("#aemail").waitFor({ state: "visible" });
  await page.locator('[data-act="otp-send"]').click();
  if (!(await page.locator("#amsg").innerText()).trim()) throw Error("empty email has no feedback");
  await page.locator('[data-act="back-home"]').click();
  await page.locator("#lprompt").waitFor();
  if (new URL(page.url()).pathname !== "/") throw Error("back-home kept app URL");
  output.push({ name: "auth back route", url: page.url() });
});

await run("research tabs", mobile, async (page) => {
  await page.goto(base + "/research");
  await page.locator('[data-view-tab="research"]').click();
  if (await page.locator("#research-panel").isHidden()) throw Error("research tab hidden");
  await page.locator('[data-view-tab="active"]').click();
  if (await page.locator("#active-panel").isHidden()) throw Error("active tab hidden");
  await page.locator(".rx-post").first().click();
  await page.waitForURL("**/research-arche-1-0");
});

await run("pricing CTA", mobile, async (page) => {
  for (let i = 0; i < 3; i++) {
    await page.goto(base + "/pricing");
    await page.locator(".pcard a").nth(i).click();
    await page.waitForURL("**/#cta");
    await page.locator("#cta").waitFor();
    await page.waitForTimeout(300);
    const pos = await page
      .locator("#cta")
      .evaluate((el) => ({ top: el.getBoundingClientRect().top, y: scrollY }));
    if (pos.top > 160 || pos.y < 100) throw Error(`pricing CTA ${i} did not scroll into view`);
  }
});

await run("product anchor", { width: 1024, height: 768 }, async (page) => {
  await page.goto(base + "/pricing");
  await page.locator('.navlinks a[href="/#agent"]').click();
  await page.waitForURL("**/#agent");
  await page.locator("#lprompt").waitFor();
  await page.waitForTimeout(250);
  const pos = await page
    .locator("#agent")
    .evaluate((el) => ({ top: el.getBoundingClientRect().top, y: scrollY }));
  if (pos.top > 220 || pos.y < 100) throw Error(`product anchor at ${JSON.stringify(pos)}`);
});

await run("pricing sign in", { width: 768, height: 1024 }, async (page) => {
  await page.goto(base + "/pricing");
  await page.locator(".anav-cta .ghost").click();
  await page.waitForTimeout(1500);
  const authVisible = await page
    .locator("#aemail")
    .isVisible()
    .catch(() => false);
  if (new URL(page.url()).pathname !== "/app" || !authVisible)
    throw Error("sign in did not open auth route");
  output.push({ name: "pricing sign in destination", url: page.url(), authVisible });
});

await run("promo tabs and prompt", mobile, async (page) => {
  await page.goto(base + "/promo");
  for (const tab of ["mail", "wallet", "computer", "name"]) {
    await page.locator(`[data-passport-tab="${tab}"]`).click();
    if (await page.locator(`[data-passport-panel="${tab}"]`).isHidden())
      throw Error(`${tab} promo panel hidden`);
  }
  if ((await page.locator("#pform").getByRole("button", { name: "Attach files" }).count()) !== 1)
    throw Error("promo attachment control is not accessible");
  const chooser = page.waitForEvent("filechooser");
  await page.locator('#pform [data-act="attach"]').click();
  await chooser;
  await page.locator("#pprompt").fill("Book a reminder");
  await page.locator('#pform button[type="submit"]').click();
  await page.locator("#aemail").waitFor();
  if (
    !(await page
      .locator("body")
      .innerText()
      .then((t) => t.includes("Book a reminder")))
  )
    throw Error("promo prompt lost");
});

await run(
  "signed in shell",
  mobile,
  async (page) => {
    await page.goto(base + "/app");
    await page.locator("#app").waitFor();
    const menu = async () => {
      await page.locator(".mobile-nav-toggle").click();
      if (!(await page.locator("#app").evaluate((el) => el.classList.contains("mobile-nav-open"))))
        throw Error("mobile menu failed");
    };
    const check = async (view) => {
      await page.waitForTimeout(250);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      if (width > 390) throw Error(`${view} width ${width}`);
      output.push({
        name: `signed in ${view}`,
        heading: await page
          .locator("#main")
          .innerText()
          .then((t) => t.slice(0, 70)),
      });
    };
    await menu();
    await page.locator('[data-act="open-goals"]').click();
    await check("goals");
    await page.locator('[data-act="goal-cat"][data-c="health"]').click();
    await page.locator('[data-act="goal-create"]').count();
    await menu();
    await page.locator('[data-act="open-library"]').click();
    await check("library");
    await menu();
    await page.locator('[data-act="usermenu"]').click();
    await page.locator('[data-act="nav"][data-view="apps"]').click();
    await check("apps");
    await menu();
    await page.locator('[data-act="usermenu"]').click();
    await page.locator('[data-act="nav"][data-view="settings"]').click();
    await check("settings");
    for (const tab of ["secrets", "browser", "billing", "profiles"]) {
      await page.locator(`[data-act="stab"][data-t="${tab}"]`).click();
      await check(`settings ${tab}`);
    }
    await page.locator('#main [data-act="nav"][data-view="chat"]').click();
    await page.locator('[data-act="newchat"]').last().click();
    await page.locator("#cprompt").waitFor();
    if ((await page.locator("#cform").getByRole("button", { name: "Attach files" }).count()) !== 1)
      throw Error("chat attachment control is not accessible");
    const chooser = page.waitForEvent("filechooser");
    await page.locator('#cform [data-act="attach"]').click();
    await chooser;
    await check("chat");
    await page.locator('.chathead [data-act="togglecanvas"]').click();
    await page.locator("#canvas").waitFor({ state: "visible" });
    await check("canvas");
    await page.locator('[data-act="closecanvas"]').last().click({ force: true });
  },
  true,
);

for (const width of [320, 768, 1024]) {
  await run(
    `signed in responsive ${width}`,
    { width, height: width === 320 ? 700 : 1024 },
    async (page) => {
      await page.goto(base + "/app");
      await page.locator("#app").waitFor();
      const menu = async () => {
        if (width <= 760) await page.locator(".mobile-nav-toggle").click();
      };
      const check = async (view) => {
        await page.waitForTimeout(100);
        const result = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth,
          main: document.querySelector("#main")?.getBoundingClientRect().width,
        }));
        if (result.page > width || result.main > width)
          throw Error(`${view} overflow: ${JSON.stringify(result)}`);
      };
      await menu();
      await page.locator('[data-act="open-goals"]').click();
      await check("goals");
      await menu();
      await page.locator('[data-act="open-library"]').click();
      await check("library");
      await menu();
      await page.locator('[data-act="usermenu"]').click();
      await page.locator('[data-act="nav"][data-view="apps"]').click();
      await check("apps");
      await menu();
      await page.locator('[data-act="usermenu"]').click();
      await page.locator('[data-act="nav"][data-view="settings"]').click();
      await check("settings");
      for (const tab of ["secrets", "browser", "billing", "profiles"]) {
        await page.locator(`[data-act="stab"][data-t="${tab}"]`).click();
        await check(tab);
      }
      await page.locator('#main [data-act="nav"][data-view="chat"]').click();
      await page.locator('#main [data-act="newchat"]').click();
      await check("chat");
      await page.locator('.chathead [data-act="togglecanvas"]').click();
      await page.locator("#canvas").waitFor({ state: "visible" });
      await check("canvas");
    },
    true,
  );
}

await browser.close();
for (const row of output) console.log(JSON.stringify(row));
if (output.some((row) => row.ok === false)) process.exitCode = 1;
