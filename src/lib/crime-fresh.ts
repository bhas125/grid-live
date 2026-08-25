const FRESH_MS = 48 * 60 * 60 * 1000;

/** YYYY-MM-DD as noon America/Chicago (CDT −05 in summer). */
export function isFresh48(date: string | null | undefined, now = Date.now()) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T12:00:00-05:00`);
  return Number.isFinite(t) && now - t <= FRESH_MS;
}
