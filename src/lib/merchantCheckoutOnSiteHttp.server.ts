import { NextResponse } from "next/server";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { checkoutPrincipalKey, MerchantCheckoutError } from "./merchantCheckoutQuote.server";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";
import { parseOnSiteSubmissionRequest } from "./merchantCheckoutOnSiteSubmissionPlan.server";
import { previewOnSiteCheckout, submitOnSiteCheckout } from "./merchantCheckoutOnSiteSubmission.server";
import { readOnSiteCheckoutResult, cancelOnSiteCheckout } from "./merchantCheckoutOnSiteResult.server";
import { parseCheckoutOriginalResult } from "./merchantCheckoutOriginalResult";
import { isMemberCheckoutOnSitePilotEnabled } from "./merchantCheckoutOnSitePilot.server";

export type OnSiteHttpAction = "preview" | "submit" | "recover" | "result" | "cancel";
const defaults = { session: resolvePersonalAccountSessionFromRequest, enabled: isMemberCheckoutOnSitePilotEnabled,
  call: async (name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: { message?: string } | null }> => {
    const client = createServerSupabaseServiceClient(); if (!client) throw new Error("checkout_unavailable");
    return client.rpc(name, args).abortSignal(signal);
  } };
export type OnSiteHttpDependencies = typeof defaults;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const invalid = (): never => { throw new Error("checkout_invalid_request"); };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", vary: "Cookie, Authorization" } });
async function body(request: Request) {
  if (!request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return invalid();
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
  try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
    if (bytes > 16_384) { await reader.cancel(); return invalid(); } text += decoder.decode(part.value, { stream: true });
  } return JSON.parse(text + decoder.decode()) as unknown; } catch { return invalid(); } finally { reader.releaseLock(); }
}
/** All actions require same-origin POST and verified personal identity. The
 * new gate is independent; no ordinary point-pilot setting can enable cash. */
export async function handleOnSiteCheckout(action: OnSiteHttpAction, request: Request, overrides: Partial<OnSiteHttpDependencies> = {}) {
  const deps = { ...defaults, ...overrides }, writing = action === "submit" || action === "cancel";
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (request.headers.has("x-merchant-access-token")) return json({ error: "checkout_unauthorized" }, 401);
  let dispatched = false;
  try {
    if (new URL(request.url).search) return invalid();
    const raw = await body(request); if (!object(raw) || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId)) return invalid();
    const siteId = raw.siteId;
    if (action === "preview" || action === "submit") parseOnSiteSubmissionRequest(raw);
    else if (action === "recover") {
      if (Object.keys(raw).length !== 2 || typeof raw.nonce !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw.nonce)) return invalid();
    } else if (Object.keys(raw).length !== (action === "cancel" ? 3 : 2) || typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey)
      || action === "cancel" && (typeof raw.expectedUpdatedAt !== "string" || raw.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(raw.expectedUpdatedAt)))) return invalid();
    if (!deps.enabled(siteId)) return json({ error: "checkout_disabled" }, 503);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
    const authorize = async () => {
      if (signal.aborted || !deps.enabled(siteId)) throw new Error("checkout_unavailable");
      const session = await deps.session(request), verified = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      if (signal.aborted || !deps.enabled(siteId)) throw new Error("checkout_unavailable");
      return !session || session.servicePaused || typeof verified !== "string" || !Number.isFinite(Date.parse(verified)) ? null : { accountId: session.accountId, userId: session.userId };
    };
    const principal = await authorize(); if (!principal) return json({ error: "checkout_unauthorized" }, 401);
    const principalKey = checkoutPrincipalKey(principal), call = (name: string, args: Record<string, unknown>, inner = signal) => {
      if (signal.aborted || !deps.enabled(siteId)) throw new Error("checkout_unavailable");
      if (/commit|cancel/.test(name)) dispatched = true;
      return deps.call(name, args, AbortSignal.any([signal, inner]));
    };
    let response: Record<string, unknown>;
    if (action === "preview" || action === "submit") response = await (action === "preview" ? previewOnSiteCheckout : submitOnSiteCheckout)({ request: raw, principal, authorize, signal }, call);
    else if (action === "recover") {
      const identity = checkoutSubmissionRecoveryIdentity(raw, principal), read = await call("faolla_member_checkout_original_result_v1", { p_site_id: siteId, p_operation_key: identity.operationKey, p_principal_key: principalKey });
      if (!object(read) || !Object.hasOwn(read, "data") || read.error !== null) throw new Error("checkout_unavailable");
      response = read.data === null ? { state: "unconfirmed" } : { state: "confirmed", original: parseCheckoutOriginalResult(read.data, identity) };
    } else {
      const scope = { siteId, operationKey: raw.operationKey as string }, ports = { authorize, call };
      if (action === "result") { const result = await readOnSiteCheckoutResult(scope, ports); if (!result) return json({ error: "checkout_not_found" }, 404); response = { result }; }
      else response = await cancelOnSiteCheckout({ ...scope, expectedUpdatedAt: raw.expectedUpdatedAt as string }, ports);
    }
    const current = await authorize();
    if (!current || checkoutPrincipalKey(current) !== principalKey) return json({ error: dispatched ? "checkout_unconfirmed" : "checkout_unauthorized" }, dispatched ? 503 : 401);
    return json({ ok: true, ...response });
  } catch (error) {
    const message = error instanceof MerchantCheckoutError ? error.code : error instanceof Error ? error.message : "";
    const code = message === "checkout_identity_changed" ? "checkout_unauthorized" : message;
    const bad = ["checkout_invalid_request", "checkout_invalid_selection", "checkout_invalid_customer", "checkout_invalid_coupon_selection"].includes(code);
    const conflict = ["checkout_conflict", "checkout_quote_changed", "checkout_quote_expired", "checkout_operation_conflict", "checkout_membership_unavailable", "checkout_quantity_unavailable", "checkout_coupon_unavailable",
      "checkout_on_site_unavailable", "checkout_source_changed", "checkout_slot_unavailable", "checkout_booking_quantity_unsupported", "checkout_cancellation_review_required", "checkout_cancellation_not_allowed", "checkout_cancellation_deadline", "checkout_cancellation_requires_refund"].includes(code);
    const status = bad && !dispatched ? 400 : conflict ? 409 : code === "checkout_unauthorized" && !dispatched ? 401 : code === "checkout_module_unavailable" && !dispatched ? 403
      : ["checkout_not_found", "checkout_offer_not_found"].includes(code) && !dispatched ? 404 : 503;
    return json({ error: status < 500 ? code : dispatched && writing ? "checkout_unconfirmed" : "checkout_unavailable" }, status);
  }
}
