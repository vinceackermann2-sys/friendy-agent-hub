import { createFileRoute } from "@tanstack/react-router";
import app from "@/lingon-server/index.js";

const handler = ({ request }: { request: Request }) => app.handle(request);

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
    },
  },
});
