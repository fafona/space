import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAdminApiPerformance,
  normalizeWebVitalPerformance,
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
