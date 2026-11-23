// Actual HTTP/planners with synthetic private RPC ports, not a live database.
import { randomUUID } from "node:crypto";
import { cartQuoteFixture } from "./member-checkout-cart-quote";
import { handleSingleIntentCheckout } from "../../src/app/api/member-checkout/single/route-handler";
import { handleCheckoutIntent } from "../../src/lib/merchantCheckoutIntentHttp.server";
import { handleCartCheckout } from "../../src/lib/merchantCheckoutCartHttp.server";
import { checkoutSubmissionIdentity, quoteCheckoutSubmissionSnapshot, type CheckoutSubmissionSnapshot } from "../../src/lib/merchantCheckoutSubmissionPlan.server";
import { onSiteSubmissionIdentity } from "../../src/lib/merchantCheckoutOnSiteSubmissionPlan.server";
import type { CartClientOriginal } from "../../src/lib/merchantCheckoutCartReview";
export function singleHttpFixture(method: "points" | "on_site" = "points") {
  const f = cartQuoteFixture(method, 1), selection = { siteId: f.siteId, offerId: f.offers[0].id, offerRevision: f.offers[0].revision, quantity: 1, couponClaims: [] };
  const customer = { name: "Synthetic", title: "", email: "synthetic@example.invalid", phone: "000000000", note: "Original note" }, nonce = "33333333-3333-4333-8333-333333333333", calls: string[] = [], events: string[] = [];
  let original: CartClientOriginal | null = null, acknowledged = false, authenticated = true, commitError: string | null = null;
  const session = async () => authenticated ? { ...f.principal, servicePaused: false, user: { id: f.principal.userId, email_confirmed_at: f.snapshot.databaseNow } } as never : null;
  const snapshotFor = (raw: unknown) => {
    const id = method === "points" ? checkoutSubmissionIdentity(raw, f.principal) : onSiteSubmissionIdentity(raw, f.principal);
    const snapshot: CheckoutSubmissionSnapshot = { version: 2, siteId: f.siteId, principalKey: id.principalKey, operationKey: id.operationKey, requestHash: id.requestHash,
      databaseNow: f.snapshot.databaseNow, offer: f.offers[0], sourceRows: f.snapshot.sourceRows, domainRows: [...f.snapshot.domainRows,
        { id: randomUUID(), merchant_id: f.siteId, slug: `__merchant_orders__:${f.siteId}`, blocks: [], updated_at: f.snapshot.databaseNow }], booking: null };
    return method === "points" ? snapshot : { ...snapshot, version: 3, method: "on_site" };
  };
  const review = () => original ? { operationKey: original.kind === "cart" ? original.result.operationKey : original.original.result.operationKey, generation: 1, reviewHash: "a".repeat(64), reviewRequired: false, original, acknowledged } : null;
  const rpc = async (name: string, args: Record<string, unknown>, capturedBody?: unknown) => {
    calls.push(name);
    if (name.includes("snapshot")) return { data: { replayed: false, snapshot: snapshotFor(capturedBody) }, error: null };
    if (name.includes("commit")) {
      if (commitError === "throw") throw Error("checkout_original_pending");
      if (commitError) return { data: null, error: { message: commitError } };
      if (original) throw Error("synthetic double financial dispatch"); events.push("submit");
      const plan = args.p_plan as { receipt: Record<string, unknown>; cancellationPolicy?: Record<string, unknown> };
      const common = { siteId: f.siteId, operationKey: args.p_operation_key, closed: false, resource: { status: "pending", updatedAt: f.snapshot.databaseNow }, cancellation: null, cancellationAvailable: true };
      original = { kind: "single", original: method === "points" ? { method: "points", result: { ...common, version: 1, ...plan.receipt, cancellationPolicy: { returnPoints: true, returnCoupons: true, advanceMinutes: 60, cancellableUntil: null } } }
        : { method: "on_site", result: { ...common, version: 2, terms: plan.receipt, termsMatch: true, collection: null, cancellationPolicy: { returnCoupons: true, advanceMinutes: 60, cancellableUntil: null } } } } as CartClientOriginal;
      return { data: { replayed: false, result: original.kind === "single" ? original.original.result : null }, error: null };
    }
    if (name === "faolla_member_checkout_cart_result_v1") return { data: original?.kind === "cart" ? original.result : null, error: null };
    if (name === "faolla_member_checkout_original_result_v1") return { data: original?.kind === "single" ? original.original : null, error: null };
    throw Error("unexpected synthetic RPC");
  };
  const handle = async (url: string, body: unknown, headers: HeadersInit, signal?: AbortSignal) => {
    const path = new URL(url).pathname, request = new Request(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    const match = /^\/api\/member-checkout\/single\/(points|on-site)\/(preview|submit)$/.exec(path);
    if (match) return handleSingleIntentCheckout(match[1], match[2], request, { enabled: () => true, cashEnabled: () => true, session,
      pointsPreview: { preview: async input => {
        const raw = { ...(input.request as object), method: "points", nonce, confirmationHash: "0".repeat(64), customer };
        return quoteCheckoutSubmissionSnapshot(snapshotFor(raw) as CheckoutSubmissionSnapshot, checkoutSubmissionIdentity(raw, f.principal), f.principal);
      } }, call: (name, args) => rpc(name, args, body) });
    const intent = /^\/api\/member-checkout\/intent\/(pending|review|acknowledge)$/.exec(path);
    if (intent) return handleCheckoutIntent(intent[1] as "pending" | "review" | "acknowledge", request, { enabled: () => true, session, call: async name => {
      calls.push(name); if (name.includes("acknowledge")) { events.push("ack"); acknowledged = true; return { data: { version: 1, siteId: f.siteId, operationKey: review()!.operationKey, generation: 1, acknowledged: true, replayed: false }, error: null }; }
      return { data: name.includes("pending") ? { version: 1, siteId: f.siteId, pending: acknowledged ? null : review() } : { version: 1, siteId: f.siteId, review: review() }, error: null };
    } });
    if (path === "/api/member-checkout/cart/recover") return handleCartCheckout("recover", request, { enabled: () => true, intentEnabled: () => true, session, call: rpc });
    throw Error("unexpected synthetic HTTP path");
  };
  return { ...f, selection, customer, nonce, handle, calls, events, getOriginal: () => original, setOriginal: (value: CartClientOriginal) => { original = value; }, setCommitError: (code: string) => { commitError = code; }, guest: () => { authenticated = false; } };
}
