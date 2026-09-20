import { useEffect, useState } from "react";
import { X } from "lucide-react";

const TIP_ISOLATE = "grid-tip-isolate-hom";
const TIP_DRILL = "grid-tip-drill";

export function useCrimeCoaches(drillTick: number) {
  const [isolate, setIsolate] = useState(false);
  const [drill, setDrill] = useState(false);

  useEffect(() => {
    try {
      setIsolate(localStorage.getItem(TIP_ISOLATE) !== "1");
    } catch {
      setIsolate(true);
    }
  }, []);

  useEffect(() => {
    if (!isolate) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(TIP_ISOLATE, "1");
      } catch {
        /* ignore */
      }
      setIsolate(false);
    }, 2200);
    return () => window.clearTimeout(t);
  }, [isolate]);

  useEffect(() => {
    if (drillTick < 1) return;
    try {
      if (localStorage.getItem(TIP_DRILL) === "1") return;
    } catch {
      /* show */
    }
    setDrill(true);
  }, [drillTick]);

  function persist(key: string) {
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
  }

  function dismissIsolate() {
    persist(TIP_ISOLATE);
    setIsolate(false);
  }

  function dismissDrill() {
    persist(TIP_DRILL);
    setDrill(false);
  }

  return { isolate, drill, dismissIsolate, dismissDrill };
}

export function CoachLine({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <p
      data-crime-tips
      className="map-pop mt-0.5 flex max-w-[22rem] items-start gap-1 font-mono text-[10px] leading-snug tracking-wide text-muted uppercase"
    >
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        aria-label="Dismiss tip"
        onClick={onDismiss}
        className="grid size-6 shrink-0 place-items-center text-faint hover:text-fg"
      >
        <X className="size-3" />
      </button>
    </p>
  );
}
