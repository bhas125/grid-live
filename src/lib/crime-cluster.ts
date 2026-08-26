export type Clusterable = { x: number; y: number };

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
