import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn, fmtNum } from "@/lib/utils";
import type { CrimeLayers } from "@/data/types";

const TIPS_KEY = "grid-ux-tips-v1";

const TIPS = [
  "Tap Isolate HOM to hide SHT",
  "Tap a county fill or feed row to drill",
] as const;

export function IsolateHomButton({
  isolated,
  onToggle,
  className,
}: {
  isolated: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isolated}
      aria-label={isolated ? "Show shootings" : "Isolate homicides"}
      className={cn(
        "h-6 shrink-0 border px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
        isolated
          ? "border-hot bg-hot/20 text-hot"
          : "border-hot/50 bg-hot/10 text-hot hover:bg-hot/20",
        className,
      )}
    >
      {isolated ? "Show SHT" : "Isolate HOM"}
    </button>
  );
}

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
    <div
      className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5"
      data-crime-ops
    >
      <span className="font-mono text-[11px] tracking-widest text-faint uppercase">{windowLabel}</span>
      {ready ? (
        <>
          <span className={cn("font-mono text-[13px] tracking-widest tabular uppercase", layers.hom ? "text-hot" : "text-faint")}>
            HOM {fmtNum(hom)}
          </span>
          <span className={cn("font-mono text-[13px] tracking-widest tabular uppercase", layers.sht ? "text-watch" : "text-faint")}>
            SHT {fmtNum(sht)}
          </span>
          <span className={cn("font-mono text-[13px] tracking-widest tabular uppercase", layers.cad ? "text-lead" : "text-faint")}>
            LEAD {fmtNum(lead)}
          </span>
        </>
      ) : (
        <span className="font-mono text-[13px] tracking-widest text-faint uppercase">
          HOM · SHT · LEAD
        </span>
      )}
      <IsolateHomButton
        isolated={!layers.sht}
        onToggle={onIsolateHom}
        className="ml-auto"
      />
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
      className="flex items-start gap-2 border-t border-line px-3 py-1.5"
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
