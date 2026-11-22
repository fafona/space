import { NextResponse } from "next/server";
import { submitMemberCheckout } from "@/lib/merchantCheckoutSubmission.server";
import { parseCheckoutSubmissionRequest } from "@/lib/merchantCheckoutSubmissionPlan.server";
import { checkoutPrincipalKey, MerchantCheckoutError } from "@/lib/merchantCheckoutQuote.server";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
const defaults = { session: resolvePersonalAccountSessionFromRequest, enabled: isMemberCheckoutPilotEnabled, submit: submitMemberCheckout };
export type MemberCheckoutSubmitDependencies = typeof defaults;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: {
  "cache-control": "private, no-store, max-age=0", pragma: "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin", vary: "Cookie, Authorization" } });
async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) throw new Error("checkout_invalid_request");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let count = 0, value = "";
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; count += chunk.value.byteLength;
    if (count > 16_384) { await reader.cancel(); throw new Error("checkout_invalid_request"); } value += decoder.decode(chunk.value, { stream: true });
  } return JSON.parse(value + decoder.decode()) as unknown; }
  catch { throw new Error("checkout_invalid_request"); } finally { reader.releaseLock(); }
}
export async function handleMemberCheckoutSubmit(request: Request, overrides: Partial<MemberCheckoutSubmitDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (request.headers.has("x-merchant-access-token")) return json({ error: "checkout_unauthorized" }, 401);
  try {
    if ([...new URL(request.url).searchParams].length) throw new Error("checkout_invalid_request");
    const raw = await body(request), parsed = parseCheckoutSubmissionRequest(raw);
    if (!deps.enabled(parsed.siteId)) return json({ error: "checkout_disabled" }, 503);
    const authorize = async () => {
      const session = await deps.session(request), verified = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      if (!session || session.servicePaused || typeof verified !== "string" || !Number.isFinite(Date.parse(verified))) return null;
      return { accountId: session.accountId, userId: session.userId };
    };
    const principal = await authorize(); if (!principal) return json({ error: "checkout_unauthorized" }, 401);
    const key = checkoutPrincipalKey(principal), result = await deps.submit({ request: raw, principal, authorize, signal: request.signal });
    const current = await authorize();
    if (!current || checkoutPrincipalKey(current) !== key) return json({ error: "checkout_unconfirmed" }, 503);
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && ["checkout_invalid_request", "checkout_invalid_selection", "checkout_invalid_coupon_selection"].includes(error.message)) return json({ error: error.message }, 400);
    const safe = error instanceof MerchantCheckoutError && ["checkout_conflict", "checkout_quote_changed", "checkout_quote_expired", "checkout_operation_conflict", "checkout_disabled",
      "checkout_offer_not_found", "checkout_membership_unavailable", "checkout_insufficient_points", "checkout_quantity_unavailable", "checkout_coupon_unavailable",
      "checkout_invalid_customer", "checkout_unauthorized", "checkout_source_changed", "checkout_module_unavailable", "checkout_slot_unavailable", "checkout_booking_quantity_unsupported"].includes(error.code);
    return json({ error: safe ? error.code : "checkout_unconfirmed" }, safe ? error.status : 503);
  }
}
export async function POST(request: Request) { return handleMemberCheckoutSubmit(request); }
