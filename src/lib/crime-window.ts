import type { CrimeAgency, CrimeIncident, CrimeWindow, GeoPrecision } from "@/data/types";
import { COUNTY_XY } from "@/lib/county-xy";

const DENSE = new Set(["Shelby", "Davidson", "Hamilton", "Knox"]);

export function isDenseCounty(name: string | null | undefined) {
  return !!name && DENSE.has(name);
}

export function chicagoYmd(ms = Date.now()) {
  try {
    return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function daysAgoYmd(n: number, ms = Date.now()) {
  return chicagoYmd(ms - n * 24 * 60 * 60_000);
}

export function inCrimeWindow(date: string | null | undefined, win: CrimeWindow, now = Date.now()) {
  if (!date) return false;
  const today = chicagoYmd(now);
  if (win === "today") return date === today;
  if (win === "ytd") return date.startsWith(today.slice(0, 4));
  const start = daysAgoYmd(win === "7d" ? 7 : 30, now);
  return date >= start && date <= today;
}

export function agencyOf(c: CrimeIncident): CrimeAgency {
  if (c.source === "Memphis_MPD") return "mem";
  if (c.source === "Nashville_MNPD" || c.source === "MNPD_CAD") return "nash";
  if (c.source === "Chattanooga_CPD") return "cha";
  return "rest";
}

export function isDispatch(c: CrimeIncident) {
  return c.source === "MNPD_CAD" || c.type === "Dispatch";
}

/**
 * Unconfirmed CAD lead: a scanner/dispatch line with no PD or news confirmation.
 * Never counts as a confirmed incident; renders only under the Lead toggle.
 */
export function isLead(c: CrimeIncident) {
  if (isDispatch(c)) return false;
  if (c.confirmed === false) return true;
  return String(c.id ?? "").startsWith("CAD-");
}

export function isHomicide(type: string) {
  return type === "Homicide";
}

export function isShooting(type: string) {
  const t = type.toLowerCase();
  if (t.includes("homicide") || t.includes("robbery") || t.includes("dispatch")) return false;
  return t.includes("shooting") || t.includes("aggravated");
}

export function crimeLabel(type: string) {
  if (type === "Dispatch") return "Dispatch";
  if (isShooting(type)) return "Shooting";
  return type;
}

export function inferGeo(c: CrimeIncident): GeoPrecision {
  if (c.geo) return c.geo;
  const xy = COUNTY_XY[c.county];
  if (xy && Math.abs(c.lat - xy[0]) < 0.025 && Math.abs(c.lon - xy[1]) < 0.03) return "county";
  const a = (c.address || "").trim();
  if (!a) return c.city ? "city" : "county";
  if (/county,.*tennessee|united states$/i.test(a) && a.length > 60) return "county";
  if (/\b(killed|homicide|murder|shooting|shot)\b/i.test(a) && !/\d/.test(a)) return "county";
  if (/\bblock of\b/i.test(a) || /^\d{2,5}00\s+block/i.test(a)) return "block";
  if (/\s(&|and)\s/.test(a) && /\b(st|ave|rd|dr|ln|blvd|pike|hwy|way|ct|pl)\b/i.test(a)) return "intersection";
  if (/^\d/.test(a) && /\b(st|ave|rd|dr|ln|blvd|pike|hwy|way|ct|pl|cir|trl|pkwy|ter)\b/i.test(a)) return "address";
  if (/^\d{5}$/.test(c.zip ?? "") && !/\d/.test(a)) return "zip";
  if (!/\d/.test(a)) return a.length > 48 ? "county" : "place";
  return "address";
}

export function isImprecise(geo: GeoPrecision) {
  return geo === "county" || geo === "city" || geo === "zip" || geo === "place";
}

export function windowLabel(win: CrimeWindow) {
  if (win === "today") return "today";
  if (win === "7d") return "last 7 days";
  if (win === "30d") return "last 30 days";
  return "YTD";
}

export function filterCrime(
  rows: CrimeIncident[],
  opts: { window: CrimeWindow; agency: Record<CrimeAgency, boolean>; includeGva: boolean },
) {
  return rows.filter((c) => {
    if (isDispatch(c)) return false;
    if (isLead(c)) return false;
    if (!opts.agency[agencyOf(c)]) return false;
    if (c.source === "GVA" && !opts.includeGva) return false;
    return inCrimeWindow(c.date, opts.window);
  });
}
