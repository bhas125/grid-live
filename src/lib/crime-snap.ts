const FRESH_MS = 48 * 60 * 60 * 1000;

/** Same rule as isFresh48 in crime-fresh.ts (noon America/Chicago, 48h). */
function fresh48(date: string | null | undefined, now: number) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T12:00:00-05:00`);
  return Number.isFinite(t) && now - t <= FRESH_MS;
}

type SnapRow = {
  id: string;
  date?: string | null;
  source?: string;
  type?: string;
};

/** Statewide file is thousands of rows. A short body is a partial or the wrong payload. */
export const MIN_CRIME_SNAP = 1000;

const DAY_MS = 24 * 60 * 60_000;

function chicagoYmd(ms: number) {
  try {
    return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function crimeSnapRows<T extends SnapRow>(data: unknown): T[] {
  const rows = Array.isArray(data) ? (data as T[]) : [];
  return rows.filter((r) => r && r.source !== "MNPD_CAD" && r.type !== "Dispatch");
}

export function newestCrimeDate(rows: SnapRow[]) {
  let max = "";
  for (const r of rows) {
    const d = r.date ?? "";
    if (d > max) max = d;
  }
  return max;
}

/**
 * True when the in-memory file cannot be the post-merge snapshot.
 * Yesterday-or-newer is enough: a quiet day still has yesterday's rows.
 */
export function snapshotLooksStale(rows: SnapRow[], now = Date.now()) {
  if (rows.length < MIN_CRIME_SNAP) return true;
  const newest = newestCrimeDate(rows);
  if (!newest) return true;
  const yesterday = chicagoYmd(now - DAY_MS);
  return newest < yesterday;
}

/**
 * The file is the map. Drop in-memory rows the file no longer lists,
 * except a fresh official add that the snapshot has not caught up to yet.
 */
export function applyCrimeSnap<T extends SnapRow>(prev: T[], snap: T[], now = Date.now()): T[] {
  if (!snap.length) return prev;
  const byId = new Map(snap.map((r) => [r.id, r]));
  for (const r of prev) {
    if (byId.has(r.id) || r.source === "News" || r.source === "GVA") continue;
    if (!fresh48(r.date, now)) continue;
    byId.set(r.id, r);
  }
  return [...byId.values()];
}

/** Drop Cache Storage copies of the statewide file. A service worker can ignore fetch cache mode. */
export async function dropCrimeResponseCaches() {
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(
      keys.map(async (key) => {
        const cache = await caches.open(key);
        const reqs = await cache.keys();
        await Promise.all(
          reqs.filter((req) => req.url.includes("/crime-tn.json")).map((req) => cache.delete(req)),
        );
      }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * If a previous visit registered a service worker, it can keep answering
 * /crime-tn.json from Cache Storage after a hard refresh. Unregister it once.
 * Returns true when the caller should reload so this document is no longer controlled.
 */
export async function releaseStaleWorker(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  let regs: readonly ServiceWorkerRegistration[] = [];
  try {
    regs = await navigator.serviceWorker.getRegistrations();
  } catch {
    return false;
  }
  const controlled = !!navigator.serviceWorker.controller;
  if (!regs.length && !controlled) return false;
  try {
    await Promise.all(regs.map((r) => r.unregister()));
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* still try to leave the controlled page */
  }
  try {
    if (sessionStorage.getItem("grid-sw-cleared") === "1") return false;
    sessionStorage.setItem("grid-sw-cleared", "1");
  } catch {
    return false;
  }
  return true;
}
