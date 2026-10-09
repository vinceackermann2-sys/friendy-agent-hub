import { createFileRoute } from "@tanstack/react-router";
import { LingonApp, lingonHeadLinks, lingonHeadScripts } from "@/components/LingonApp";
import {
  pageMeta,
  SITE_DESCRIPTION,
  SITE_ORIGIN,
  SITE_TITLE,
  SOCIAL_IMAGE,
} from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: pageMeta({ title: SITE_TITLE, description: SITE_DESCRIPTION, url: `${SITE_ORIGIN}/` }),
    links: [
      ...lingonHeadLinks,
      { rel: "canonical", href: `${SITE_ORIGIN}/` },
    ],
    scripts: [
      ...lingonHeadScripts,
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${SITE_ORIGIN}/#organization`,
              name: "Belna",
              url: `${SITE_ORIGIN}/`,
              slogan: "Your personal AI agent",
            },
            {
              "@type": "WebSite",
              "@id": `${SITE_ORIGIN}/#website`,
              name: "Belna",
              url: `${SITE_ORIGIN}/`,
              description: SITE_DESCRIPTION,
              publisher: { "@id": "https://belna.se/#organization" },
            },
            {
              "@type": "SoftwareApplication",
              name: "Belna",
              alternateName: "Arche 1.0",
              url: `${SITE_ORIGIN}/app`,
              image: SOCIAL_IMAGE,
              applicationCategory: "ProductivityApplication",
              operatingSystem: "Web",
              description: SITE_DESCRIPTION,
              publisher: { "@id": "https://belna.se/#organization" },
            },
          ],
        }),
      },
    ],
  }),
  component: LingonApp,
});
