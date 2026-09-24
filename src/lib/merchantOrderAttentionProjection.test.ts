import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantOrderAttentionProjection,
  MERCHANT_ORDER_ATTENTION_MAX_SOURCE_BYTES,
  MERCHANT_ORDER_ATTENTION_MAX_SOURCE_ROWS,
} from "@/lib/merchantOrderAttentionProjection";
import { summarizeMerchantOrderAttentionRecords } from "@/lib/merchantOrderAttention";
import { mergeStoredMerchantOrdersRows } from "@/lib/merchantOrdersStore";
import { normalizeMerchantOrderRecord, type MerchantOrderRecord } from "@/lib/merchantOrders";

const SITE = "10000000";
const DATE = "2026-09-24T10:00:00.000Z";

function order(id: string, overrides: Partial<MerchantOrderRecord> = {}) {
  const result = normalizeMerchantOrderRecord({
    id, siteId: SITE, createdAt: DATE, updatedAt: DATE, status: "pending",
    customer: { name: id, phone: "private-phone", email: "private-email", note: "private-note" },
    items: [], ...overrides,
  });
  assert.ok(result);
  return result;
}

function row(chunk: string | null, blocks: unknown[], id: string = chunk ?? "root") {
  return { id, merchant_id: SITE, slug: `__merchant_orders__:${SITE}${chunk === null ? "" : `:chunk:${chunk}`}`, blocks, updated_at: DATE };
}

test("empty snapshot and empty root/chunks preserve exact zero summary", () => {
  for (const rows of [[], [row(null, [])], [row("0", [])], [row(null, []), row("0", [])]]) {
    assert.deepEqual(buildMerchantOrderAttentionProjection(rows, SITE), { supported: true, attention: { count: 0, latest: null } });
  }
});

test("chunks replace the legacy root including stale root PII and unsupported ignored root timestamps", () => {
  const rows = [row(null, [{ ...order("old-root"), createdAt: "ambiguous", updatedAt: "invalid" }]), row("0", [order("active")])];
  const result = buildMerchantOrderAttentionProjection(rows, SITE);
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.equal(result.attention.count, 1);
  assert.equal(result.attention.latest?.key, "order:active");
  assert.doesNotMatch(JSON.stringify(result), /private-|old-root|customer|items|blocks/);
});

test("first normalized ID wins BEFORE pending filtering, across numeric chunk ordering", () => {
  const rows = [
    row("10", [order("same", { updatedAt: "2026-09-26T00:00:00Z" }), order("other")]),
    row("2", [order("same", { status: "completed" })]),
  ];
  const result = buildMerchantOrderAttentionProjection(rows, SITE);
  assert.deepEqual(result, { supported: true, attention: summarizeMerchantOrderAttentionRecords(mergeStoredMerchantOrdersRows(SITE, rows)?.orders ?? [], SITE) });
  assert.equal(result.supported && result.attention.count, 1);
  assert.equal(result.supported && result.attention.latest?.key, "order:other");
  rows[1].blocks = [order("same", { merchantTouchedAt: DATE })];
  assert.equal(buildMerchantOrderAttentionProjection(rows, SITE).supported, true);
  const touched = buildMerchantOrderAttentionProjection(rows, SITE);
  assert.equal(touched.supported && touched.attention.count, 1);
});

test("within one row, createdAt-desc stable order determines duplicate authority, not updatedAt", () => {
  const olderCreated = order("same", { createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-26T00:00:00Z" });
  const newerCreated = order("same", { createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z", status: "completed" });
  const result = buildMerchantOrderAttentionProjection([row(null, [olderCreated, newerCreated])], SITE);
  assert.deepEqual(result, { supported: true, attention: { count: 0, latest: null } });
  const first = order("same", { customer: { name: "First", phone: "", email: "", note: "" } });
  const second = order("same", { customer: { name: "Second", phone: "", email: "", note: "" } });
  const tied = buildMerchantOrderAttentionProjection([row("0", [first, second])], SITE);
  assert.equal(tied.supported && tied.attention.latest?.title, "新订单 - First");
});

test("equal numeric chunk indexes retain source query row order, with UTF-16 notification ties", () => {
  const rows = [row("00000", [order("same", { status: "confirmed" })], "a"), row("0", [order("same"), order("9"), order("10")], "b")];
  const result = buildMerchantOrderAttentionProjection(rows, SITE);
  assert.equal(result.supported && result.attention.count, 2);
  assert.equal(result.supported && result.attention.latest?.key, "order:9");
  const reversed = buildMerchantOrderAttentionProjection([...rows].reverse(), SITE);
  assert.equal(reversed.supported && reversed.attention.count, 3);
});

test("normalizes all raw line items and unknown statuses before counting and formatting", () => {
  const raw = { ...order("  raw  "), status: "historical-unknown", totalAmount: 123456, totalQuantity: 999,
    items: [{ name: "drop", quantity: 0, unitPrice: 999 }, { name: "One", quantity: 2, unitPrice: 1.005 },
      { name: "Two", quantity: 3, unitPrice: 0.99 }, { name: "Three", quantity: 4, unitPrice: 1 }], pricePrefix: " € " };
  const rows = [row(null, [raw])];
  const result = buildMerchantOrderAttentionProjection(rows, SITE);
  assert.deepEqual(result, { supported: true, attention: summarizeMerchantOrderAttentionRecords(mergeStoredMerchantOrdersRows(SITE, rows)?.orders ?? [], SITE) });
  assert.equal(result.supported && result.attention.latest?.body, "One×2、Two×3 · €8.97");
});

test("scope/schema failures are fixed-code unsupported results, not empty successful summaries or PII errors", () => {
  const good = row(null, [order("good")]);
  for (const rows of [null, {}, [null], [[]], [{ ...good, blocks: {} }], [{ ...good, slug: `${good.slug}:junk` }],
    [{ ...good, slug: `${good.slug} ` }], [{ ...good, slug: `${good.slug}:chunk:-1` }],
    [{ ...good, slug: `${good.slug}:chunk:9007199254740992` }], [{ ...good, id: "" }]]) {
    assert.deepEqual(buildMerchantOrderAttentionProjection(rows, SITE), { supported: false, reason: "invalid_source" });
  }
  assert.deepEqual(buildMerchantOrderAttentionProjection([good], "bad-site"), { supported: false, reason: "invalid_source" });
  assert.deepEqual(buildMerchantOrderAttentionProjection([{ ...good, merchant_id: "20000000" }], SITE), { supported: false, reason: "site_mismatch" });
  assert.deepEqual(buildMerchantOrderAttentionProjection([row(null, [order("other", { siteId: "20000000" })])], SITE), { supported: false, reason: "site_mismatch" });
  assert.deepEqual(buildMerchantOrderAttentionProjection([row(null, [{ ...order("private-id"), id: " " }])], SITE), { supported: false, reason: "invalid_record" });
});

test("all authoritative raw records need deterministic dates, even nonpending and deduplicated records", () => {
  for (const bad of [
    { ...order("private-name"), createdAt: "" }, { ...order("private-name"), updatedAt: "2026-09-24T10:00:00" },
    { ...order("private-name", { status: "completed" }), updatedAt: "invalid" },
  ]) {
    assert.deepEqual(buildMerchantOrderAttentionProjection([row(null, [bad])], SITE), { supported: false, reason: "unsupported_timestamp" });
    assert.deepEqual(buildMerchantOrderAttentionProjection([row("0", [order("private-name")]), row("1", [bad])], SITE), { supported: false, reason: "unsupported_timestamp" });
  }
});

test("bounded rows/UTF-8 bytes and non-JSON snapshots reject without serializing exception details", () => {
  const rows = Array.from({ length: MERCHANT_ORDER_ATTENTION_MAX_SOURCE_ROWS }, (_, index) => row(String(index), []));
  assert.equal(buildMerchantOrderAttentionProjection(rows, SITE).supported, true);
  assert.deepEqual(buildMerchantOrderAttentionProjection([...rows, row("513", [])], SITE), { supported: false, reason: "source_limit" });
  const oversized = row(null, [order("big", { customer: { name: "", phone: "", email: "", note: "中".repeat(Math.ceil(MERCHANT_ORDER_ATTENTION_MAX_SOURCE_BYTES / 3)) } })]);
  // Use a raw oversized field: the ordinary order normalizer would trim it.
  (oversized.blocks[0] as MerchantOrderRecord).customer.note = "中".repeat(Math.ceil(MERCHANT_ORDER_ATTENTION_MAX_SOURCE_BYTES / 3));
  assert.deepEqual(buildMerchantOrderAttentionProjection([oversized], SITE), { supported: false, reason: "source_limit" });
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  assert.deepEqual(buildMerchantOrderAttentionProjection(cyclic, SITE), { supported: false, reason: "invalid_source" });
});

test("mixed full output equals existing authoritative store merge and leaves read snapshot untouched", () => {
  const rows = [row(null, [order("ignored")]), ...Array.from({ length: 12 }, (_, chunk) => row(String(chunk).padStart(5, "0"),
    Array.from({ length: 18 }, (_, index) => order(String(index), {
      status: index % 3 === 0 ? "completed" : "pending", merchantTouchedAt: index % 4 === 0 ? DATE : "",
      createdAt: `2026-09-${String(1 + (chunk + index) % 23).padStart(2, "0")}T00:00:00Z`,
      updatedAt: `2026-09-${String(1 + (chunk * 2 + index) % 23).padStart(2, "0")}T00:00:00Z`,
    })), String(chunk)))];
  const before = JSON.stringify(rows);
  const expected = summarizeMerchantOrderAttentionRecords(mergeStoredMerchantOrdersRows(SITE, rows)?.orders ?? [], SITE);
  assert.deepEqual(buildMerchantOrderAttentionProjection(rows, SITE), { supported: true, attention: expected });
  assert.equal(JSON.stringify(rows), before);
});
