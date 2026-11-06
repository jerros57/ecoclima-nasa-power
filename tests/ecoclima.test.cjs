"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "index.html must contain its inline application script");

class MockElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.value = "riobamba";
    this.disabled = false;
    this.href = "";
    this.textContent = "";
  }

  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  append(...nodes) {
    this.children.push(...nodes);
    this.textContent += nodes.map((node) => node.textContent || "").join("");
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
    this.textContent = nodes.map((node) => node.textContent || "").join("");
  }
}

class MockTimers {
  constructor() {
    this.nextId = 1;
    this.jobs = new Map();
  }

  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.jobs.set(id, { callback, delay });
    return id;
  }

  clearTimeout(id) {
    this.jobs.delete(id);
  }

  advance(delay) {
    const due = [...this.jobs.entries()].filter(([, job]) => job.delay <= delay);
    for (const [id, job] of due) {
      this.jobs.delete(id);
      job.callback();
    }
  }
}

const ids = [
  "location", "refresh", "refresh-label", "notice", "notice-text", "selected-place",
  "min-temperature", "humidity", "risk-metric", "risk-indicator",
  "risk-icon", "risk-label", "risk-detail", "chart", "chart-description",
  "chart-summary", "source-attribution", "source-link"
];

function validPayload({ minimum = 4, humidity = 70 } = {}) {
  const parameter = { T2M: {}, T2M_MIN: {}, T2M_MAX: {}, RH2M: {} };
  for (let day = 1; day <= 7; day += 1) {
    const date = `2024010${day}`;
    parameter.T2M[date] = 9;
    parameter.T2M_MIN[date] = minimum;
    parameter.T2M_MAX[date] = 17;
    parameter.RH2M[date] = humidity;
  }
  return { properties: { parameter } };
}

function ok(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function responseFailure(status) {
  return { ok: false, status, json: async () => ({}) };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function boot(fetchMock) {
  const elements = Object.fromEntries(ids.map((id) => [id, new MockElement(id)]));
  const timers = new MockTimers();
  const document = {
    getElementById: (id) => elements[id],
    createElement: () => new MockElement(),
    createElementNS: () => new MockElement(),
    createDocumentFragment: () => new MockElement(),
    createTextNode: (text) => ({ textContent: String(text) })
  };
  const context = {
    document,
    fetch: fetchMock,
    AbortController,
    DOMException,
    Error,
    URL,
    URLSearchParams,
    window: {
      setTimeout: timers.setTimeout.bind(timers),
      clearTimeout: timers.clearTimeout.bind(timers)
    }
  };
  vm.runInNewContext(scriptMatch[1], context, { filename: "index.html:inline-script" });
  return { elements, timers };
}

function assertFallback(elements) {
  assert.equal(elements.notice.dataset.mode, "fallback");
  assert.match(elements["notice-text"].textContent, /^MODO RESPALDO \(DATOS SIMULADOS\)/);
  assert.match(elements["source-attribution"].textContent, /simulados/i);
  assert.match(elements["source-attribution"].textContent, /no son observaciones de NASA POWER/i);
  assert.doesNotMatch(elements["source-attribution"].textContent, /Fuente meteorológica: NASA POWER/i);
  assert.doesNotMatch(elements["notice-text"].textContent, /HISTÓRICOS \(ENERO 2024\)/);
}

test("NASA POWER válida: métricas y aviso históricos, sin etiqueta de respaldo", async () => {
  const requests = [];
  const { elements } = boot(async (url, options) => {
    requests.push({ url: new URL(url), options });
    return ok(validPayload({ minimum: 1.5, humidity: 72 }));
  });
  await settle();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.searchParams.get("parameters"), "T2M,T2M_MIN,T2M_MAX,RH2M");
  assert.equal(requests[0].url.searchParams.get("start"), "20240101");
  assert.equal(requests[0].url.searchParams.get("end"), "20240107");
  assert.equal(requests[0].url.searchParams.get("latitude"), "-1.67");
  assert.equal(requests[0].url.searchParams.get("longitude"), "-78.65");
  assert.equal(requests[0].options.signal instanceof AbortSignal, true);
  assert.equal(elements["min-temperature"].textContent, "1.5 °C");
  assert.equal(elements.humidity.textContent, "72 %");
  assert.equal(elements.notice.dataset.mode, "live");
  assert.match(elements["notice-text"].textContent, /HISTÓRICOS \(ENERO 2024\)/);
  assert.doesNotMatch(elements["notice-text"].textContent, /SIMULADOS/);
  assert.match(elements["source-attribution"].textContent, /NASA POWER/);
});

test("faltan parámetros o valores diarios: todos usan respaldo explícitamente simulado", async (t) => {
  const cases = [
    ["T2M", (p) => delete p.properties.parameter.T2M],
    ["T2M_MIN", (p) => delete p.properties.parameter.T2M_MIN],
    ["T2M_MAX", (p) => delete p.properties.parameter.T2M_MAX],
    ["RH2M", (p) => delete p.properties.parameter.RH2M],
    ["temperatura diaria", (p) => delete p.properties.parameter.T2M_MIN["20240103"]],
    ["humedad diaria", (p) => delete p.properties.parameter.RH2M["20240103"]],
    ["humedad diaria null", (p) => { p.properties.parameter.RH2M["20240103"] = null; }]
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const payload = validPayload();
      mutate(payload);
      const { elements } = boot(async () => ok(payload));
      await settle();
      assertFallback(elements);
      assert.notEqual(elements["min-temperature"].textContent, "—");
    });
  }
});

test("respuestas HTTP 4xx y 5xx activan respaldo", async (t) => {
  for (const status of [400, 404, 429, 500, 503]) {
    await t.test(String(status), async () => {
      const { elements } = boot(async () => responseFailure(status));
      await settle();
      assertFallback(elements);
    });
  }
});

test("error de red activa respaldo y no atribuye simulados a NASA", async () => {
  const { elements } = boot(async () => { throw new TypeError("Network unavailable"); });
  await settle();
  assertFallback(elements);
});

test("AbortController activa respaldo solo al vencer los 6000 ms", async () => {
  let capturedSignal;
  const { elements, timers } = boot((_url, options) => {
    capturedSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      }, { once: true });
    });
  });
  await settle();
  assert.equal(capturedSignal.aborted, false);
  assert.notEqual(elements.notice.dataset.mode, "fallback");
  assert.equal(elements.refresh.disabled, true);
  assert.equal(elements.refresh.attributes["aria-busy"], "true");
  assert.equal(elements["refresh-label"].textContent, "Cargando…");
  const timeout = [...timers.jobs.values()].find((job) => job.delay === 6000);
  assert.ok(timeout, "a 6000 ms timeout must be scheduled");

  timers.advance(6000);
  await settle();
  assert.equal(capturedSignal.aborted, true);
  assertFallback(elements);
  assert.match(elements["notice-text"].textContent, /6 segundos/);
  assert.equal(elements.refresh.disabled, false);
  assert.equal(elements.refresh.attributes["aria-busy"], undefined);
  assert.equal(elements["refresh-label"].textContent, "Actualizar datos");
});

test("respuesta vacía o JSON inválido activan respaldo", async (t) => {
  const cases = [
    ["cuerpo HTTP vacío", async () => ({ ok: true, status: 204, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } })],
    ["JSON null", async () => ok(null)],
    ["estructura vacía", async () => ok({})],
    ["JSON inválido", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } })]
  ];
  for (const [name, fetchResult] of cases) {
    await t.test(name, async () => {
      const { elements } = boot(async () => fetchResult());
      await settle();
      assertFallback(elements);
    });
  }
});

test("cambio de localidad y botón Actualizar realizan nuevas consultas", async () => {
  const requests = [];
  const { elements } = boot(async (url) => {
    requests.push(new URL(url));
    return ok(validPayload({ minimum: requests.length === 1 ? 4 : 7 }));
  });
  await settle();
  elements.location.value = "guano";
  await elements.location.listeners.change();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].searchParams.get("latitude"), "-1.61");
  assert.equal(requests[1].searchParams.get("longitude"), "-78.63");
  assert.equal(elements["selected-place"].textContent, "Guano");

  await elements.refresh.listeners.click();
  assert.equal(requests.length, 3);
  assert.equal(elements["min-temperature"].textContent, "7.0 °C");
  assert.equal(elements.refresh.disabled, false);
});

test("semáforo respeta los umbrales comunicados en pantalla", async (t) => {
  const cases = [
    [2, "red", "ALTO"],
    [2.01, "yellow", "PRECAUCIÓN"],
    [5, "yellow", "PRECAUCIÓN"],
    [5.01, "green", "BAJO"]
  ];
  for (const [minimum, risk, label] of cases) {
    await t.test(`${minimum} °C → ${label}`, async () => {
      const { elements } = boot(async () => ok(validPayload({ minimum })));
      await settle();
      assert.equal(elements["risk-indicator"].dataset.risk, risk);
      assert.equal(elements["risk-label"].textContent, label);
      assert.equal(elements["risk-metric"].textContent, label);
    });
  }
});

test("controles y visualización tienen etiquetas accesibles esenciales", () => {
  assert.match(html, /<label for="location">/);
  assert.match(html, /<button[^>]*id="refresh"[^>]*type="button"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<svg[^>]*role="img"[^>]*aria-labelledby="chart-svg-title chart-description"/);
  for (const location of ["Riobamba Centro", "Guano", "Colta", "Alausí"]) {
    assert.ok(html.includes(location), `missing location option: ${location}`);
  }
});
