(function exposeTaskRouting(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LingonTaskRouting = api;
})(typeof window !== "undefined" ? window : globalThis, function createTaskRouting() {
  const TASK_VERBS =
    /\b(research|investigate|analy[sz]e|review|build|create|make|design|write|draft|plan|compare|summari[sz]e|find|prepare|calculate|implement|fix|generate)\b/i;
  const ADJUSTMENT =
    /^(?:actually|instead|wait|hold on|change|update|revise|rewrite|shorten|expand|adjust|focus|only|also|add|include|exclude|remove|skip|don't|do not|make (?:it|this|that)|use |try |(?:can|could|would) you (?:change|add|include|exclude|focus|make|remove|use)|please (?:change|add|include|exclude|focus|make|remove|use))\b/i;
  const CANCEL =
    /^(?:stop|cancel|abort|pause|never ?mind|forget it|drop it)(?:\s+(?:that|this|it|this task|that task|the task|the work|working|researching|building|please))?[.!\s]*$/i;

  function taskKind(raw) {
    const text = String(raw || "").trim();
    const lower = text.toLowerCase();
    if (!text || CANCEL.test(text)) return null;
    if (
      /(research|investigate|find out|analy[sz]e|forum|reddit|social media|poll|sentiment|\bnews\b|\blatest\b|\brecent\b|up[- ]to[- ]date)/.test(
        lower,
      )
    )
      return "research";
    if (/(github|pull request|\bpr\b|\brepo\b|code review|merge request)/.test(lower))
      return "github";
    if (
      /(build|create|make|design|code).*(website|landing|page|site|dashboard|app|chart|graph|deck)/.test(
        lower,
      ) ||
      /(website|landing page|one-pager)/.test(lower)
    )
      return "build";
    if (/\b(?:new|another|separate) task\b/i.test(text)) return "general";
    if (TASK_VERBS.test(text) && !/^(?:what|why|when|where|who)\b/i.test(text)) return "general";
    return null;
  }

  function routeMessage(activeTask, raw) {
    const text = String(raw || "").trim();
    if (!activeTask || activeTask.status !== "running")
      return taskKind(text) ? "start-task" : "respond";
    if (CANCEL.test(text)) return "interrupt";
    if (ADJUSTMENT.test(text)) return "update-task";
    return taskKind(text) ? "new-chat" : "respond";
  }

  return {
    isAdjustment: (raw) => ADJUSTMENT.test(String(raw || "").trim()),
    isCancel: (raw) => CANCEL.test(String(raw || "").trim()),
    isTask: (raw) => !!taskKind(raw),
    routeMessage,
    taskKind,
  };
});
