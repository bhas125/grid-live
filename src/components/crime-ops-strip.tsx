import { CoachLine, useCrimeCoaches } from "./crime-tips";
import { cn, fmtNum } from "@/lib/utils";

function Skel({ className }: { className?: string }) {
  return <span className={cn("inline-block h-3 w-6 animate-pulse bg-elevated", className)} />;
}

export function CrimeOpsStrip({
  hom,
  sht,
  lead,
  ready,
  isolated,
  onIsolateHom,
  drillTick,
}: {
  hom: number;
  sht: number;
  lead: number;
  ready: boolean;
  isolated: boolean;
  onIsolateHom: () => void;
  drillTick: number;
}) {
  const { isolate, drill, dismissIsolate, dismissDrill } = useCrimeCoaches(drillTick);
  const sum = hom + sht;

  return (
    <div data-crime-ops>
      <div className="flex flex-wrap items-center gap-1">
        <span className="inline-flex h-6 items-center gap-1 border border-hot/40 bg-hot/10 px-1.5 font-mono text-[10px] tracking-widest text-hot uppercase">
          HOM {ready ? fmtNum(hom) : <Skel className="bg-hot/20" />}
        </span>
        <span className="inline-flex h-6 items-center gap-1 border border-watch/40 bg-watch/10 px-1.5 font-mono text-[10px] tracking-widest text-watch uppercase">
          SHT {ready ? fmtNum(sht) : <Skel className="bg-watch/20" />}
        </span>
        <span className="inline-flex h-6 items-center gap-1 border border-lead/40 bg-lead/10 px-1.5 font-mono text-[10px] tracking-widest text-lead uppercase">
          LEAD {ready ? fmtNum(lead) : <Skel className="bg-lead/20" />}
        </span>
        {ready ? (
          <span className="inline-flex h-6 items-center border border-line px-1.5 font-mono text-[10px] tracking-widest text-faint uppercase">
            Σ {fmtNum(sum)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onIsolateHom}
          aria-pressed={isolated}
          title="Turn off SHT to isolate homicides"
          className={cn(
            "chip-press h-6 border px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
            isolated
              ? "border-hot bg-hot/15 text-hot"
              : "border-line bg-surface/90 text-faint hover:border-muted hover:text-muted",
          )}
        >
          Isolate HOM
        </button>
      </div>
      {isolate && !drill ? (
        <CoachLine
          text="SHT on = big bubbles · tap SHT chip to isolate HOM"
          onDismiss={dismissIsolate}
        />
      ) : null}
      {drill ? (
        <CoachLine text="Tap a county fill to drill · or open a feed row" onDismiss={dismissDrill} />
      ) : null}
    </div>
  );
}
