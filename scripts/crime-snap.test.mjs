import assert from "node:assert/strict";
import test from "node:test";
import { applyCrimeSnap, crimeSnapRows, snapshotLooksStale } from "../src/lib/crime-snap.ts";

const now = Date.parse("2026-09-27T01:40:00Z");

test("crimeSnapRows drops dispatch and ignores a wrapped payload", () => {
  const rows = crimeSnapRows([
    { id: "A", source: "News", type: "Shooting", date: "2026-09-26" },
    { id: "B", source: "MNPD_CAD", type: "Shooting", date: "2026-09-26" },
    { id: "C", source: "Nashville_MNPD", type: "Dispatch", date: "2026-09-26" },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["A"]);
  assert.equal(crimeSnapRows({ incidents: [] }).length, 0);
});

test("file snapshot replaces stale in-memory rows and keeps a fresh add", () => {
  const prev = [
    { id: "OLD", source: "Memphis_MPD", type: "Shooting", date: "2026-09-19" },
    { id: "JUNK", source: "News", type: "Shooting", date: "2026-09-26" },
    { id: "LIVE", source: "Memphis_MPD", type: "Shooting", date: "2026-09-26" },
  ];
  const snap = [
    { id: "NEWS-2026-09-26-Davidson", source: "WSMV", type: "Shooting", date: "2026-09-26" },
    { id: "NEWS-2026-09-25-Shelby", source: "WMC", type: "Shooting", date: "2026-09-25" },
  ];
  const next = applyCrimeSnap(prev, snap, now);
  const ids = next.map((r) => r.id).sort();
  assert.deepEqual(ids, ["LIVE", "NEWS-2026-09-25-Shelby", "NEWS-2026-09-26-Davidson"]);
});

test("a snapshot whose newest row is Sep 19 is stale on Sep 26 Chicago", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: `R${i}`,
    source: "Memphis_MPD",
    type: "Shooting",
    date: "2026-09-19",
  }));
  assert.equal(snapshotLooksStale(rows, now), true);
  rows[0] = { ...rows[0], date: "2026-09-26" };
  assert.equal(snapshotLooksStale(rows, now), false);
});
