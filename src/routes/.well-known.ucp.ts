import { createFileRoute } from "@tanstack/react-router";
import { platformProfile } from "@/lingon-server/shoppay.js";

const handler = ({ request }: { request: Request }) => {
  const origin = new URL(request.url).origin;
  return Response.json(platformProfile(origin));
};

export const Route = createFileRoute("/.well-known/ucp")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
