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
      { property: "og:url", content: "https://belna.se/" },
      { property: "og:site_name", content: "Belna" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Belna — Swedish Safe AI Agents" },
      {
        name: "twitter:description",
        content:
          "Arche 1.0 is your personal AI agent, built on open Kimi K3 weights with a harness designed for privacy and safety.",
      },
    ],
    links: [
      ...lingonHeadLinks,
      { rel: "canonical", href: "https://belna.se/" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://belna.se/#organization",
              name: "Belna",
              url: "https://belna.se/",
              slogan: "Swedish Safe AI Agents",
            },
            {
              "@type": "WebSite",
              "@id": "https://belna.se/#website",
              name: "Belna",
              url: "https://belna.se/",
              publisher: { "@id": "https://belna.se/#organization" },
            },
            {
              "@type": "SoftwareApplication",
              name: "Arche 1.0",
              url: "https://belna.se/app",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              description: "Personal AI agent built on open Kimi K3 weights with an agentic harness designed for privacy and safety.",
              publisher: { "@id": "https://belna.se/#organization" },
            },
          ],
        }),
      },
    ],
  }),
  component: LingonApp,
});
