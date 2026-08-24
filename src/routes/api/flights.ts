import { createFileRoute } from "@tanstack/react-router";
import type { Flight } from "@/data/types";

const UA = "GridTN/1.0 (tennessee situation monitor; grid.blakehassler.com)";
const LAMIN = 34.85;
const LAMAX = 36.85;
const LOMIN = -90.55;
const LOMAX = -81.4;
const TTL = 8_000;

type Cache = { at: number; flights: Flight[] };
let cache: Cache | null = null;

type Raw = Record<string, unknown>;

function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function inBox(lat: number, lon: number) {
  return lat >= LAMIN && lat <= LAMAX && lon >= LOMIN && lon <= LOMAX;
}

function fromRaw(row: Raw, at: number): Flight | null {
  const lat = num(row.lat);
  const lon = num(row.lon);
  if (lat == null || lon == null || !inBox(lat, lon)) return null;
  const altRaw = row.alt_baro;
  const ground = altRaw === "ground" || row.airground === "G";
  const alt = ground ? null : num(altRaw);
  const id = str(row.hex) || str(row.icao);
  if (!id) return null;
  const call = str(row.flight) || str(row.callsign) || str(row.r) || id.toUpperCase();
  return {
    id: id.toLowerCase(),
    call: call.replace(/\s+/g, " ").trim() || id.toUpperCase(),
    reg: str(row.r),
    ac: str(row.t) || str(row.desc),
    op: str(row.ownOp) || str(row.desc),
    lat,
    lon,
    alt,
    gs: num(row.gs) ?? 0,
    hdg: num(row.track) ?? num(row.true_heading) ?? 0,
    ground,
    at,
  };
}

function rowsOf(json: Raw) {
  if (Array.isArray(json.ac)) return json.ac as Raw[];
  if (Array.isArray(json.aircraft)) return json.aircraft as Raw[];
  return [] as Raw[];
}

async function pull(url: string) {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as Raw;
  const at = Date.now();
  const out: Flight[] = [];
  const seen = new Set<string>();
  for (const row of rowsOf(json)) {
    if (!row || typeof row !== "object") continue;
    const f = fromRaw(row, at);
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

async function loadFlights() {
  if (cache && Date.now() - cache.at < TTL) return cache.flights;
  const urls = [
    "https://opendata.adsb.fi/api/v2/lat/35.85/lon/-86.0/dist/240",
    "https://opendata.adsb.fi/api/v2/lat/35.85/lon/-86.0/dist/180",
    "https://api.adsb.lol/v2/lat/35.85/lon/-86.0/dist/240",
  ];
  for (const href of urls) {
    try {
      const flights = await pull(href);
      if (flights.length) {
        cache = { at: Date.now(), flights };
        return flights;
      }
    } catch {
      /* try next */
    }
  }
  return cache?.flights ?? [];
}

export const Route = createFileRoute("/api/flights")({
  server: {
    handlers: {
      GET: async () => {
        const flights = await loadFlights();
        return Response.json(
          { flights, live: flights.length > 0 },
          { headers: { "Cache-Control": "public, s-maxage=6, stale-while-revalidate=20" } },
        );
      },
    },
  },
});
