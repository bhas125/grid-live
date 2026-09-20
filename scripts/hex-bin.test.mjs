import test from "node:test";
import assert from "node:assert/strict";

const SQRT3 = Math.sqrt(3);

function hexRound(q, r) {
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

function hexAxial(x, y, size) {
  const q = ((2 / 3) * x) / size;
  const r = ((-1 / 3) * x + (SQRT3 / 3) * y) / size;
  return hexRound(q, r);
}

function hexCenter(q, r, size) {
  return {
    x: size * (1.5 * q),
    y: size * (SQRT3 * (r + q / 2)),
  };
}

function hexScreenRadius(mapW, opts = {}) {
  const rPx = opts.rPx ?? 12;
  const rFrac = opts.rFrac ?? 0.015;
  return Math.max(9, Math.min(rPx, mapW * rFrac));
}

function hexBin(pts, size) {
  if (size <= 0 || pts.length === 0) {
    return pts.map((p) => ({ x: p.x, y: p.y, n: 1, items: [p] }));
  }
  if (pts.length === 1) {
    return [{ x: pts[0].x, y: pts[0].y, n: 1, items: pts }];
  }
  const buckets = new Map();
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

test("hexRound snaps near-center axial coords to origin", () => {
  const a = hexRound(0.2, -0.1);
  assert.equal(a.q, 0);
  assert.equal(a.r, 0);
});

test("nearby points share a hex; distant points do not", () => {
  const size = 20;
  const c = hexCenter(3, -1, size);
  const near = hexBin(
    [
      { x: c.x + 2, y: c.y - 1 },
      { x: c.x - 3, y: c.y + 2 },
    ],
    size,
  );
  assert.equal(near.length, 1);
  assert.equal(near[0].n, 2);
  const far = hexBin(
    [
      { x: c.x, y: c.y },
      { x: c.x + size * 6, y: c.y + size * 6 },
    ],
    size,
  );
  assert.equal(far.length, 2);
});

test("hex cells stay compact vs map width", () => {
  const phone = hexScreenRadius(360);
  const desktop = hexScreenRadius(1200);
  assert.ok(phone <= 12);
  assert.equal(desktop, 12);
  assert.ok(phone / 360 < 0.04, "hex must not cover a large slice of the map");
});
