import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/app-return.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/app-return")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
