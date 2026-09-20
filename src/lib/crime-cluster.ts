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
