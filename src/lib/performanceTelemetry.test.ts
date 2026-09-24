import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  classifyAdminApiPerformance,
  fetchJsonWithAdminPerformance,
  fetchWithAdminPerformance,
  normalizeAdminApiPerformance,
  normalizeWebVitalPerformance,
  preparePerformanceAnalyticsEvent,
  sanitizePerformancePath,
} from "@/lib/performanceTelemetry";

test("performance paths remove merchant, card and record identifiers", () => {
  assert.equal(sanitizePerformancePath("/10909094"), "/:merchant");
  assert.equal(sanitizePerformancePath("/site/10000000/products"), "/site/:merchant/products");
  assert.equal(sanitizePerformancePath("/card/felix-phzzdt"), "/card/:card");
  assert.equal(
    sanitizePerformancePath("/admin/orders/550e8400-e29b-41d4-a716-446655440000?view=detail"),
    "/admin/orders/:id",
  );
});

test("web vital normalization validates names and stores CLS at useful precision", () => {
  assert.equal(normalizeWebVitalPerformance({ name: "unknown", value: 100 }), null);
  assert.deepEqual(
    normalizeWebVitalPerformance({
      name: "CLS",
      value: 0.1234,
      rating: "poor",
      navigationType: "navigate",
    }),
    {
      kind: "web_vital",
      name: "CLS",
      value: 123,
      rating: "poor",
      pagePath: "/",
      detail: "unit=score_x1000;nav=navigate",
    },
  );
});

test("admin API timing classifies failures and slow responses", () => {
  assert.equal(classifyAdminApiPerformance(120, 200), "good");
  assert.equal(classifyAdminApiPerformance(900, 200), "needs-improvement");
  assert.equal(classifyAdminApiPerformance(2600, 200), "poor");
  assert.equal(classifyAdminApiPerformance(120, 500), "poor");
  assert.equal(classifyAdminApiPerformance(120, 0), "poor");
});

const runtime = {
  pagePath: "/admin",
  device: "desktop",
  network: "4g",
  saveData: false,
  build: "123456abcdef",
};

function adminMetric(durationMs: number, status = 200) {
  return {
    kind: "admin_api" as const,
    name: "GET:/api/orders",
    value: durationMs,
    rating: classifyAdminApiPerformance(durationMs, status),
    pagePath: "/admin",
    detail: `status=${status};ok=${status >= 200 && status < 400 ? 1 : 0};unit=ms`,
  };
}

function detailFields(detail: string) {
  return Object.fromEntries(detail.split(";").map((part) => part.split("=")));
}

test("uniform SLO sample includes good, slow and failed requests once; only extras are diagnostics", () => {
  for (const metric of [adminMetric(100), adminMetric(900), adminMetric(3000), adminMetric(100, 500)]) {
    const diagnostic = metric.rating !== "good";
    for (const sampled of [false, true]) {
      const event = preparePerformanceAnalyticsEvent(metric, runtime, {
        sampled,
        diagnostic,
        rate: 0.1,
        unit: "session",
      });
      if (!sampled && !diagnostic) {
        assert.equal(event, null);
        continue;
      }
      assert.ok(event);
      const fields = detailFields(event.detail);
      assert.equal(fields.perf_v, "2");
      assert.equal(fields.sample, sampled ? "slo" : "diagnostic");
      assert.equal(fields.sample_rate, "0.1");
      assert.equal(fields.report_rate, diagnostic ? "1" : "0.1");
      assert.equal(fields.sample_unit, "session");
      assert.equal(fields.phase, "headers");
      assert.equal(event.value, metric.value);
      assert.equal(event.rating, metric.rating);
      assert.equal(event.name, metric.name);
    }
  }
});

test("poor web vitals inside the cohort remain SLO samples and preserve CLS units", () => {
  const metric = normalizeWebVitalPerformance({
    name: "CLS",
    value: 0.35,
    rating: "poor",
    navigationType: "back-forward-cache",
  });
  assert.ok(metric);
  for (const sampled of [false, true]) {
    const event = preparePerformanceAnalyticsEvent(metric, runtime, {
      sampled,
      diagnostic: true,
      rate: 0.2,
      unit: "session",
    });
    assert.ok(event);
    const fields = detailFields(event.detail);
    assert.equal(fields.sample, sampled ? "slo" : "diagnostic");
    assert.equal(fields.sample_rate, "0.2");
    assert.equal(fields.report_rate, "1");
    assert.equal(fields.phase, "web_vital");
    assert.equal(fields.unit, "score_x1000");
    assert.equal(fields.nav, "back-forward-cache");
    assert.equal(event.value, 350);
  }
});

test("storage-restricted per-event fallback is distinguishable from session sampling", () => {
  const event = preparePerformanceAnalyticsEvent(adminMetric(900), runtime, {
    sampled: true,
    diagnostic: true,
    rate: 0.1,
    unit: "event",
  });
  assert.ok(event);
  assert.equal(detailFields(event.detail).sample_unit, "event");
  assert.equal(detailFields(event.detail).sample, "slo");
});

test("sampling metadata survives the full 240-character analytics reason limit without partial fields", () => {
  const metric = normalizeWebVitalPerformance({
    name: "LCP",
    value: 3000,
    rating: "needs-improvement",
    navigationType: "n".repeat(32),
  });
  assert.ok(metric);
  const event = preparePerformanceAnalyticsEvent(metric, { ...runtime, network: "n".repeat(16) }, {
    sampled: true,
    diagnostic: false,
    rate: 0.2,
    unit: "session",
  });
  assert.ok(event);
  const storedReason = `rating=${event.rating};${event.detail}`;
  assert.ok(storedReason.length <= 240);
  const fields = detailFields(storedReason.slice(0, 240));
  assert.equal(fields.rating, "needs-improvement");
  assert.equal(fields.perf_v, "2");
  assert.equal(fields.sample, "slo");
  assert.equal(fields.sample_rate, "0.2");
  assert.equal(fields.report_rate, "0.2");
  assert.equal(fields.sample_unit, "session");
  assert.equal(fields.phase, "web_vital");
  assert.equal(fields.unit, "ms");
  assert.equal(fields.nav, "n".repeat(32));
  assert.equal(fields.build, runtime.build);
  assert.ok(fields.network === undefined || fields.network === "n".repeat(16));
});

test("sampling context does not expose contact-card identifiers or query secrets", () => {
  const event = preparePerformanceAnalyticsEvent(adminMetric(100), {
    ...runtime,
    pagePath: "/card/private-customer?email=customer@example.com&token=secret#account",
  }, {
    sampled: true,
    diagnostic: false,
    rate: 0.1,
    unit: "session",
  });
  assert.ok(event);
  assert.equal(event.pagePath, "/card/:card");
  assert.doesNotMatch(JSON.stringify(event), /private-customer|customer@example|secret|account/);
});

function installBrowser(t: TestContext, options: { cohort?: "0" | "1"; brokenContext?: boolean } = {}) {
  const originals = ["window", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const values = new Map<string, string>();
  let samplingReads = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { hostname: "launch.faolla.com", origin: "https://launch.faolla.com", pathname: "/admin" },
      innerWidth: 1440,
      sessionStorage: {
        getItem(key: string) {
          samplingReads += 1;
          return options.cohort ?? values.get(key) ?? null;
        },
        setItem(key: string, value: string) { values.set(key, value); },
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    get() {
      if (options.brokenContext) throw new Error("browser_context_unavailable");
      return { documentElement: { dataset: { faollaBuild: runtime.build } } };
    },
  });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { values, samplingReads: () => samplingReads };
}

test("fetch instrumentation forwards arguments and returns the original unconsumed response", async (t) => {
  installBrowser(t, { cohort: "0" });
  const response = new Response('{"ok":true}', { status: 200 });
  const controller = new AbortController();
  const input = "/api/orders?siteId=10000000&email=customer@example.com";
  const init = { credentials: "same-origin" as const, signal: controller.signal };
  const calls = t.mock.method(globalThis, "fetch", async (actualInput: RequestInfo | URL, actualInit?: RequestInit) => {
    assert.equal(actualInput, input);
    assert.equal(actualInit, init);
    return response;
  });
  const actual = await fetchWithAdminPerformance(input, init);
  assert.equal(actual, response);
  assert.equal(actual.bodyUsed, false);
  assert.deepEqual(await actual.json(), { ok: true });
  assert.equal(calls.mock.callCount(), 1);
});

test("slow/error capture still reads the uniform cohort; telemetry failure cannot change a response", async (t) => {
  const browser = installBrowser(t, { brokenContext: true });
  t.mock.method(Math, "random", () => 0.05);
  const response = new Response("unavailable", { status: 503 });
  t.mock.method(globalThis, "fetch", async () => response);
  assert.equal(await fetchWithAdminPerformance("/api/orders"), response);
  assert.equal(browser.samplingReads(), 1);
  assert.equal(browser.values.get("faolla:performance-sample:v1:admin_api"), "1");
  assert.equal(response.bodyUsed, false);
});

test("fetch rejection and abort identity survive telemetry context failures without retries", async (t) => {
  installBrowser(t, { cohort: "1", brokenContext: true });
  const failure = new Error("upstream_request_failed");
  const abort = new DOMException("cancelled", "AbortError");
  const failures = [failure, abort];
  const calls = t.mock.method(globalThis, "fetch", async () => { throw failures.shift(); });
  await assert.rejects(fetchWithAdminPerformance("/api/orders"), (error) => error === failure);
  await assert.rejects(fetchWithAdminPerformance("/api/orders"), (error) => error === abort);
  assert.equal(calls.mock.callCount(), 2);
});

test("cross-origin and non-API fetches do not read telemetry sampling storage", async (t) => {
  const browser = installBrowser(t, { brokenContext: true });
  const response = new Response("ok");
  t.mock.method(globalThis, "fetch", async () => response);
  assert.equal(await fetchWithAdminPerformance("https://other.example/api/orders"), response);
  assert.equal(await fetchWithAdminPerformance("/images/card.png"), response);
  assert.equal(browser.samplingReads(), 0);
});

test("JSON phase metadata distinguishes body errors without losing HTTP status or leaking payloads", () => {
  for (const json of ["ok", "error", "not_started"] as const) {
    const metric = normalizeAdminApiPerformance({
      endpoint: "/api/merchant-customers",
      method: "GET",
      durationMs: 25,
      status: json === "not_started" ? 0 : 200,
      ok: json !== "not_started",
      phase: "json",
      json,
    });
    assert.equal(metric.rating, json === "ok" ? "good" : "poor");
    const event = preparePerformanceAnalyticsEvent(metric, runtime, {
      sampled: true,
      rate: 0.1,
      unit: "session",
      diagnostic: metric.rating !== "good",
    });
    assert.ok(event);
    const fields = detailFields(event.detail);
    assert.equal(fields.phase, "json");
    assert.equal(fields.json, json);
    assert.equal(fields.status, json === "not_started" ? "0" : "200");
    assert.equal(fields.sample, "slo");
    assert.equal(fields.report_rate, json === "ok" ? "0.1" : "1");
    assert.ok(`rating=${event.rating};${event.detail}`.length <= 240);
    assert.doesNotMatch(JSON.stringify(event), /customer@example|response_body|stack|error_message/);
  }
});

test("JSON helper waits for a delayed body, consumes it once and measures only at completion", async (t) => {
  const browser = installBrowser(t, { cohort: "1", brokenContext: true });
  let now = 100;
  const clockReads: number[] = [];
  t.mock.method(performance, "now", () => { clockReads.push(now); return now; });
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
  const response = new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
  const readJson = t.mock.method(response, "json", response.json.bind(response));
  const clone = t.mock.method(response, "clone", () => { throw new Error("body_must_not_be_cloned"); });
  const input = new Request("https://launch.faolla.com/api/merchant-customers?siteId=10000000");
  const init = { cache: "no-store" as const, signal: new AbortController().signal };
  const requests = t.mock.method(globalThis, "fetch", async (actualInput: RequestInfo | URL, actualInit?: RequestInit) => {
    assert.equal(actualInput, input);
    assert.equal(actualInit, init);
    return response;
  });
  let completed = false;
  const task = fetchJsonWithAdminPerformance<{ customers: string[] }>(input, init).then((result) => {
    completed = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(readJson.mock.callCount(), 1);
  assert.equal(completed, false);
  assert.deepEqual(clockReads, [100]);
  assert.equal(browser.samplingReads(), 0);
  now = 400;
  body.enqueue(new TextEncoder().encode('{"customers":['));
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(browser.samplingReads(), 0);
  now = 750;
  body.enqueue(new TextEncoder().encode('"customer"]}'));
  body.close();
  const result = await task;
  assert.equal(result.response, response);
  assert.deepEqual(result.data, { customers: ["customer"] });
  assert.equal(response.bodyUsed, true);
  assert.equal(readJson.mock.callCount(), 1);
  assert.equal(clone.mock.callCount(), 0);
  assert.equal(requests.mock.callCount(), 1);
  assert.deepEqual(clockReads, [100, 750]);
  assert.equal(browser.samplingReads(), 1);
});

test("JSON helper returns HTTP failure responses and parsed error payloads without throwing", async (t) => {
  const browser = installBrowser(t, { cohort: "1", brokenContext: true });
  const response = new Response('{"error":"permission_denied"}', { status: 403 });
  t.mock.method(globalThis, "fetch", async () => response);
  const result = await fetchJsonWithAdminPerformance<{ error: string }>("/api/merchant-customers");
  assert.equal(result.response, response);
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.data, { error: "permission_denied" });
  assert.equal(browser.samplingReads(), 1);
});

test("JSON helper preserves the actual malformed-JSON rejection object by default", async (t) => {
  const browser = installBrowser(t, { cohort: "1", brokenContext: true });
  const response = new Response('{"private":"customer@example.com", broken}', { status: 200 });
  const nativeJson = response.json.bind(response);
  let parseError: unknown;
  const json = t.mock.method(response, "json", () => nativeJson().catch((error) => { parseError = error; throw error; }));
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(fetchJsonWithAdminPerformance("/api/merchant-customers"), (error) => {
    assert.equal(error, parseError);
    return error instanceof SyntaxError;
  });
  assert.equal(json.mock.callCount(), 1);
  assert.equal(browser.samplingReads(), 1);
});

test("explicit JSON null fallback keeps existing consumer semantics but never swallows network errors", async (t) => {
  const browser = installBrowser(t, { cohort: "1", brokenContext: true });
  const response = new Response("not json", { status: 200 });
  const failure = new TypeError("network unavailable");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls > 1) throw failure;
    return response;
  });
  const result = await fetchJsonWithAdminPerformance("/api/merchant-customers", {}, { jsonErrorFallback: null });
  assert.equal(result.response, response);
  assert.equal(result.data, null);
  await assert.rejects(
    fetchJsonWithAdminPerformance("/api/merchant-customers", {}, { jsonErrorFallback: null }),
    (error) => error === failure,
  );
  assert.equal(calls, 2);
  assert.equal(browser.samplingReads(), 2);
});

test("JSON helper retains abort identity before headers and while reading the response body", async (t) => {
  const browser = installBrowser(t, { cohort: "1", brokenContext: true });
  const abort = new DOMException("cancelled", "AbortError");
  const controller = new AbortController();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(body) { streamController = body; } }));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) throw abort;
    controller.signal.addEventListener("abort", () => streamController.error(controller.signal.reason), { once: true });
    return response;
  });
  await assert.rejects(fetchJsonWithAdminPerformance("/api/merchant-customers"), (error) => error === abort);
  const reading = fetchJsonWithAdminPerformance("/api/merchant-customers", { signal: controller.signal });
  await Promise.resolve();
  controller.abort(abort);
  await assert.rejects(reading, (error) => error === abort);
  assert.equal(calls, 2);
  assert.equal(browser.samplingReads(), 2);
});

test("explicit JSON fallback also matches legacy body-abort catch behavior", async (t) => {
  installBrowser(t, { cohort: "1", brokenContext: true });
  const abort = new DOMException("cancelled", "AbortError");
  const response = new Response("body");
  t.mock.method(response, "json", async () => { throw abort; });
  t.mock.method(globalThis, "fetch", async () => response);
  const result = await fetchJsonWithAdminPerformance("/api/merchant-customers", {}, { jsonErrorFallback: null });
  assert.equal(result.response, response);
  assert.equal(result.data, null);
});
