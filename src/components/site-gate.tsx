import { useEffect, useRef, useState } from "react";
import { releaseStaleWorker } from "@/lib/crime-snap";

export function SiteGate({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [gateReady, setGateReady] = useState(false);
  const openRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.removeItem("grid-gate");
      sessionStorage.removeItem("grid-gate");
      localStorage.removeItem("bh_ok");
      sessionStorage.removeItem("bh_ok");
    } catch {
      /* ignore */
    }
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data && (e.data as { bh?: number }).bh === 1) {
        openRef.current = true;
        setOpen(true);
      }
    }
    window.addEventListener("message", onMsg);
    let cancelled = false;
    void releaseStaleWorker()
      .then((reload) => {
        // Settle the service-worker clear before the facade is shown. A reload
        // after unlock in this page life would drop the visitor back on the gate.
        if (cancelled || openRef.current) return;
        if (reload) {
          window.location.reload();
          return;
        }
        setGateReady(true);
      })
      .catch(() => {
        if (!cancelled && !openRef.current) setGateReady(true);
      });
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMsg);
    };
  }, []);

  if (open) return <>{children}</>;

  if (!gateReady) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#fff",
          zIndex: 2147483647,
        }}
      />
    );
  }

  return (
    <iframe
      title=""
      src="/gate.html"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
        background: "#fff",
        zIndex: 2147483647,
      }}
    />
  );
}
