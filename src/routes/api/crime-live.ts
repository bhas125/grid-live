import { createFileRoute } from "@tanstack/react-router";
import { readLiveCrime } from "@/lib/crime-store";

export const Route = createFileRoute("/api/crime-live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const since = u.searchParams.get("since") ?? undefined;
        const incidents = (await readLiveCrime(since)).filter(
          (r) => r.source !== "MNPD_CAD" && r.type !== "Dispatch",
        );
        return Response.json(
          { incidents },
          { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } },
        );
      },
    },
  },
});
