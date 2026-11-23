import { parseMemberCheckoutResult, type MemberCheckoutResult } from "./merchantMemberCheckoutResult";
import type { MerchantSettlementSnapshot } from "./merchantSettlement";
import { parseOnSiteCheckoutResult, type OnSiteCheckoutResult } from "./merchantCheckoutOnSiteResult";
import { parseCartCheckoutResult, type CartCheckoutResult } from "./merchantCheckoutCartResult";

export type CheckoutResourceReference = { kind: "booking" | "order"; id: string };
export type CheckoutReportingRequest = { siteId: string; resources: CheckoutResourceReference[] };
export type CheckoutReportingRow = CheckoutResourceReference & {
  result: MemberCheckoutResult | null;
  termsMatch: boolean;
  onSite?: OnSiteCheckoutResult;
  cart?: CartCheckoutResult;
};
export type CheckoutReportingSnapshot = { version: 1 | 2 | 3; siteId: string; rows: CheckoutReportingRow[] };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
const key = (r: CheckoutResourceReference) => `${r.kind}:${r.id}`;
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_reporting_invalid"); }

/** Lookup keys are not payment facts or an authorization token. At most the
 * currently displayed 50 resources, never an unbounded merchant/customer scan. */
export function parseCheckoutReportingRequest(raw: unknown): CheckoutReportingRequest {
  need(object(raw) && Object.keys(raw).length === 2 && typeof raw.siteId === "string" && /^\d{8}$/.test(raw.siteId)
    && Array.isArray(raw.resources) && raw.resources.length > 0 && raw.resources.length <= 50);
  const resources = raw.resources.map(r => {
    need(object(r) && Object.keys(r).length === 2 && (r.kind === "booking" || r.kind === "order") && validId(r.id));
    return { kind: r.kind, id: r.id } as CheckoutResourceReference;
  });
  need(new Set(resources.map(key)).size === resources.length);
  return { siteId: raw.siteId, resources };
}

/** Allowlist twice (server and browser). Even a malformed/private database
 * response cannot introduce member identifiers, claim codes or contact data. */
export function parseCheckoutReportingSnapshot(raw: unknown, scope: CheckoutReportingRequest): CheckoutReportingSnapshot {
  parseCheckoutReportingRequest(scope);
  need(object(raw) && (raw.version === 1 || raw.version === 2 || raw.version === 3) && raw.siteId === scope.siteId && Array.isArray(raw.rows) && raw.rows.length === scope.resources.length);
  const rows = raw.rows.map((row, index) => {
    const expected = scope.resources[index];
    need(object(row) && row.kind === expected.kind && row.id === expected.id && typeof row.termsMatch === "boolean");
    if (Object.hasOwn(row, "cart")) {
      need(raw.version === 3 && !Object.hasOwn(row, "onSite") && row.result === null && object(row.cart) && typeof row.cart.operationKey === "string" && /^[a-f0-9]{64}$/.test(row.cart.operationKey));
      const cart = parseCartCheckoutResult(row.cart, { siteId: scope.siteId, operationKey: row.cart.operationKey });
      need(expected.kind === "order" && cart.resourceId === expected.id && row.termsMatch === !cart.reviewRequired);
      return { ...expected, result: null, cart, termsMatch: row.termsMatch };
    }
    if (Object.hasOwn(row, "onSite")) {
      need((raw.version === 2 || raw.version === 3) && row.result === null && object(row.onSite) && typeof row.onSite.operationKey === "string");
      const onSite = parseOnSiteCheckoutResult(row.onSite, { siteId: scope.siteId, operationKey: row.onSite.operationKey });
      need(onSite.terms.resourceKind === expected.kind && onSite.terms.resourceId === expected.id && row.termsMatch === onSite.termsMatch);
      return { ...expected, result: null, onSite, termsMatch: row.termsMatch };
    }
    let result: MemberCheckoutResult | null = null;
    if (row.result !== null) {
      need(object(row.result) && typeof row.result.operationKey === "string" && /^[a-f0-9]{64}$/.test(row.result.operationKey));
      result = parseMemberCheckoutResult(row.result, { siteId: scope.siteId, operationKey: row.result.operationKey });
      need(result.resourceKind === expected.kind && result.resourceId === expected.id);
    } else need(row.termsMatch === false);
    return { ...expected, result, termsMatch: row.termsMatch };
  });
  return { version: raw.version, siteId: scope.siteId, rows };
}

export function checkoutReportingNeedsReview(row: CheckoutReportingRow): boolean {
  const r = row.cart ?? row.onSite ?? row.result;
  return Boolean(r && (row.cart?.reviewRequired || !row.termsMatch || !r.resource || (r.closed !== (r.resource.status === "cancelled"))));
}

/** Does not turn an unlinked legacy record or a zero-cash points order into
 * "unpaid", "free" or "cash paid". Business and financial states stay separate. */
export function checkoutReportingSettlement(row: CheckoutReportingRow): MerchantSettlementSnapshot | null {
  const r = row.result ?? (row.cart?.method === "points" && !row.cart.reviewRequired ? row.cart : null);
  if (!r || r.totalPoints === null) return null;
  return { version: 1, method: "points", closed: r.closed, totalPoints: r.totalPoints, debitedPoints: r.totalPoints,
    returnedPoints: r.cancellation?.pointsReturned ?? 0, returnPending: false,
    ...(r.couponCount ? { coupons: { redeemedCount: r.couponCount, returnedCount: r.cancellation?.couponsReturned ?? 0, returnPending: false } } : {}) };
}

/** Text-only TSV for this page; leading spreadsheet formula characters are
 * escaped. The export contains immutable settlement facts, not customer data. */
export function checkoutReportingTsv(snapshot: CheckoutReportingSnapshot): string {
  const cell = (v: unknown) => {
    const text = String(v ?? "").replace(/[\t\r\n\u0000-\u001f\u007f]/g, " ");
    return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  };
  if (snapshot.version === 3) return [["kind", "resource_id", "checkout_kind", "method", "business_status", "line_count", "quantity", "points_debited", "points_returned", "gross_minor", "coupon_discount_minor", "due_minor", "merchant_recorded_cash_minor", "coupons_used", "coupons_returned", "closed", "review_required"],
    ...snapshot.rows.map(row => { const p = row.result, c = row.onSite, cart = row.cart, r = cart ?? c ?? p, pointTotal = cart?.method === "points" ? cart.totalPoints : p?.totalPoints;
      return [row.kind, row.id, cart ? "cart" : r ? "single" : "unlinked", cart?.method ?? (c ? "on_site" : p ? "points" : ""), r?.resource?.status ?? "",
        cart?.lines.length ?? "", cart?.lines.reduce((s, l) => s + l.quantity, 0) ?? "", pointTotal ?? "", pointTotal !== undefined && pointTotal !== null ? r?.cancellation?.pointsReturned ?? 0 : "",
        cart?.grossMinor ?? c?.terms.grossMinor ?? "", cart?.discountMinor ?? c?.terms.discountMinor ?? "", cart?.dueMinor ?? c?.terms.dueMinor ?? "",
        cart?.method === "on_site" ? cart.reviewRequired ? "" : 0 : c ? c.collection?.amountMinor ?? 0 : "",
        cart?.couponCount ?? c?.terms.couponCount ?? p?.couponCount ?? "", r?.cancellation?.couponsReturned ?? (r ? 0 : ""), r?.closed ?? "", r ? checkoutReportingNeedsReview(row) : ""]; })].map(row => row.map(cell).join("\t")).join("\r\n");
  if (snapshot.version === 2) return [["kind", "resource_id", "method", "business_status", "points_debited", "points_returned", "gross_minor", "coupon_discount_minor", "due_minor", "merchant_recorded_cash_minor", "coupons_used", "coupons_returned", "closed", "review_required"],
    ...snapshot.rows.map(row => { const p = row.result, c = row.onSite, r = c ?? p; return [row.kind, row.id, c ? "on_site" : p ? "points" : "unlinked", r?.resource?.status ?? "",
      p?.totalPoints ?? "", p?.cancellation?.pointsReturned ?? (p ? 0 : ""), c?.terms.grossMinor ?? "", c?.terms.discountMinor ?? "", c?.terms.dueMinor ?? "", c ? c.collection?.amountMinor ?? 0 : "",
      c?.terms.couponCount ?? p?.couponCount ?? "", r?.cancellation?.couponsReturned ?? (r ? 0 : ""), r?.closed ?? "", r ? checkoutReportingNeedsReview(row) : ""]; })].map(row => row.map(cell).join("\t")).join("\r\n");
  return [["kind", "resource_id", "ledger", "business_status", "points_debited", "points_returned", "coupons_used", "coupons_returned", "closed", "review_required"],
    ...snapshot.rows.map(row => [row.kind, row.id, row.result ? "linked" : "unlinked", row.result?.resource?.status ?? "",
      row.result?.totalPoints ?? "", row.result?.cancellation?.pointsReturned ?? (row.result ? 0 : ""), row.result?.couponCount ?? "",
      row.result?.cancellation?.couponsReturned ?? (row.result ? 0 : ""), row.result?.closed ?? "", row.result ? checkoutReportingNeedsReview(row) : ""])]
    .map(row => row.map(cell).join("\t")).join("\r\n");
}
