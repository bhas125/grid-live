import { useEffect, useState } from "react";
import { X } from "lucide-react";

const TIP_ISOLATE = "grid-tip-isolate-hom";
const TIP_DRILL = "grid-tip-drill";

type TipId = "isolate" | "drill";

export function CrimeTips() {
  const [show, setShow] = useState<{ isolate: boolean; drill: boolean } | null>(null);

  useEffect(() => {
    try {
      setShow({
        isolate: localStorage.getItem(TIP_ISOLATE) !== "1",
        drill: localStorage.getItem(TIP_DRILL) !== "1",
      });
    } catch {
      setShow({ isolate: true, drill: true });
    }
  }, []);

  function dismiss(id: TipId) {
    const key = id === "isolate" ? TIP_ISOLATE : TIP_DRILL;
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    setShow((prev) => (prev ? { ...prev, [id]: false } : prev));
  }

  if (!show || (!show.isolate && !show.drill)) return null;

  return (
    <div
      data-crime-tips
      className="pointer-events-none absolute top-12 left-1/2 z-30 flex w-[min(92%,22rem)] -translate-x-1/2 flex-col gap-1"
    >
      {show.isolate ? (
        <TipCard
          text="Deselect SHT — or tap Isolate HOM — to see homicides without shooting bubbles."
          onDismiss={() => dismiss("isolate")}
        />
      ) : null}
      {show.drill ? (
        <TipCard
          text="Tap a county fill or a feed row to drill in. STATE returns to Tennessee."
          onDismiss={() => dismiss("drill")}
        />
      ) : null}
    </div>
  );
}

function TipCard({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="map-pop pointer-events-auto flex items-start gap-2 border border-line bg-elevated/95 px-2.5 py-2 shadow-glow">
      <p className="min-w-0 flex-1 font-mono text-[10px] leading-snug tracking-wide text-muted uppercase">
        {text}
      </p>
      <button
        type="button"
        aria-label="Dismiss tip"
        onClick={onDismiss}
        className="grid size-8 shrink-0 place-items-center text-faint hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
