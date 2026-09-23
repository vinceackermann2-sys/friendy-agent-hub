import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/promo.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/promo")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
