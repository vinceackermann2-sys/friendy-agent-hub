import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/research-stlm-sla.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/research-stlm-sla")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
