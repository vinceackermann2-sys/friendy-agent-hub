import { createFileRoute } from "@tanstack/react-router";
import { LingonApp, lingonHeadLinks } from "@/components/LingonApp";
import { pageMeta, SITE_ORIGIN } from "@/lib/seo";

const title = "Sign in to Belna | Your personal AI agent";
const description =
  "Sign in to access your Belna agent, chat history, files, connected apps, and workspace settings.";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: pageMeta({
      title,
      description,
      url: `${SITE_ORIGIN}/app`,
      robots: "noindex, follow",
    }),
    links: [
      ...lingonHeadLinks,
      { rel: "canonical", href: `${SITE_ORIGIN}/app` },
    ],
  }),
  component: () => <LingonApp page="app" />,
});
