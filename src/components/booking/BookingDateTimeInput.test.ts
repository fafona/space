import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDateText, normalizeTimeText } from "./BookingDateTimeInput";

test("normalizeDateText clamps month and day to legal upper bounds", () => {
  assert.equal(normalizeDateText("66666666"), "6666-12-31");
  assert.equal(normalizeDateText("20260231"), "2026-02-28");
  assert.equal(normalizeDateText("20240231"), "2024-02-29");
});

test("normalizeTimeText clamps hour and minute to legal upper bounds", () => {
  assert.equal(normalizeTimeText("6666"), "23:59");
  assert.equal(normalizeTimeText("2460"), "23:59");
  assert.equal(normalizeTimeText("1261"), "12:59");
});
