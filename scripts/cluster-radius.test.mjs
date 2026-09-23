import test from "node:test";
import assert from "node:assert/strict";

/** Keep in sync with src/lib/crime-cluster.ts `clusterRadius`. */
function clusterRadius(n, mapW, opts = {}) {
  const count = Math.max(1, n);
  const rMin = opts.rMin ?? 7;
  const rMaxFrac = opts.rMaxFrac ?? 0.035;
  const rMaxPx = opts.rMaxPx ?? 18;
  const nSoft = Math.max(2, opts.nSoft ?? 64);
  const rMax = Math.max(rMin + 2, Math.min(rMaxPx, mapW * rMaxFrac));
  const t = Math.min(1, Math.sqrt((count - 1) / (nSoft - 1)));
  return rMin + (rMax - rMin) * t;
}

test("sqrt scale: 5 SHT stays modest; YTD metro is clamped", () => {
  const mapW = 900;
  const small = clusterRadius(5, mapW);
  const ytd = clusterRadius(3466, mapW);
  assert.ok(small < 12, `n=5 should be modest, got ${small}`);
  assert.ok(ytd <= 18, `YTD metro must clamp, got ${ytd}`);
  assert.ok(ytd > small, "larger counts still read bigger before the clamp");
});

test("rMax tracks viewport but never exceeds rMaxPx", () => {
  const phone = clusterRadius(400, 360);
  const desktop = clusterRadius(400, 1200);
  assert.ok(phone <= 360 * 0.035 + 0.01);
  assert.equal(desktop, 18);
});
