import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/terms.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/terms")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
