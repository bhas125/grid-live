import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GridApp } from "@/components/grid-app";
import { releaseStaleWorker } from "@/lib/crime-snap";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  useEffect(() => {
    try {
      localStorage.removeItem("grid-gate");
      sessionStorage.removeItem("grid-gate");
      localStorage.removeItem("bh_ok");
      sessionStorage.removeItem("bh_ok");
    } catch {
      /* ignore */
    }
    void releaseStaleWorker()
      .then((reload) => {
        if (reload) window.location.reload();
      })
      .catch(() => undefined);
  }, []);
  return <GridApp />;
}
