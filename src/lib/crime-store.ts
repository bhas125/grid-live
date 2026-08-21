import type { CrimeIncident } from "@/data/types";
import { getSql } from "@/lib/db";

const STALE_MS = 24 * 60 * 60_000;
const MEM_MS = 12 * 60_000;
let mem: { at: number; incidents: CrimeIncident[] } | null = null;
let inflight: Promise<CrimeIncident[]> | null = null;

function rowToIncident(r: Record<string, unknown>): CrimeIncident {
  return {
    id: String(r.id),
    date: r.date ? String(r.date).slice(0, 10) : null,
    city: String(r.city ?? ""),
    county: String(r.county ?? ""),
    address: String(r.address ?? ""),
    zip: r.zip ? String(r.zip) : undefined,
    lat: Number(r.lat),
    lon: Number(r.lon),
    type: String(r.type),
    offense: String(r.offense ?? ""),
    source: String(r.source ?? ""),
    killed: Number(r.killed ?? 0),
    injured: Number(r.injured ?? 0),
  };
}

async function sqlOrNull() {
  try {
    return await getSql();
  } catch {
    return null;
  }
}

export async function lastIngestAt(): Promise<number> {
  if (mem?.at) return mem.at;
  try {
    const sql = await sqlOrNull();
    if (!sql) return 0;
    const rows = await sql<{ value: string }>`select value from crime_meta where key = ${"ingest_at"}`;
    const n = Number(rows[0]?.value ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function readStoredCrime(since?: string): Promise<CrimeIncident[]> {
  try {
    const sql = await sqlOrNull();
    if (!sql) return mem?.incidents ?? [];
    const rows = since
      ? await sql<Record<string, unknown>>`select * from crime_live where date >= ${since} order by date desc`
      : await sql<Record<string, unknown>>`select * from crime_live order by date desc`;
    return rows.map(rowToIncident);
  } catch {
    return mem?.incidents ?? [];
  }
}

export async function readLiveCrime(since?: string): Promise<CrimeIncident[]> {
  if (mem?.incidents.length) {
    return since ? mem.incidents.filter((r) => (r.date ?? "") >= since) : mem.incidents;
  }
  return readStoredCrime(since);
}

function prefer(old: CrimeIncident, next: CrimeIncident): CrimeIncident {
  const nextHasStreet = /\d/.test(next.address || "");
  const oldHasStreet = /\d/.test(old.address || "");
  const address = nextHasStreet || !oldHasStreet ? next.address : old.address;
  const lat = nextHasStreet || !oldHasStreet ? next.lat : old.lat;
  const lon = nextHasStreet || !oldHasStreet ? next.lon : old.lon;
  const official = next.source !== "News" || old.source === "News";
  return {
    ...old,
    address,
    lat,
    lon,
    zip: next.zip || old.zip,
    type: official ? next.type : old.type,
    offense: next.offense || old.offense,
    killed: official ? next.killed : old.killed,
    injured: Math.max(old.injured, next.injured),
  };
}

export async function writeLiveCrime(rows: CrimeIncident[]) {
  const prior = mem?.incidents?.length ? mem.incidents : await readStoredCrime();
  const have = new Map(prior.map((r) => [r.id, r]));
  for (const r of rows) {
    const old = have.get(r.id);
    have.set(r.id, old ? prefer(old, r) : r);
  }
  const merged = [...have.values()];
  mem = { at: Date.now(), incidents: merged };
  if (!rows.length) return 0;
  const sql = await sqlOrNull();
  if (!sql) return rows.length;
  try {
    for (let i = 0; i < rows.length; i += 40) {
      const chunk = rows.slice(i, i + 40);
      const params: unknown[] = [];
      const values = chunk.map((_, idx) => {
        const b = idx * 13;
        const r = chunk[idx];
        params.push(
          r.id,
          r.date,
          r.city,
          r.county,
          r.address,
          r.zip ?? null,
          r.lat,
          r.lon,
          r.type,
          r.offense,
          r.source,
          r.killed,
          r.injured,
        );
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`;
      });
      await sql.query(
        `insert into crime_live (id, date, city, county, address, zip, lat, lon, type, offense, source, killed, injured)
         values ${values.join(",")}
         on conflict (id) do update set
           address = excluded.address,
           lat = excluded.lat,
           lon = excluded.lon,
           zip = coalesce(excluded.zip, crime_live.zip),
           type = excluded.type,
           offense = excluded.offense,
           killed = excluded.killed,
           injured = excluded.injured`,
        params,
      );
    }
    await sql`
      insert into crime_meta (key, value, updated_at)
      values (${"ingest_at"}, ${String(Date.now())}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
  } catch {
    /* memory cache still holds the rows — GitHub Action is the permanent store */
  }
  return rows.length;
}

export async function ingestIfStale(force: boolean, fetchNew: () => Promise<CrimeIncident[]>) {
  if (!force && mem && Date.now() - mem.at < MEM_MS) {
    return { added: 0, skipped: true as const, incidents: mem.incidents };
  }
  const last = await lastIngestAt();
  if (!force && last && Date.now() - last < STALE_MS) {
    const incidents = await readLiveCrime();
    if (incidents.length) return { added: 0, skipped: true as const, incidents };
  }
  if (inflight) {
    const incidents = await inflight;
    return { added: incidents.length, skipped: false as const, incidents };
  }
  inflight = (async () => {
    const fresh = await fetchNew();
    await writeLiveCrime(fresh);
    return mem?.incidents ?? fresh;
  })();
  try {
    const incidents = await inflight;
    return { added: incidents.length, skipped: false as const, incidents };
  } finally {
    inflight = null;
  }
}
