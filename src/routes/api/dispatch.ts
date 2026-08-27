import { createFileRoute } from "@tanstack/react-router";
import type { CrimeIncident } from "@/data/types";

const CAD =
  "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Active_Dispatch_Table_view/FeatureServer/0/query";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const UA = "GridTN/1.0 (tennessee situation monitor; grid.blakehassler.com)";

type CadRow = {
  ObjectId?: number;
  IncidentTypeName?: string;
  CallReceivedTime?: number;
  Location?: string;
  CityName?: string;
};

const geoCache = new Map<string, { lat: number; lon: number } | null>();
let mem: { at: number; incidents: CrimeIncident[] } | null = null;
const MEM_MS = 15 * 60_000;

function ymd(ms: number) {
  try {
    return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

async function geocode(street: string, city: string) {
  const key = `${street}|${city}`.toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  const q = new URL(CENSUS);
  q.searchParams.set("address", `${street}, ${city || "Nashville"}, TN`);
  q.searchParams.set("benchmark", "Public_AR_Current");
  q.searchParams.set("vintage", "Current_Current");
  q.searchParams.set("format", "json");
  try {
    const res = await fetch(q, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(1800) });
    if (!res.ok) {
      geoCache.set(key, null);
      return null;
    }
    const d = (await res.json()) as { result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] } };
    const c = d.result?.addressMatches?.[0]?.coordinates;
    const hit = c && Number.isFinite(c.y) && Number.isFinite(c.x) ? { lat: c.y, lon: c.x } : null;
    geoCache.set(key, hit);
    return hit;
  } catch {
    geoCache.set(key, null);
    return null;
  }
}

const NASH = { lat: 36.1627, lon: -86.7816 };

async function pullCad(): Promise<CrimeIncident[]> {
  const q = new URL(CAD);
  q.searchParams.set("where", "1=1");
  q.searchParams.set("outFields", "ObjectId,IncidentTypeName,CallReceivedTime,Location,CityName");
  q.searchParams.set("returnGeometry", "false");
  q.searchParams.set("resultRecordCount", "40");
  q.searchParams.set("f", "pjson");
  const res = await fetch(q, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(2500) });
  if (!res.ok) return [];
  const d = (await res.json()) as { features?: { attributes?: CadRow }[] };
  const rows = (d.features ?? []).map((f) => f.attributes).filter(Boolean) as CadRow[];
  const out: CrimeIncident[] = [];
  await Promise.all(
    rows.slice(0, 24).map(async (a, i) => {
      const loc = String(a.Location ?? "").trim();
      const rawCity = String(a.CityName ?? "Nashville").trim() || "Nashville";
      const city = /nashville|east|north|south|west|bellevue|madison|antioch|donelson|hermitage|inglewood|berry hill|joelton|neelys|brentwood/i.test(
        rawCity,
      )
        ? "Nashville"
        : rawCity;
      const xy = loc ? await geocode(loc, "Nashville") : null;
      const pin = xy ?? { lat: NASH.lat + ((i % 5) - 2) * 0.012, lon: NASH.lon + (((i / 5) | 0) - 1) * 0.012 };
      out.push({
        id: `CAD-${a.ObjectId ?? loc ?? i}`,
        date: a.CallReceivedTime ? ymd(a.CallReceivedTime) : ymd(Date.now()),
        city,
        county: "Davidson",
        address: loc || rawCity || "Nashville",
        lat: pin.lat,
        lon: pin.lon,
        type: "Dispatch",
        offense: String(a.IncidentTypeName ?? "Active dispatch"),
        source: "MNPD_CAD",
        killed: 0,
        injured: 0,
        geo: xy ? "address" : "city",
      });
    }),
  );
  return out;
}

export const Route = createFileRoute("/api/dispatch")({
  server: {
    handlers: {
      GET: async () => {
        if (mem && Date.now() - mem.at < MEM_MS) {
          return Response.json(
            { incidents: mem.incidents, kind: "dispatch" },
            { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
          );
        }
        try {
          const incidents = await pullCad();
          mem = { at: Date.now(), incidents };
          return Response.json(
            { incidents, kind: "dispatch" },
            { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
          );
        } catch {
          return Response.json(
            { incidents: [], kind: "dispatch" },
            { headers: { "Cache-Control": "public, s-maxage=15" } },
          );
        }
      },
    },
  },
});
