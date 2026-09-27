import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../public/gate.html", import.meta.url), "utf8");

function bootGate() {
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, "gate.html has an inline script");
  const elements = new Map();
  function make(id) {
    const node = {
      id,
      className: "",
      textContent: "",
      value: "",
      focused: false,
      listeners: {},
      addEventListener(type, fn) {
        node.listeners[type] = fn;
      },
      focus() {
        node.focused = true;
      },
    };
    elements.set(id, node);
    return node;
  }
  for (const id of ["path", "logo-wrap", "portal", "form", "pw", "err"]) make(id);
  const messages = [];
  const sandbox = {
    document: {
      getElementById(id) {
        return elements.get(id) ?? null;
      },
    },
    localStorage: { removeItem() {} },
    sessionStorage: { removeItem() {} },
    location: { origin: "https://grid.blastpad.app", pathname: "/" },
    setTimeout(fn) {
      fn();
    },
    Math,
    window: {
      parent: {
        postMessage(data, origin) {
          messages.push({ data, origin });
        },
      },
    },
  };
  vm.runInNewContext(script, sandbox);
  return { elements, messages };
}

test("clicking the Google logo opens the password portal", () => {
  assert.doesNotMatch(html, /id="o-hit"/);
  assert.match(html, /id="logo-wrap"/);
  assert.match(html, /id="logo"/);
  const { elements } = bootGate();
  const logo = elements.get("logo-wrap");
  let prevented = false;
  logo.listeners.click({
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  });
  assert.equal(prevented, true);
  assert.equal(elements.get("portal").className, "on");
  assert.equal(elements.get("pw").focused, true);
});

test("the usual password posts bh:1 and a wrong one does not", () => {
  assert.match(html, /hash\(v\) === 3236740001/);
  assert.match(html, /postMessage\(\{ bh: 1 \}/);
  const { elements, messages } = bootGate();
  const form = elements.get("form");
  const pw = elements.get("pw");
  const submit = () =>
    form.listeners.submit({
      preventDefault() {},
    });

  pw.value = "nope";
  submit();
  assert.equal(messages.length, 0);
  assert.equal(elements.get("err").textContent, "Wrong password. Try again.");

  pw.value = "blake123";
  submit();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].origin, "https://grid.blastpad.app");
  assert.equal(messages[0].data.bh, 1);
});
