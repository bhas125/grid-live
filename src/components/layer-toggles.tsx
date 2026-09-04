import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CrimeAgency,
  CrimeAgencies,
  CrimeKind,
  CrimeLayers,
  CrimeWindow,
  LayerId,
  Layers,
  RaceLayers,
  RaceSlice,
} from "@/data/types";
import { AGENCY_META, CRIME_META, RACE_META, WINDOW_META } from "@/data/types";

const CRIME_TYPE_META = CRIME_META.filter((item) => item.id !== "h48");
const H48_META = CRIME_META.find((item) => item.id === "h48")!;

const ITEMS: { id: LayerId; label: string }[] = [
  { id: "interstates", label: "Roads" },
  { id: "weather", label: "Weather" },
  { id: "sites", label: "Data Cent." },
  { id: "flock", label: "Flock" },
  { id: "cameras", label: "Traffic Cam" },
  { id: "flights", label: "Flights" },
  { id: "dispatch", label: "Dispatch" },
  { id: "house", label: "House" },
];

export function LayerToggles({
  layers,
  onToggle,
  raceLayers,
  onToggleRace,
  crimeLayers,
  onToggleCrime,
  crimeAgency,
  onToggleAgency,
  crimeWindow,
  onCrimeWindow,
}: {
  layers: Layers;
  onToggle: (id: LayerId) => void;
  raceLayers: RaceLayers;
  onToggleRace: (id: RaceSlice) => void;
  crimeLayers: CrimeLayers;
  onToggleCrime: (id: CrimeKind) => void;
  crimeAgency: CrimeAgencies;
  onToggleAgency: (id: CrimeAgency) => void;
  crimeWindow: CrimeWindow;
  onCrimeWindow: (id: CrimeWindow) => void;
  zoomed?: boolean;
}) {
  const [raceOpen, setRaceOpen] = useState(layers.race);
  const [crimeOpen, setCrimeOpen] = useState(layers.crime);

  useEffect(() => {
    if (layers.race) setRaceOpen(true);
    else setRaceOpen(false);
  }, [layers.race]);

  useEffect(() => {
    if (layers.crime) setCrimeOpen(true);
    else setCrimeOpen(false);
  }, [layers.crime]);

  return (
    <div className="pointer-events-auto min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {ITEMS.map((item) => {
          const on = layers[item.id];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item.id)}
              aria-pressed={on}
              className={cn(
                "h-6 min-w-0 shrink-0 border px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
                on
                  ? "border-grid bg-grid/15 text-grid"
                  : "border-line bg-surface/90 text-faint hover:border-muted hover:text-muted",
              )}
            >
              {item.label}
            </button>
          );
        })}
        <ExpandChip
          label="Crime"
          on={layers.crime}
          open={crimeOpen}
          onToggle={() => onToggle("crime")}
          onOpen={() => setCrimeOpen((v) => !v)}
        />
        <ExpandChip
          label="Race"
          on={layers.race}
          open={raceOpen}
          onToggle={() => onToggle("race")}
          onOpen={() => setRaceOpen((v) => !v)}
        />
      </div>
      {layers.crime && crimeOpen ? (
        <>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            {CRIME_TYPE_META.map((item) => {
              const on = crimeLayers[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onToggleCrime(item.id)}
                  aria-pressed={on}
                  className={cn(
                    "h-6 min-w-0 shrink-0 border px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
                    on ? item.chip : "border-line bg-surface/90 text-faint hover:border-muted hover:text-muted",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleCrime("h48")}
              aria-pressed={crimeLayers.h48}
              className={cn(
                "h-6 min-w-0 shrink-0 border px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
                crimeLayers.h48
                  ? H48_META.chip
                  : "border-line bg-surface/90 text-faint hover:border-muted hover:text-muted",
              )}
            >
              {H48_META.label}
            </button>
            {WINDOW_META.map((item) => {
              const on = crimeWindow === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onCrimeWindow(item.id)}
                  aria-pressed={on}
                  className={cn(
                    "h-6 min-w-0 shrink-0 border px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
                    on
                      ? "border-grid bg-grid/15 text-grid"
                      : "border-line bg-surface/90 text-faint hover:border-muted hover:text-muted",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
            <span className="mx-0.5 h-4 w-px bg-line" />
            {AGENCY_META.map((item) => {
              const on = crimeAgency[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onToggleAgency(item.id)}
                  aria-pressed={on}
                  className={cn(
                    "h-6 min-w-0 shrink-0 border px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
                    on
                      ? "border-steel bg-steel/15 text-steel"
                      : "border-line bg-surface/90 text-faint hover:border-muted hover:text-muted",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {layers.race && raceOpen ? (
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
          {RACE_META.map((item) => {
            const on = raceLayers[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggleRace(item.id)}
                aria-pressed={on}
                className={cn(
                  "h-6 min-w-0 shrink-0 border px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
                  on ? item.chip : "border-line bg-surface/90 text-faint hover:border-muted hover:text-muted",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ExpandChip({
  label,
  on,
  open,
  onToggle,
  onOpen,
}: {
  label: string;
  on: boolean;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <span className="inline-flex h-6 items-stretch overflow-hidden border border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        className={cn(
          "px-1.5 font-mono text-[10px] tracking-widest whitespace-nowrap uppercase",
          on ? "bg-grid/15 text-grid" : "bg-surface/90 text-faint hover:text-muted",
        )}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
        className={cn(
          "grid w-5 place-items-center border-l border-line",
          on ? "text-grid" : "text-faint",
        )}
      >
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
    </span>
  );
}
