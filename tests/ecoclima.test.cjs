"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const NASA_URL =
  "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MIN,T2M_MAX,RH2M&community=AG&longitude=-78.65&latitude=-1.67&start=20240101&end=20240107&format=JSON";
const BACKUP_NOTICE = "MODO RESPALDO (DATOS SIMULADOS)";
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const inlineScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);

assert.ok(inlineScript, "index.html must contain its application script");

class MockElement {
  constructor() {
    this.attributes = {};
    this.children = [];
    this.dataset = {};
    this._textContent = "";
    this.className = "";
    this.listeners = {};
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach(name => this.classList.values.add(name)),
      remove: (...names) => names.forEach(name => this.classList.values.delete(name)),
      contains: name => this.classList.values.has(name)
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }

  getBoundingClientRect() {
    return { width: 800, height: 320 };
  }

  get childElementCount() {
    return this.children.length;
  }
}

function createHarness(fetchImplementation) {
  const elements = new Map();
  const timers = [];
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, new MockElement());
    return elements.get(id);
  };
  getElementById("location-select").value = "riobamba";

  const context = {
    AbortController,
    document: {
      getElementById,
      createElementNS: () => new MockElement()
    },
    fetch: fetchImplementation,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
    window: { addEventListener() {} }
  };

  vm.runInNewContext(inlineScript[1], context, { filename: "index.html" });
  return { elements, timers };
}

async function settle() {
  for (let index = 0; index < 5; index++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

test("mapea y extrae las cuatro variables de NASA POWER", async () => {
  const payload = {
    properties: {
      parameter: {
        T2M: { "20240101": 12.5, "20240102": 13.25 },
        T2M_MIN: { "20240101": 4.5, "20240102": 3.75 },
        T2M_MAX: { "20240101": 19.5, "20240102": 21.25 },
        RH2M: { "20240101": 76, "20240102": 81 }
      }
    }
  };
  let requestedUrl;
  const { elements } = createHarness(async url => {
    requestedUrl = url;
    return { ok: true, json: async () => payload };
  });
  await settle();

  assert.equal(requestedUrl, NASA_URL);
  assert.deepEqual(JSON.parse(elements.get("climate-chart").dataset.rows), [
    { date: "20240101", mean: 12.5, min: 4.5, max: 19.5, humidity: 76 },
    { date: "20240102", mean: 13.25, min: 3.75, max: 21.25, humidity: 81 }
  ]);
  assert.equal(elements.get("metric-temp").textContent, "3.8");
  assert.equal(elements.get("metric-humidity").textContent, "81");
  assert.equal(elements.get("connection-label").textContent, "Datos de NASA POWER");
  assert.equal(elements.get("source-label").textContent, "Fuente: NASA POWER · datos diarios");
});

test("aborta a los 6000 ms y conmuta automáticamente al modo respaldo", async () => {
  const { elements, timers } = createHarness((_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
  }));
  const timeout = timers.find(timer => timer.delay === 6000);
  assert.ok(timeout, "fetch must have a strict 6000 ms timeout");

  timeout.callback();
  await settle();

  assert.equal(elements.get("connection-label").textContent, "Datos simulados");
  assert.ok(elements.get("fallback-banner").classList.contains("flex"));
  assert.match(html, new RegExp(BACKUP_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(elements.get("fallback-detail").textContent, /superó el límite de 6 segundos/);
  assert.equal(elements.get("source-label").textContent, "Fuente: datos simulados · no son observaciones NASA POWER");
});

test("los datos de respaldo nunca se presentan como observaciones reales de NASA POWER", async () => {
  const { elements } = createHarness(async () => {
    throw new Error("offline");
  });
  await settle();

  const source = elements.get("source-label").textContent;
  assert.equal(elements.get("connection-label").textContent, "Datos simulados");
  assert.ok(elements.get("fallback-banner").classList.contains("flex"));
  assert.match(source, /datos simulados/);
  assert.match(source, /no son observaciones NASA POWER/);
  assert.doesNotMatch(source, /Fuente: NASA POWER/);
  assert.doesNotMatch(elements.get("connection-label").textContent, /NASA POWER/);
});
