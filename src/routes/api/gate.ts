import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/gate")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: false }, { status: 404 }),
      POST: () => Response.json({ ok: false }, { status: 404 }),
    },
  },
});
