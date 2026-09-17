import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/research-100m.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/research-100m")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
