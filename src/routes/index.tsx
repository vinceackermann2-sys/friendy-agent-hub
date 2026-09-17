import { createFileRoute } from "@tanstack/react-router";
import { LingonApp, lingonHeadLinks } from "@/components/LingonApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Belna — Swedish Safe AI Agents | Arche 1.0 Personal AI Agent" },
      {
        name: "description",
        content:
          "Belna builds Swedish safe AI agents. Arche 1.0 is built on the open-source Kimi K3 model with an agentic harness optimized for privacy and safety.",
      },
      { property: "og:title", content: "Belna — Swedish Safe AI Agents" },
      {
        property: "og:description",
        content:
          "Arche 1.0: Swedish safe AI agents built on open-source Kimi K3. Your personal AI agent — if you can think it, your agent can make it real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: lingonHeadLinks,
  }),
  component: LingonApp,
});
