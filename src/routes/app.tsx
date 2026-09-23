import { createFileRoute } from "@tanstack/react-router";
import { LingonApp, lingonHeadLinks } from "@/components/LingonApp";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Belna App — Your Arche 1.0 Personal AI Agent" },
      {
        name: "description",
        content:
          "Open the Belna app: chat with your Arche 1.0 agent, run research, build canvas artifacts and manage your sealed vault.",
      },
      { property: "og:title", content: "Belna App — Your Arche 1.0 Agent" },
      {
        property: "og:description",
        content:
          "Chat, research, build and keep secrets sealed — your personal Swedish safe AI agent.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      ...lingonHeadLinks,
      { rel: "canonical", href: "https://belna.se/app" },
    ],
  }),
  component: () => <LingonApp page="app" />,
});
