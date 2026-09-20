import { createFileRoute, notFound } from "@tanstack/react-router";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["belna-100m.zip", "belna-stlm-sla.zip"]);

export const Route = createFileRoute("/research-code/$")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const name = String((params as { _splat?: string })._splat || "");
        if (!ALLOWED.has(name)) throw notFound();
        const filePath = join(process.cwd(), "public", "research-code", name);
        if (!existsSync(filePath)) throw notFound();
        return new Response(readFileSync(filePath), {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${name}"`,
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
