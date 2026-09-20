import { useEffect, useRef } from "react";

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function DebtClock() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let debt = 40047425768420;
    let asOf = Date.now();
    let perSec = 180000;
    let timer = 0;
    let live = true;

    const paint = () => {
      const n = debt + perSec * Math.max(0, (Date.now() - asOf) / 1000);
      if (ref.current) ref.current.textContent = `$${fmt.format(Math.round(n))}`;
    };

    fetch("/api/debt")
      .then((r) => r.json())
      .then((d: { debt?: number; asOf?: number; perSec?: number }) => {
        if (!live) return;
        if (typeof d.debt === "number") debt = d.debt;
        if (typeof d.asOf === "number") asOf = d.asOf;
        if (typeof d.perSec === "number" && d.perSec > 0) perSec = d.perSec;
        paint();
      })
      .catch(() => undefined);

    paint();
    timer = window.setInterval(paint, 250);
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        window.clearInterval(timer);
        timer = 0;
      } else if (!timer) {
        paint();
        timer = window.setInterval(paint, 250);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono text-[10px] tracking-wide" title="U.S. Treasury debt to the penny">
      <span className="tracking-widest text-faint uppercase">US Debt</span>
      <span ref={ref} className="tabular text-muted">
        —
      </span>
    </span>
  );
}
