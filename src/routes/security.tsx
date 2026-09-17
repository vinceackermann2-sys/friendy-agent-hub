import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/security.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/security")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
