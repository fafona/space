import assert from "node:assert/strict";
import test from "node:test";
import { checkoutReportingNeedsReview, checkoutReportingSettlement, checkoutReportingTsv, parseCheckoutReportingRequest, parseCheckoutReportingSnapshot } from "./merchantCheckoutReporting";
import { summarizeMerchantSettlement } from "./merchantSettlement";
import { readCheckoutReporting, readMixedCheckoutReporting, readCartCheckoutReporting } from "./merchantCheckoutReporting.server";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { normalizeMerchantOrderRecord } from "./merchantOrders";
import { legacyCheckoutPointTransitions } from "./merchantCheckoutLegacyBoundary.server";

const siteId = "10909095", scope = { siteId, resources: [{ kind: "order" as const, id: "O123" }] };
function fixture() {
  return { version: 1 as const, siteId, rows: [{ kind: "order" as const, id: "O123", termsMatch: true,
    result: { version: 1 as const, siteId, operationKey: "a".repeat(64), resourceKind: "order" as const, resourceId: "O123", totalPoints: 100, couponCount: 1,
      closed: false, resource: { status: "pending", updatedAt: "2026-11-23T12:00:00Z" }, cancellationAvailable: false,
      cancellationPolicy: { returnPoints: true, returnCoupons: false, advanceMinutes: 0, cancellableUntil: null }, cancellation: null as null | { pointsReturned: number; couponsReturned: number; stockReleased: number; cancelledAt: string } } }] };
}

test("version-three report preserves each cart tender, line policies and sums without exposing raw records", async () => {
  for (const method of ["points", "on_site"] as const) {
    const x = await cartReviewFixture(method), scope = { siteId: x.f.siteId, resources: [{ kind: "order" as const, id: x.result.resourceId }] };
    const raw = { version: 3, siteId: scope.siteId, rows: [{ ...scope.resources[0], result: null, termsMatch: true, cart: { ...x.result, memberId: "PRIVATE", customer: "PRIVATE", transactions: "PRIVATE" } }] };
    const snapshot = parseCheckoutReportingSnapshot(raw, scope), row = snapshot.rows[0];
    assert.equal(row.cart!.method, method); assert.equal(row.cart!.lines.length, 2); assert.equal(checkoutReportingNeedsReview(row), false);
    assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
    assert.equal(checkoutReportingSettlement(row)?.method ?? null, method === "points" ? "points" : null);
    const calls: string[] = [];
    assert.deepEqual(await readCartCheckoutReporting(scope, async name => { calls.push(name); return { data: raw, error: null }; }), snapshot);
    assert.deepEqual(calls, ["faolla_member_checkout_reporting_v3"]);
  }
});
test("cart report refuses old version, wrong resource, mixed representations, missing rows and contradictory terms", async () => {
  const x = await cartReviewFixture(), scope = { siteId: x.f.siteId, resources: [{ kind: "order" as const, id: x.result.resourceId }] };
  const row = { ...scope.resources[0], result: null, termsMatch: true, cart: x.result }, raw = { version: 3, siteId: scope.siteId, rows: [row] };
  for (const value of [{ ...raw, version: 2 }, { ...raw, rows: [{ ...row, termsMatch: false }] }, { ...raw, rows: [{ ...row, onSite: {} }] },
    { ...raw, rows: [{ ...row, result: {} }] }, { ...raw, rows: [{ ...row, cart: { ...x.result, resourceId: "other" } }] }, { ...raw, rows: [] }]) assert.throws(() => parseCheckoutReportingSnapshot(value, scope));
  await assert.rejects(readCartCheckoutReporting(scope, async () => ({ data: { ...raw, version: 2, rows: [{ ...row, cart: undefined }] }, error: null })), /checkout_reporting_unavailable/);
});
test("cart report errors never retry a single-item projection or fabricate an unpaid/unlinked row", async () => {
  const x = await cartReviewFixture(), scope = { siteId: x.f.siteId, resources: [{ kind: "order" as const, id: x.result.resourceId }] }; let calls = 0;
  await assert.rejects(readCartCheckoutReporting(scope, async () => { calls++; return { data: null, error: { message: "PRIVATE SQL" } }; }), /checkout_reporting_unavailable/); assert.equal(calls, 1);
});
test("old readers and old point-transition bridge must refuse an unexpected cart projection while cart routing is off", async () => {
  const x = await cartReviewFixture(), scope = { siteId: x.f.siteId, resources: [{ kind: "order" as const, id: x.result.resourceId }] };
  const raw = { version: 3, siteId: scope.siteId, rows: [{ ...scope.resources[0], result: null, termsMatch: true, cart: x.result }] };
  const call = async () => ({ data: raw, error: null });
  await assert.rejects(readCheckoutReporting(scope, call), /checkout_reporting_unavailable/);
  await assert.rejects(readMixedCheckoutReporting(scope, call), /checkout_reporting_unavailable/);
  await assert.rejects(legacyCheckoutPointTransitions([{ previous: x.prepared.plan.record, next: { ...x.prepared.plan.record, status: "completed" } }],
    { enabled: () => true, cashEnabled: () => false, rpc: () => call }), /checkout_unavailable/);
});
test("cart TSV keeps separate points, integer EUR and actual returns; review-required cash is not recorded as zero collected", async () => {
  const x = await cartReviewFixture("on_site"), y = await cartReviewFixture("points");
  const cart = { ...x.result, resourceId: "C-cash", reviewRequired: true, cancellationAvailable: false }, p = { ...y.result, resourceId: "C-points" };
  const scope = { siteId: x.f.siteId, resources: [{ kind: "order" as const, id: cart.resourceId }, { kind: "order" as const, id: p.resourceId }, { kind: "order" as const, id: "legacy" }] };
  const s = parseCheckoutReportingSnapshot({ version: 3, siteId: scope.siteId, rows: [{ ...scope.resources[0], result: null, termsMatch: false, cart },
    { ...scope.resources[1], result: null, termsMatch: true, cart: p }, { ...scope.resources[2], result: null, termsMatch: false }] }, scope);
  assert.equal(checkoutReportingNeedsReview(s.rows[0]), true); const lines = checkoutReportingTsv(s).split("\r\n").map(l => l.split("\t")), headers = lines[0];
  assert.equal(lines[1][headers.indexOf("gross_minor")], "2500"); assert.equal(lines[1][headers.indexOf("merchant_recorded_cash_minor")], "");
  assert.equal(lines[2][headers.indexOf("points_debited")], "200"); assert.equal(lines[2][headers.indexOf("gross_minor")], "");
  assert.equal(lines[3][headers.indexOf("checkout_kind")], "unlinked"); assert.equal(lines[3][headers.indexOf("merchant_recorded_cash_minor")], "");
});
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
