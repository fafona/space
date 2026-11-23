import { parseMemberCheckoutResult, type MemberCheckoutResult } from "./merchantMemberCheckoutResult";
import type { MerchantSettlementSnapshot } from "./merchantSettlement";

export type CheckoutResourceReference = { kind: "booking" | "order"; id: string };
export type CheckoutReportingRequest = { siteId: string; resources: CheckoutResourceReference[] };
export type CheckoutReportingRow = CheckoutResourceReference & {
  result: MemberCheckoutResult | null;
  termsMatch: boolean;
};
export type CheckoutReportingSnapshot = { version: 1; siteId: string; rows: CheckoutReportingRow[] };
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
  need(object(raw) && raw.version === 1 && raw.siteId === scope.siteId && Array.isArray(raw.rows) && raw.rows.length === scope.resources.length);
  const rows = raw.rows.map((row, index) => {
    const expected = scope.resources[index];
    need(object(row) && row.kind === expected.kind && row.id === expected.id && typeof row.termsMatch === "boolean");
    let result: MemberCheckoutResult | null = null;
    if (row.result !== null) {
      need(object(row.result) && typeof row.result.operationKey === "string" && /^[a-f0-9]{64}$/.test(row.result.operationKey));
      result = parseMemberCheckoutResult(row.result, { siteId: scope.siteId, operationKey: row.result.operationKey });
      need(result.resourceKind === expected.kind && result.resourceId === expected.id);
    } else need(row.termsMatch === false);
    return { ...expected, result, termsMatch: row.termsMatch };
  });
  return { version: 1, siteId: scope.siteId, rows };
}

export function checkoutReportingNeedsReview(row: CheckoutReportingRow): boolean {
  const r = row.result;
  return Boolean(r && (!row.termsMatch || !r.resource || (r.closed !== (r.resource.status === "cancelled"))));
}

/** Does not turn an unlinked legacy record or a zero-cash points order into
 * "unpaid", "free" or "cash paid". Business and financial states stay separate. */
export function checkoutReportingSettlement(row: CheckoutReportingRow): MerchantSettlementSnapshot | null {
  const r = row.result;
  if (!r) return null;
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
  return [["kind", "resource_id", "ledger", "business_status", "points_debited", "points_returned", "coupons_used", "coupons_returned", "closed", "review_required"],
    ...snapshot.rows.map(row => [row.kind, row.id, row.result ? "linked" : "unlinked", row.result?.resource?.status ?? "",
      row.result?.totalPoints ?? "", row.result?.cancellation?.pointsReturned ?? (row.result ? 0 : ""), row.result?.couponCount ?? "",
      row.result?.cancellation?.couponsReturned ?? (row.result ? 0 : ""), row.result?.closed ?? "", row.result ? checkoutReportingNeedsReview(row) : ""])]
    .map(row => row.map(cell).join("\t")).join("\r\n");
}
