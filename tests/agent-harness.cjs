const assert = require("node:assert/strict");
const { currentTimeAnswer, runtimeClock } = require("../server/agents/runner");
const { hostAllowed } = require("../server/harness");
const { fetchAllowlisted } = require("../server/agents/sandbox");
const { eventMatches, nextRunAt, normalizeSubAgent } = require("../server/agents/triggers");
const { pickTools } = require("../server/agents/tools");

async function main() {
  await import("../app/task-routing.js");
  const { routeMessage, taskKind } = globalThis.LingonTaskRouting;
  const now = new Date("2026-09-17T12:34:56.000Z");
  const answer = currentTimeAnswer("What year is it?", now);
  assert.match(answer, /September 17, 2026/);
  assert.match(answer, /12:34:56 UTC/);
  assert.match(currentTimeAnswer("What's today's date?", now), /2026/);
  assert.equal(currentTimeAnswer("What is the time complexity?", now), null);
  assert.match(runtimeClock(now), /authoritative current date is Thursday, September 17, 2026/);

  assert.equal(hostAllowed("https://en.wikipedia.org/wiki/Lingonberry"), true);
  assert.equal(hostAllowed("http://en.wikipedia.org/wiki/Lingonberry"), false);
  assert.equal(hostAllowed("https://example.com/"), false);

  const scheduled = normalizeSubAgent({ name: "Daily brief", prompt: "Summarize changes", trigger: { type: "schedule", intervalMinutes: 60 } });
  assert.equal(scheduled.trigger.intervalMinutes, 60);
  assert.equal(nextRunAt(scheduled.trigger, now.getTime()), "2026-09-17T13:34:56.000Z");
  assert.equal(eventMatches({ type: "app", app: "github", event: "pull_request.changed" }, { type: "app", app: "github", event: "pull_request.changed" }), true);
  assert.equal(eventMatches({ type: "subagent", sourceAgentId: "a" }, { type: "subagent", sourceAgentId: "b", event: "completed" }), false);
  assert.throws(() => normalizeSubAgent({ name: "Too fast", prompt: "Check", trigger: { type: "schedule", intervalMinutes: 1 } }), /between 5/);
  assert.deepEqual(pickTools("schedule a sub agent automation").map((tool) => tool.name).sort(), ["capability_search", "memory_write", "trigger_create", "trigger_list", "web_search"]);
  const picked = (task) => pickTools(task).map((tool) => tool.name);
  assert.ok(picked("build a landing page for our cafe").includes("web_search"), "every task can look things up");
  assert.ok(picked("Boka ett bord på restaurangens hemsida").includes("browser_open"), "Swedish browser request");
  assert.ok(picked("Søk på nettsiden og logg inn").includes("browser_open"), "Norwegian browser request");
  assert.ok(picked("Bitte das Formular auf der Webseite ausfüllen").includes("browser_open"), "German browser request");
  assert.ok(picked("Réserve une table et remplis le formulaire").includes("browser_open"), "French browser request");
  assert.ok(picked("Rellena el formulario en el sitio web").includes("browser_open"), "Spanish browser request");
  assert.ok(picked("Kör det här Python-skriptet").includes("code_run"), "Swedish code request");
  assert.ok(picked("Läs min inkorg").includes("mail_list"), "Swedish mail request");
  assert.ok(picked("Kom ihåg att jag föredrar te").includes("memory_search"), "Swedish memory request");
  assert.ok(picked("Vad pratade vi om igår?").includes("history_search"), "Swedish history request");
  assert.ok(picked("Påminn mig varje dag klockan åtta").includes("trigger_create"), "Swedish automation request");
  assert.ok(picked("Skapa en bild av en älg i skogen").includes("image_generate"), "Swedish image request");
  assert.ok(!picked("Förklara fotosyntes kort").includes("browser_open"), "plain questions stay small");

  const active = { status: "running", kind: "research" };
  assert.equal(routeMessage(active, "What sources are you checking?"), "respond");
  assert.equal(routeMessage(active, "Actually focus only on Swedish sources"), "update-task");
  assert.equal(routeMessage(active, "Can you make it shorter?"), "update-task");
  assert.equal(routeMessage(active, "Stop"), "interrupt");
  assert.equal(routeMessage(active, "Stop researching"), "interrupt");
  assert.equal(routeMessage(active, "Cancel this task"), "interrupt");
  assert.equal(routeMessage(active, "Build me a landing page"), "new-chat");
  assert.equal(routeMessage(null, "Build me a landing page"), "start-task");
  assert.equal(taskKind("Draft a concise launch announcement"), "general");
  assert.equal(taskKind("Browse the web for current Lingonberry nutrition guidance"), "research");
  assert.equal(taskKind("Search online for recent Swedish AI news"), "research");
  assert.equal(taskKind("Look up the latest public information about Stockholm"), "research");
  assert.equal(taskKind("Search GitHub pull requests for regressions"), "github");
  assert.equal(taskKind("Search my previous chats for the launch name"), null);
  assert.equal(taskKind("Do you have access to real-time live browsing?"), null);

  const realFetch = global.fetch;
  try {
    global.fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://api.github.com/user" },
      });
    await assert.rejects(
      fetchAllowlisted("https://en.wikipedia.org/wiki/Lingonberry"),
      (error) => error && error.code === "HOST_BLOCKED",
    );

    global.fetch = async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1));
    await assert.rejects(
      fetchAllowlisted("https://en.wikipedia.org/wiki/Lingonberry"),
      (error) => error && error.code === "BODY_TOO_LARGE",
    );
  } finally {
    global.fetch = realFetch;
  }

  console.log("agent harness: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
