import { createFileRoute } from "@tanstack/react-router";
import incidents from "../../../public/crime-tn.json";

/** Built with this deploy. A new URL so a browser Cache entry for /crime-tn.json cannot satisfy it. */
const body = JSON.stringify(incidents);

export const Route = createFileRoute("/api/crime-snap")({
  server: {
    handlers: {
      GET: async () =>
        new Response(body, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "private, no-store, max-age=0",
            "cdn-cache-control": "no-store",
            "vercel-cdn-cache-control": "no-store",
          },
        }),
    },
  },
});
