import type { HouseDistrict } from "@/data/types";

function pipLonLat(lon: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const ay = a[1];
    const by = b[1];
    const ax = a[0];
    const bx = b[0];
    const dy = by - ay;
    if ((ay > lat) !== (by > lat) && lon < ((bx - ax) * (lat - ay)) / (dy || 1e-9) + ax) inside = !inside;
  }
  return inside;
}

export function houseAtLonLat(house: HouseDistrict[], lon: number, lat: number) {
  let hit: HouseDistrict | null = null;
  let area = Infinity;
  for (const h of house) {
    const ring = h.g?.[0];
    if (!ring || ring.length < 3) continue;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of ring) {
      const x = p[0];
      const y = p[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    if (!pipLonLat(lon, lat, ring)) continue;
    const a = (maxX - minX) * (maxY - minY);
    if (a < area) {
      area = a;
      hit = h;
    }
  }
  return hit;
}

export function hdLine(h: HouseDistrict) {
  const party = h.p === "R" ? "R" : h.p === "D" ? "D" : h.p;
  return `HD-${String(h.d).padStart(2, "0")} · ${h.n} · ${party}`;
}
