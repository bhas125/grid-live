import type { CrimeAgencies, CrimeIncident, CrimeLayers, CrimeWindow } from "@/data/types";
import { isFresh48 } from "@/lib/crime-fresh";
import { agencyOf, inCrimeWindow, isDispatch, isHomicide, isLead, isShooting } from "@/lib/crime-window";

/** Production snapshot — preview builds should prefer this so counts stay live. */
export const LIVE_CRIME_URL = "https://grid.blastpad.app/crime-tn.json";

export type CrimeOpsCounts = { hom: number; sht: number; lead: number };

/** SHT on → isolate (HOM on, SHT off). SHT off → restore SHT. No extra layer flag. */
export function toggleHomIsolate(layers: CrimeLayers): CrimeLayers {
  if (layers.sht) return { ...layers, hom: true, sht: false };
  return { ...layers, sht: true };
}

export function crimeOpsCounts(
  rows: CrimeIncident[],
  opts: {
    window: CrimeWindow;
    agency: CrimeAgencies;
    county?: string | null;
  },
): CrimeOpsCounts {
  const now = Date.now();
  let hom = 0;
  let sht = 0;
  let lead = 0;
  for (const c of rows) {
    if (isDispatch(c)) continue;
    if (opts.county && c.county !== opts.county) continue;
    if (!opts.agency[agencyOf(c)]) continue;
    if (isLead(c)) {
      if (isFresh48(c.date, now)) lead += 1;
      continue;
    }
    if (c.source === "GVA" && opts.window !== "ytd") continue;
    if (!inCrimeWindow(c.date, opts.window, now)) continue;
    if (isHomicide(c.type)) hom += 1;
    else if (isShooting(c.type)) sht += 1;
  }
  return { hom, sht, lead };
}

export function emptyCrimeLine(opts: {
  window: CrimeWindow;
  agency: CrimeAgencies;
  county?: string | null;
}): string {
  const on = (["mem", "nash", "cha", "rest"] as const).filter((id) => opts.agency[id]);
  const onlyRest = on.length === 1 && on[0] === "rest";
  const where = opts.county ? `${opts.county} County` : onlyRest ? "Rest-of-TN" : "this filter";
  if (opts.window === "today") return `No incidents today in ${where}.`;
  if (onlyRest) return `No Rest-of-TN points in this window.`;
  return `No homicide / shooting points in ${where}.`;
}

function asIncidents(data: unknown): CrimeIncident[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row) => row && typeof row === "object") as CrimeIncident[];
}

/** Prefer the live production snapshot, then the same-origin copy. */
export async function loadCrimeSnapshot(signal?: AbortSignal): Promise<CrimeIncident[]> {
  const urls = [LIVE_CRIME_URL, "/crime-tn.json"];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal, cache: "no-store" });
      if (!res.ok) continue;
      const rows = asIncidents(await res.json());
      if (rows.length) return rows;
    } catch {
      /* try next source */
    }
  }
  return [];
}
