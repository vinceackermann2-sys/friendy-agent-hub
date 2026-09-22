import { createFileRoute } from "@tanstack/react-router";
import { LingonApp, lingonHeadLinks } from "@/components/LingonApp";

export const Route = createFileRoute("/promo")({
  head: () => ({
    meta: [
      { title: "Belna — Så här får du veckan att gå runt" },
      {
        name: "description",
        content:
          "Belna är den första agenten som kan sköta handlingen, fakturorna och barnens schema. Du äger din AI-agent — säker, svensk och alltid under din kontroll.",
      },
      // Hidden landing page: never indexed, never in sitemap, never linked
      // from the main site. Only reachable via the exact /promo URL.
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Belna — Så här får du veckan att gå runt" },
      {
        property: "og:description",
        content:
          "Städa, hämta, lämna, handla — tar det någonsin slut? Möt Belna, din egen mini-superman.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      ...lingonHeadLinks,
      { rel: "canonical", href: "https://belna.se/promo" },
    ],
  }),
  component: LingonApp,
});
