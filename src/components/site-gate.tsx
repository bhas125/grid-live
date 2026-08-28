import { useEffect, useState } from "react";

export function SiteGate({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

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
      if (e.data && (e.data as { bh?: number }).bh === 1) setOpen(true);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  if (open) return <>{children}</>;

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
