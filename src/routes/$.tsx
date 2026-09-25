import { createFileRoute, notFound } from "@tanstack/react-router";
import { pageMeta } from "@/lib/seo";
export const Route = createFileRoute("/$")({
  head: () => ({
    meta: pageMeta({
      title: "Page not found | Belna",
      description: "This Belna page could not be found.",
      robots: "noindex, follow",
    }),
  }),
  beforeLoad: () => {
    throw notFound();
  },
  component: () => null,
});
