export type Clusterable = { x: number; y: number };

/**
 * Area-proportional cluster radius: r ∝ √n, then hard-clamped to the viewport.
 *
 * r = rMin + (rMax − rMin) * min(1, √((n−1) / (nSoft−1)))
 * rMax = min(rMaxPx, mapW * rMaxFrac)
 *
 * Defaults keep a ~5-count 30d bubble modest and stop YTD metros from
 * eating the state: rMax is ~3.5% of map width (≈7% diameter) and never
 * more than 18px. Ripples expand to ~1.25× this core radius.
 */
export function clusterRadius(
  n: number,
  mapW: number,
  opts?: { rMin?: number; rMaxFrac?: number; rMaxPx?: number; nSoft?: number },
): number {
  const count = Math.max(1, n);
  const rMin = opts?.rMin ?? 7;
  const rMaxFrac = opts?.rMaxFrac ?? 0.035;
  const rMaxPx = opts?.rMaxPx ?? 18;
  const nSoft = Math.max(2, opts?.nSoft ?? 64);
  const rMax = Math.max(rMin + 2, Math.min(rMaxPx, mapW * rMaxFrac));
  const t = Math.min(1, Math.sqrt((count - 1) / (nSoft - 1)));
  return rMin + (rMax - rMin) * t;
}

export type Cluster<T extends Clusterable> = {
  x: number;
  y: number;
  n: number;
  items: T[];
};

/** Grid cluster in projected map units. */
export function clusterXY<T extends Clusterable>(pts: T[], cell: number): Cluster<T>[] {
  if (cell <= 0 || pts.length < 2) {
    return pts.map((p) => ({ x: p.x, y: p.y, n: 1, items: [p] }));
  }
  const buckets = new Map<string, Cluster<T>>();
  for (const p of pts) {
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    const k = `${gx}:${gy}`;
    let b = buckets.get(k);
    if (!b) {
      b = { x: 0, y: 0, n: 0, items: [] };
      buckets.set(k, b);
    }
    b.x += p.x;
    b.y += p.y;
    b.n += 1;
    b.items.push(p);
  }
  const out: Cluster<T>[] = [];
  for (const b of buckets.values()) {
    b.x /= b.n;
    b.y /= b.n;
    out.push(b);
  }
  return out;
}

/** One bubble per busy county; leftover rural points grid-cluster. */
export function clusterByCounty<T extends Clusterable & { county?: string }>(
  pts: T[],
  opts: { minN: number; restCell: number; always?: Set<string> },
): Cluster<T>[] {
  const bags = new Map<string, T[]>();
  for (const p of pts) {
    const k = p.county || "_";
    const bag = bags.get(k);
    if (bag) bag.push(p);
    else bags.set(k, [p]);
  }
  const out: Cluster<T>[] = [];
  const rest: T[] = [];
  const always = opts.always;
  for (const [name, items] of bags) {
    if ((always && always.has(name)) || items.length >= opts.minN) {
      let x = 0;
      let y = 0;
      for (const p of items) {
        x += p.x;
        y += p.y;
      }
      out.push({ x: x / items.length, y: y / items.length, n: items.length, items });
    } else {
      rest.push(...items);
    }
  }
  if (!rest.length) return out;
  return out.concat(clusterXY(rest, opts.restCell));
}

const SQRT3 = Math.sqrt(3);

/** Cube-round axial hex coordinates (flat-top, H3-style). */
export function hexRound(q: number, r: number): { q: number; r: number } {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq || 0, r: rr || 0 };
}

export function hexAxial(x: number, y: number, size: number): { q: number; r: number } {
  const q = ((2 / 3) * x) / size;
  const r = ((-1 / 3) * x + (SQRT3 / 3) * y) / size;
  return hexRound(q, r);
}

export function hexCenter(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * (1.5 * q),
    y: size * (SQRT3 * (r + q / 2)),
  };
}

/** Compact on-screen hex radius. Count does not grow the cell. */
export function hexScreenRadius(mapW: number, opts?: { rPx?: number; rFrac?: number }): number {
  const rPx = opts?.rPx ?? 11;
  const rFrac = opts?.rFrac ?? 0.014;
  return Math.max(8, Math.min(rPx, mapW * rFrac));
}

/**
 * Flat-top hexbin. Cell centers tile; `size` is center-to-vertex in map units.
 * Keep `size` small (≈ screen px / scale) so statewide hexes stay compact.
 */
export function hexBin<T extends Clusterable>(pts: T[], size: number): Cluster<T>[] {
  if (size <= 0 || pts.length === 0) {
    return pts.map((p) => ({ x: p.x, y: p.y, n: 1, items: [p] }));
  }
  if (pts.length === 1) {
    return [{ x: pts[0].x, y: pts[0].y, n: 1, items: pts }];
  }
  const buckets = new Map<string, Cluster<T>>();
  for (const p of pts) {
    const { q, r } = hexAxial(p.x, p.y, size);
    const k = `${q}:${r}`;
    let b = buckets.get(k);
    if (!b) {
      const c = hexCenter(q, r, size);
      b = { x: c.x, y: c.y, n: 0, items: [] };
      buckets.set(k, b);
    }
    b.n += 1;
    b.items.push(p);
  }
  return [...buckets.values()];
}
