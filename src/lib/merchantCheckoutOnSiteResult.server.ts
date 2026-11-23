import { checkoutPrincipalKey, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import type { MemberCheckoutResultRpc } from "./merchantMemberCheckoutResult.server";
import { parseOnSiteCheckoutResult, parseOnSiteCancellation } from "./merchantCheckoutOnSiteResult";
export { parseOnSiteCheckoutResult, parseOnSiteCancellation, type OnSiteCheckoutResult, type OnSiteCancellation } from "./merchantCheckoutOnSiteResult";
type Scope = { siteId: string; operationKey: string };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v));
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_invalid_response"); }
function scope(input: unknown): asserts input is Scope {
  if (!object(input) || typeof input.siteId !== "string" || !/^\d{8}$/.test(input.siteId)
    || typeof input.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(input.operationKey)) throw new Error("checkout_invalid_request");
}
// authorize must resolve the current verified, non-paused personal session;
// call must use a bounded transport. Neither port accepts browser identity.
type Ports = { authorize(): Promise<CheckoutPrincipal | null>; call: MemberCheckoutResultRpc };
async function authorize(ports: Ports) {
  const principal = await ports.authorize();
  if (!principal) throw new Error("checkout_unauthorized");
  return checkoutPrincipalKey(principal);
}
/** Explicit injected ports only: no live client, env fallback, default IO or
 * production enablement. Never accept principal/member identity from a body. */
export async function readOnSiteCheckoutResult(input: Scope, ports: Ports) {
  scope(input);
  if (Object.keys(input).length !== 2) throw new Error("checkout_invalid_request");
  const stable = { ...input }, principalKey = await authorize(ports);
  const result = await Promise.resolve().then(() => ports.call("faolla_member_checkout_on_site_result_v1", { p_site_id: stable.siteId, p_operation_key: stable.operationKey, p_principal_key: principalKey }))
    .catch(() => { throw new Error("checkout_unavailable"); });
  if (await authorize(ports) !== principalKey) throw new Error("checkout_identity_changed");
  if (!object(result) || !Object.hasOwn(result, "data") || !Object.hasOwn(result, "error")
    || result.error !== null && !object(result.error)) throw new Error("checkout_unavailable");
  if (result.error) throw new Error("checkout_unavailable");
  return result.data === null ? null : parseOnSiteCheckoutResult(result.data, stable);
}
const known = new Set(["checkout_not_found", "checkout_conflict", "checkout_cancellation_review_required", "checkout_cancellation_not_allowed",
  "checkout_cancellation_deadline", "checkout_cancellation_requires_refund", "booking_atomic_inactive"]);
/** One original cancellation, no retry/compensation. If authorization changes
 * or response is lost AFTER dispatch, retain the original key and reconcile. */
export async function cancelOnSiteCheckout(input: Scope & { expectedUpdatedAt: string }, ports: Ports) {
  scope(input);
  if (Object.keys(input).length !== 3 || !date(input.expectedUpdatedAt)) throw new Error("checkout_invalid_request");
  const stable = { ...input }, principalKey = await authorize(ports);
  const result = await Promise.resolve().then(() => ports.call("faolla_member_checkout_on_site_cancel_v1", {
    p_site_id: stable.siteId, p_operation_key: stable.operationKey, p_principal_key: principalKey, p_expected_updated_at: stable.expectedUpdatedAt,
  })).catch(() => { throw new Error("checkout_unconfirmed"); });
  try { if (await authorize(ports) !== principalKey) throw new Error("checkout_identity_changed"); }
  catch { throw new Error("checkout_unconfirmed"); }
  if (!object(result) || !Object.hasOwn(result, "data") || !Object.hasOwn(result, "error")
    || result.error !== null && !object(result.error)) throw new Error("checkout_unconfirmed");
  if (result.error) {
    const error = result.error.message ?? "";
    if (["order_update_conflict", "merchant_memberships_conflict", "merchant_membership_settings_conflict", "merchant_coupons_conflict"].includes(error)) throw new Error("checkout_conflict");
    throw new Error(known.has(error) ? error : "checkout_unconfirmed");
  }
  try {
    need(object(result.data) && typeof result.data.replayed === "boolean");
    return { replayed: result.data.replayed, cancellation: parseOnSiteCancellation(result.data.receipt, stable) };
  } catch { throw new Error("checkout_unconfirmed"); }
}
