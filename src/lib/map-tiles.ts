import type { Project, ViewBox } from "@/lib/geo";

export type Tile = {
  key: string;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type Unproject = (x: number, y: number) => { lon: number; lat: number };

const MAX_TILES = 20;

function lon2tile(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z;
}

function lat2tile(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

function tileLon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}

function tileLat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function rangeFor(west: number, east: number, north: number, south: number, z: number) {
  const x0 = Math.floor(lon2tile(west, z));
  const x1 = Math.floor(lon2tile(east, z));
  const y0 = Math.floor(lat2tile(north, z));
  const y1 = Math.floor(lat2tile(south, z));
  return { x0, x1, y0, y1, n: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

export function tilesForView(
  view: ViewBox,
  project: Project,
  unproject: Unproject,
  size: { w: number; h: number },
  ox: number,
  oy: number,
  s: number,
  wide = false,
): Tile[] {
  if (size.w < 8) return [];
  if (view.w > (wide ? 760 : 220)) return [];
  const nw = unproject(view.x, view.y);
  const se = unproject(view.x + view.w, view.y + view.h);
  const west = Math.min(nw.lon, se.lon);
  const east = Math.max(nw.lon, se.lon);
  const north = Math.max(nw.lat, se.lat);
  const south = Math.min(nw.lat, se.lat);
  const lonSpan = Math.max(0.002, east - west);
  let z = Math.min(16, Math.max(8, Math.round(Math.log2((360 / lonSpan) * (size.w / 256)))));
  let box = rangeFor(west, east, north, south, z);
  while (z > 8 && box.n > MAX_TILES) {
    z -= 1;
    box = rangeFor(west, east, north, south, z);
  }
  const { x0, x1, y0, y1 } = box;
  const out: Tile[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const p0 = project(tileLon(x, z), tileLat(y, z));
      const p1 = project(tileLon(x + 1, z), tileLat(y + 1, z));
      out.push({
        key: `${z}/${x}/${y}`,
        url: `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}@2x.png`,
        x: (p0.x - view.x) * s + ox,
        y: (p0.y - view.y) * s + oy,
        w: (p1.x - p0.x) * s,
        h: (p1.y - p0.y) * s,
      });
      if (out.length >= MAX_TILES) return out;
    }
  }
  return out;
}
