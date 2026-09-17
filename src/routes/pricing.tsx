import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/pricing.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/pricing")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
