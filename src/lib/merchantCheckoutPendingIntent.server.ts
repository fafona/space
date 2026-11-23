import { checkoutPrincipalKey, MerchantCheckoutError, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import { parseCheckoutIntentAcknowledgement, parseCheckoutIntentAckResult, parsePendingCheckoutSnapshot, parseCheckoutIntentReview } from "./merchantCheckoutPendingIntent";
export type CheckoutIntentRpc = (name: "faolla_member_checkout_pending_intent_v1" | "faolla_member_checkout_acknowledge_intent_v1" | "faolla_member_checkout_intent_review_v1",
  args: Record<string, unknown>, signal: AbortSignal) => Promise<{ data: unknown; error: { message?: string } | null }>;
type Ports = { principal: CheckoutPrincipal; authorize(): Promise<CheckoutPrincipal | null>; signal?: AbortSignal };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const errors = new Set(["checkout_invalid_request", "checkout_unauthorized", "checkout_intent_disabled", "checkout_intent_busy", "checkout_intent_not_found", "checkout_intent_changed", "checkout_intent_expired", "checkout_intent_review_required", "checkout_original_pending"]);
/** Explicit ports, no real client/env fallback, route, role grant or feature
 * activation. Caller must resolve a verified, unpaused personal session.
 * Whole operation bounded; one ack append, no retry, finance or cart clearing. */
async function run(action: "read" | "review" | "acknowledge", raw: unknown, input: Ports, rpc: CheckoutIntentRpc) {
  let dispatched = false; const startedAt = Date.now(), notAfter = startedAt + 11_000;
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
  const guard = () => { if (signal.aborted || Date.now() - startedAt >= 12_000) throw new Error("checkout_intent_unavailable"); };
  const bounded = async <T>(f: () => PromiseLike<T>): Promise<T> => {
    guard(); let stop: () => void = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { guard(); return f(); }), new Promise<never>((_, reject) => {
      stop = () => reject(new Error("checkout_intent_unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    })]); } finally { signal.removeEventListener("abort", stop); }
  };
  try {
    const principal = checkoutPrincipalKey(structuredClone(input.principal));
    let siteId: string, acknowledgement, reviewScope;
    if (action !== "acknowledge") {
      if (!object(raw) || Object.keys(raw).length !== (action === "read" ? 1 : 2) || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId)
        || action === "review" && (typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey))) throw new Error("checkout_invalid_request"); siteId = raw.siteId;
      if (action === "review") reviewScope = { siteId, operationKey: raw.operationKey as string };
    } else { acknowledgement = parseCheckoutIntentAcknowledgement(raw); siteId = acknowledgement.siteId; }
    const authorize = async () => { const current = await bounded(input.authorize); guard(); if (!current || checkoutPrincipalKey(current) !== principal) throw new Error("checkout_unauthorized"); };
    await authorize(); guard();
    if (acknowledgement && Date.now() >= notAfter) throw new Error("checkout_intent_unavailable");
    const args = { p_site_id: siteId, p_principal_key: principal, ...(reviewScope ? { p_operation_key: reviewScope.operationKey } : {}), ...(acknowledgement ? { p_operation_key: acknowledgement.operationKey, p_generation: acknowledgement.generation,
      p_review_hash: acknowledgement.reviewHash, p_not_after: new Date(notAfter).toISOString() } : {}) };
    dispatched = action === "acknowledge";
    const response = await bounded(() => rpc(action === "read" ? "faolla_member_checkout_pending_intent_v1" : action === "review" ? "faolla_member_checkout_intent_review_v1" : "faolla_member_checkout_acknowledge_intent_v1", args, signal));
    guard();
    if (!object(response) || !Object.hasOwn(response, "data") || response.error !== null && !object(response.error)) throw new Error("checkout_intent_unavailable");
    if (response.error) throw new Error(errors.has(response.error.message ?? "") ? response.error.message : "checkout_intent_unavailable");
    try { await authorize(); return acknowledgement ? parseCheckoutIntentAckResult(response.data, acknowledgement) : reviewScope ? parseCheckoutIntentReview(response.data, reviewScope) : parsePendingCheckoutSnapshot(response.data, siteId); }
    catch { throw new Error(dispatched ? "checkout_intent_unconfirmed" : "checkout_intent_unavailable"); }
  } catch (error) {
    const code = error instanceof Error ? error.message : "", selected = errors.has(code) ? code : dispatched ? "checkout_intent_unconfirmed" : "checkout_intent_unavailable";
    throw new MerchantCheckoutError(selected, selected === "checkout_invalid_request" ? 400 : selected === "checkout_unauthorized" ? 401
      : ["checkout_intent_unconfirmed", "checkout_intent_unavailable", "checkout_intent_disabled"].includes(selected) ? 503 : 409);
  }
}
export async function readPendingCheckoutIntent(request: { siteId: string }, ports: Ports, rpc: CheckoutIntentRpc) {
  return run("read", request, ports, rpc) as Promise<ReturnType<typeof parsePendingCheckoutSnapshot>>;
}
export async function acknowledgePendingCheckoutIntent(request: unknown, ports: Ports, rpc: CheckoutIntentRpc) {
  return run("acknowledge", request, ports, rpc) as Promise<ReturnType<typeof parseCheckoutIntentAckResult>>;
}
export async function readCheckoutIntentReview(request: { siteId: string; operationKey: string }, ports: Ports, rpc: CheckoutIntentRpc) {
  return run("review", request, ports, rpc) as Promise<ReturnType<typeof parseCheckoutIntentReview>>;
}
