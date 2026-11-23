import assert from "node:assert/strict";
import test from "node:test";
import { checkoutReportingNeedsReview, checkoutReportingSettlement, checkoutReportingTsv, parseCheckoutReportingRequest, parseCheckoutReportingSnapshot } from "./merchantCheckoutReporting";
import { summarizeMerchantSettlement } from "./merchantSettlement";
import { readCheckoutReporting, readMixedCheckoutReporting } from "./merchantCheckoutReporting.server";
import { normalizeMerchantOrderRecord } from "./merchantOrders";

const siteId = "10909095", scope = { siteId, resources: [{ kind: "order" as const, id: "O123" }] };
function fixture() {
  return { version: 1 as const, siteId, rows: [{ kind: "order" as const, id: "O123", termsMatch: true,
    result: { version: 1 as const, siteId, operationKey: "a".repeat(64), resourceKind: "order" as const, resourceId: "O123", totalPoints: 100, couponCount: 1,
      closed: false, resource: { status: "pending", updatedAt: "2026-11-23T12:00:00Z" }, cancellationAvailable: false,
      cancellationPolicy: { returnPoints: true, returnCoupons: false, advanceMinutes: 0, cancellableUntil: null }, cancellation: null as null | { pointsReturned: number; couponsReturned: number; stockReleased: number; cancelledAt: string } } }] };
}
test("bounded lookup keys accept the same ID in different kinds, not duplicate/foreign/authority inputs", () => {
  assert.deepEqual(parseCheckoutReportingRequest(scope), scope);
  assert.equal(parseCheckoutReportingRequest({ siteId, resources: [{ kind: "booking", id: "O123" }, ...scope.resources] }).resources.length, 2);
  for (const raw of [{ ...scope, accountId: "50010105" }, { ...scope, resources: [] }, { ...scope, resources: [...scope.resources, ...scope.resources] },
    { ...scope, siteId: " 10909095" }, { ...scope, resources: Array.from({ length: 51 }, (_, i) => ({ kind: "order", id: `O${i}` })) },
    { ...scope, resources: [{ kind: "booking", id: "O123", paid: true }] }, { ...scope, resources: [{ kind: "other", id: "O123" }] },
    { ...scope, resources: [{ kind: "order", id: "=IMPORTXML()" }] }]) assert.throws(() => parseCheckoutReportingRequest(raw), /checkout_reporting_invalid/);
});
test("report is exact-order allowlisted without member/contact/coupon secrets", () => {
  const raw = fixture();
  const parsed = parseCheckoutReportingSnapshot({ ...raw, secret: "private", rows: [{ ...raw.rows[0], secret: "private", result: { ...raw.rows[0].result,
    membershipId: "private-member", principalKey: "private-principal", couponUses: ["private-code"], customer: { email: "private@example.invalid" } } }] }, scope);
  assert.deepEqual(parsed, raw); assert.ok(!JSON.stringify(parsed).includes("private"));
});
test("missing, reordered, cross-site/kind/id and contradicting response rows refuse the whole report", () => {
  const raw = fixture();
  for (const value of [{ ...raw, siteId: "10909096" }, { ...raw, rows: [] }, { ...raw, rows: [...raw.rows, ...raw.rows] },
    { ...raw, rows: [{ ...raw.rows[0], id: "O124" }] }, { ...raw, rows: [{ ...raw.rows[0], kind: "booking" }] },
    { ...raw, rows: [{ ...raw.rows[0], result: { ...raw.rows[0].result, siteId: "10909096" } }] },
    { ...raw, rows: [{ ...raw.rows[0], result: { ...raw.rows[0].result, resourceId: "other" } }] },
    { ...raw, rows: [{ ...raw.rows[0], result: null }] },
    { ...raw, rows: [{ ...raw.rows[0], result: { ...raw.rows[0].result, operationKey: "not-a-key" } }] }]) assert.throws(() => parseCheckoutReportingSnapshot(value, scope));
});
test("a confirmed unlinked resource has no inferred free/unpaid/cash-paid settlement", () => {
  const raw = { version: 1 as const, siteId, rows: [{ kind: "order" as const, id: "O123", termsMatch: false, result: null }] };
  const row = parseCheckoutReportingSnapshot(raw, scope).rows[0];
  assert.equal(checkoutReportingSettlement(row), null); assert.equal(checkoutReportingNeedsReview(row), false);
  assert.ok(!/unpaid|cash|free/.test(checkoutReportingTsv(raw)));
});
test("mixed report projects cash independently from business status, preserves points and exports integer amounts without secrets", async () => {
  const raw = fixture(), cashId = "O-CASH", q = { siteId, resources: [...scope.resources, { kind: "order" as const, id: cashId }] };
  const cash = { version: 2, siteId, operationKey: "c".repeat(64), terms: { version: 2, method: "on_site", resourceKind: "order", resourceId: cashId, currency: "eur", grossMinor: 1000, discountMinor: 200, dueMinor: 800, capturedMinor: 0, totalPoints: null, couponCount: 1, paymentState: "unpaid" },
    closed: false, termsMatch: true, resource: { status: "completed", updatedAt: "2026-11-23T12:00:00Z" }, cancellationAvailable: false, cancellationPolicy: { returnCoupons: true, advanceMinutes: 0, cancellableUntil: null }, collection: null, cancellation: null, privateCode: "SECRET" };
  const mixed = { version: 2, siteId, rows: [...raw.rows, { kind: "order", id: cashId, result: null, termsMatch: true, onSite: cash }] };
  const parsed = await readMixedCheckoutReporting(q, async name => { assert.equal(name, "faolla_member_checkout_reporting_v2"); return { data: mixed, error: null }; });
  assert.equal(parsed.rows[1].onSite?.collection, null); assert.equal(parsed.rows[0].result?.totalPoints, 100); assert.equal(checkoutReportingNeedsReview(parsed.rows[1]), false);
  assert.ok(!JSON.stringify(parsed).includes("SECRET")); const exported = checkoutReportingTsv(parsed); assert.ok(exported.includes("merchant_recorded_cash_minor")); assert.ok(exported.includes("\t1000\t200\t800\t0\t"));
  assert.throws(() => parseCheckoutReportingSnapshot({ ...mixed, version: 1 }, q));
  assert.throws(() => parseCheckoutReportingSnapshot({ ...mixed, rows: [...raw.rows, { ...mixed.rows[1], termsMatch: false }] }, q));
  await assert.rejects(readMixedCheckoutReporting(q, async () => ({ data: { ...mixed, version: 1 }, error: null })), /checkout_reporting_unavailable/);
});
test("original points, coupon-only and policy retention display actual ledger facts independently of business state", () => {
  const raw = fixture(), row = raw.rows[0];
  assert.equal(summarizeMerchantSettlement(checkoutReportingSettlement(row)!).state, "points_redeemed");
  row.result.closed = true; row.result.resource.status = "cancelled";
  row.result.cancellation = { pointsReturned: 100, couponsReturned: 0, stockReleased: 1, cancelledAt: "2026-11-23T12:01:00Z" };
  const summary = summarizeMerchantSettlement(checkoutReportingSettlement(row)!);
  assert.equal(summary.state, "points_returned"); assert.equal(summary.coupons?.state, "coupon_redeemed");
  assert.equal(checkoutReportingNeedsReview(row), false);
  row.result.totalPoints = 0; row.result.cancellation.pointsReturned = 0;
  assert.equal(summarizeMerchantSettlement(checkoutReportingSettlement(row)!).state, "coupon_redeemed");
  row.result.cancellation.couponsReturned = 1;
  assert.equal(summarizeMerchantSettlement(checkoutReportingSettlement(row)!).state, "coupon_returned");
});
test("missing/changed resources and cancellation without a return receipt require review, not fabricated refunds", () => {
  for (const mode of ["missing", "terms", "old-cancel", "old-restore"] as const) {
    const raw = fixture();
    if (mode === "missing") (raw.rows[0].result as { resource: unknown }).resource = null;
    if (mode === "terms") raw.rows[0].termsMatch = false;
    if (mode === "old-cancel") raw.rows[0].result.resource.status = "cancelled";
    if (mode === "old-restore") { raw.rows[0].result.closed = true; raw.rows[0].result.cancellation = { pointsReturned: 100, couponsReturned: 0, stockReleased: 1, cancelledAt: "2026-11-23T12:01:00Z" }; }
    const row = parseCheckoutReportingSnapshot(raw, scope).rows[0];
    assert.equal(checkoutReportingNeedsReview(row), true);
  }
});
test("export is just this page's facts; no receipt, private identity, formulas or fake cash amount", () => {
  const raw = fixture(), tsv = checkoutReportingTsv(raw);
  assert.ok(tsv.includes("100\t0\t1\t0\tfalse\tfalse"));
  assert.ok(!/operationKey|membership|couponUses|totalAmount|principal|cash/.test(tsv));
  const altered = { ...raw, rows: [{ ...raw.rows[0], id: "=HYPERLINK(\"evil\")\r\nnext" }] };
  assert.ok(checkoutReportingTsv(altered).includes("'=HYPERLINK"));
  assert.equal(checkoutReportingTsv(altered).split("\r\n").length, 2);
});
test("one safe RPC read only, with no fallback for a failed/malformed ledger", async () => {
  const calls: unknown[] = [];
  const report = await readCheckoutReporting(scope, async (name, args) => { calls.push([name, args]); return { data: fixture(), error: null }; });
  assert.deepEqual(report, fixture()); assert.deepEqual(calls, [["faolla_member_checkout_reporting_v1", { p_site_id: siteId, p_resources: scope.resources }]]);
  for (const mode of ["error", "throw", "null", "wrong"] as const) {
    let reads = 0;
    await assert.rejects(readCheckoutReporting(scope, async () => { reads++; if (mode === "throw") throw new Error("private SQL");
      return { data: mode === "null" ? null : mode === "wrong" ? {} : fixture(), error: mode === "error" ? { message: "private SQL" } : null }; }), /^Error: checkout_reporting_unavailable$/);
    assert.equal(reads, 1);
  }
});
test("diagnosis: legacy order projection drops the raw marker; ledger lookup must not rely on it", () => {
  const raw = { id: "O123", siteId, status: "pending", items: [], checkoutOperationKey: "a".repeat(64) };
  const normalized = normalizeMerchantOrderRecord(raw as Parameters<typeof normalizeMerchantOrderRecord>[0]);
  assert.ok(normalized); assert.equal(Object.hasOwn(normalized!, "checkoutOperationKey"), false);
  // Evidence only: no alteration to the old normalizer or any live record.
  assert.equal(raw.checkoutOperationKey, "a".repeat(64));
});
