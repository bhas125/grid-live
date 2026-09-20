import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn, fmtNum } from "@/lib/utils";
import type { CrimeLayers } from "@/data/types";

const TIPS_KEY = "grid-ux-tips-v1";

const TIPS = [
  "Deselect SHT to isolate HOM",
  "Tap a county fill or feed row to drill",
] as const;

export function CrimeOpsStrip({
  ready,
  hom,
  sht,
  lead,
  windowLabel,
  layers,
  onIsolateHom,
}: {
  ready: boolean;
  hom: number;
  sht: number;
  lead: number;
  windowLabel: string;
  layers: CrimeLayers;
  onIsolateHom: () => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" data-crime-ops>
      <span className="font-mono text-[10px] tracking-widest text-faint uppercase">{windowLabel}</span>
      {ready ? (
        <>
          <span className={cn("font-mono text-[10px] tracking-widest uppercase", layers.hom ? "text-hot" : "text-faint")}>
            HOM {fmtNum(hom)}
          </span>
          <span className={cn("font-mono text-[10px] tracking-widest uppercase", layers.sht ? "text-watch" : "text-faint")}>
            SHT {fmtNum(sht)}
          </span>
          <span className={cn("font-mono text-[10px] tracking-widest uppercase", layers.cad ? "text-lead" : "text-faint")}>
            LEAD {fmtNum(lead)}
          </span>
        </>
      ) : (
        <span className="font-mono text-[10px] tracking-widest text-faint uppercase">
          HOM · SHT · LEAD
        </span>
      )}
      {layers.hom && layers.sht ? (
        <button
          type="button"
          onClick={onIsolateHom}
          className="h-5 border border-hot/50 bg-hot/10 px-1.5 font-mono text-[10px] tracking-widest text-hot uppercase hover:bg-hot/20"
        >
          HOM only
        </button>
      ) : null}
    </div>
  );
}

export function CrimeFirstTips() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(TIPS_KEY) === "1") return;
      setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(TIPS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  if (!show) return null;

  return (
    <div
      data-crime-tips
      className="mt-1 flex max-w-md items-start gap-2 border border-line bg-elevated/90 px-2 py-1.5"
    >
      <ul className="min-w-0 flex-1 space-y-0.5 font-mono text-[10px] leading-snug tracking-wide text-muted">
        {TIPS.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <button
        type="button"
        aria-label="Dismiss tips"
        onClick={dismiss}
        className="grid size-7 shrink-0 place-items-center text-faint hover:text-fg"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
