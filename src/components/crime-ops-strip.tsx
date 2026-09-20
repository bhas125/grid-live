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
}: {
  hom: number;
  sht: number;
  lead: number;
  ready: boolean;
  isolated: boolean;
  onIsolateHom: () => void;
}) {
  return (
    <div data-crime-ops className="mt-1 flex flex-wrap items-center gap-1">
      <span className="inline-flex h-6 items-center gap-1 border border-hot/40 bg-hot/10 px-1.5 font-mono text-[10px] tracking-widest text-hot uppercase">
        HOM {ready ? fmtNum(hom) : <Skel className="bg-hot/20" />}
      </span>
      <span className="inline-flex h-6 items-center gap-1 border border-watch/40 bg-watch/10 px-1.5 font-mono text-[10px] tracking-widest text-watch uppercase">
        SHT {ready ? fmtNum(sht) : <Skel className="bg-watch/20" />}
      </span>
      <span className="inline-flex h-6 items-center gap-1 border border-lead/40 bg-lead/10 px-1.5 font-mono text-[10px] tracking-widest text-lead uppercase">
        LEAD {ready ? fmtNum(lead) : <Skel className="bg-lead/20" />}
      </span>
      <button
        type="button"
        onClick={onIsolateHom}
        aria-pressed={isolated}
        title="Turn off SHT to isolate homicides"
        className={cn(
          "h-6 border px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
          isolated
            ? "border-hot bg-hot/15 text-hot"
            : "border-line bg-surface/90 text-faint hover:border-muted hover:text-muted",
        )}
      >
        Isolate HOM
      </button>
    </div>
  );
}
