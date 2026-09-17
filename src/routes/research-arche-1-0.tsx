import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/research-arche-1-0.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/research-arche-1-0")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
