import test from "node:test";
import assert from "node:assert/strict";

function toggleHomIsolate(layers) {
  if (layers.sht) return { ...layers, hom: true, sht: false };
  return { ...layers, sht: true };
}

test("Isolate HOM turns SHT off and keeps/turns HOM on", () => {
  assert.deepEqual(toggleHomIsolate({ hom: true, sht: true, reg: false, cad: false }), {
    hom: true,
    sht: false,
    reg: false,
    cad: false,
  });
  assert.deepEqual(toggleHomIsolate({ hom: false, sht: true, reg: false, cad: true }), {
    hom: true,
    sht: false,
    reg: false,
    cad: true,
  });
});

test("Show SHT restores SHT without forcing HOM", () => {
  assert.deepEqual(toggleHomIsolate({ hom: true, sht: false, reg: false, cad: false }), {
    hom: true,
    sht: true,
    reg: false,
    cad: false,
  });
  assert.deepEqual(toggleHomIsolate({ hom: false, sht: false, reg: false, cad: false }), {
    hom: false,
    sht: true,
    reg: false,
    cad: false,
  });
});
