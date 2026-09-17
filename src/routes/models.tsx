import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/models.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/models")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
