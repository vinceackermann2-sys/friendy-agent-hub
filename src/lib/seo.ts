export const SITE_ORIGIN = "https://belna.se";
export const SOCIAL_IMAGE = `${SITE_ORIGIN}/social-card.png`;
export const SITE_TITLE = "Belna | Your personal AI agent";
export const SITE_DESCRIPTION =
  "Research, create files, and manage work with Belna, your personal AI agent. Connect apps and control access and approvals from your workspace.";

const SOCIAL_IMAGE_ALT = "Belna — your personal AI agent";

export function pageMeta({
  title,
  description,
  url,
  robots = "index, follow",
  locale = "en_US",
}: {
  title: string;
  description: string;
  url?: string;
  robots?: string;
  locale?: string;
}) {
  return [
    { title },
    { name: "description", content: description },
    { name: "robots", content: robots },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Belna" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    ...(url ? [{ property: "og:url", content: url }] : []),
    { property: "og:locale", content: locale },
    { property: "og:image", content: SOCIAL_IMAGE },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: SOCIAL_IMAGE_ALT },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: SOCIAL_IMAGE },
    { name: "twitter:image:alt", content: SOCIAL_IMAGE_ALT },
  ];
}
