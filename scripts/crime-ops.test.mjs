import test from "node:test";
import assert from "node:assert/strict";

function emptyCrimeLine({ window, agency, county }) {
  const on = ["mem", "nash", "cha", "rest"].filter((id) => agency[id]);
  const onlyRest = on.length === 1 && on[0] === "rest";
  const where = county ? `${county} County` : onlyRest ? "Rest-of-TN" : "this filter";
  if (window === "today") return `No incidents today in ${where}.`;
  if (onlyRest) return `No Rest-of-TN points in this window.`;
  return `No homicide / shooting points in ${where}.`;
}

const all = { mem: true, nash: true, cha: true, rest: true };
const restOnly = { mem: false, nash: false, cha: false, rest: true };

test("TODAY empty-state one-liner", () => {
  assert.equal(emptyCrimeLine({ window: "today", agency: all }), "No incidents today in this filter.");
  assert.equal(
    emptyCrimeLine({ window: "today", agency: restOnly }),
    "No incidents today in Rest-of-TN.",
  );
});

test("REST empty-state one-liner", () => {
  assert.equal(emptyCrimeLine({ window: "ytd", agency: restOnly }), "No Rest-of-TN points in this window.");
});
