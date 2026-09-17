import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/cookies.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/cookies")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
