import { createFileRoute } from "@tanstack/react-router";
import html from "../../public/withdrawal.html?raw";
import { htmlResponse } from "@/lib/static-page";

export const Route = createFileRoute("/withdrawal")({
  server: { handlers: { GET: () => htmlResponse(html) } },
});
