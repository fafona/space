import { NextResponse } from "next/server";
import { previewMemberCheckout, parseMemberCheckoutPreviewRequest } from "@/lib/merchantCheckoutPreview.server";
import { checkoutPrincipalKey, MerchantCheckoutError } from "@/lib/merchantCheckoutQuote.server";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { checkoutConfirmationHash } from "@/lib/merchantCheckoutConfirmation.server";
const defaults = { preview: previewMemberCheckout, session: resolvePersonalAccountSessionFromRequest, enabled: isMemberCheckoutPilotEnabled };
export type MemberCheckoutPreviewHttpDependencies = typeof defaults;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: {
  "cache-control": "private, no-store, max-age=0", pragma: "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin", vary: "Cookie, Authorization" } });
async function boundedBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) throw new Error("checkout_invalid_selection");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
  try {
    while (true) { const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 4096) { await reader.cancel(); throw new Error("checkout_invalid_selection"); }
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch { throw new Error("checkout_invalid_selection"); } finally { reader.releaseLock(); }
}
/** POST transports a private READ-ONLY selection preview. It creates no order,
 * transaction, coupon hold or provider request, even on repeated clicks. */
export async function handleMemberCheckoutPreview(request: Request, overrides: Partial<MemberCheckoutPreviewHttpDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (request.headers.has("x-merchant-access-token")) return json({ error: "checkout_unauthorized" }, 401);
  try {
    if ([...new URL(request.url).searchParams].length) return json({ error: "checkout_invalid_selection" }, 400);
    const body = await boundedBody(request), parsed = parseMemberCheckoutPreviewRequest(body);
    if (!deps.enabled(parsed.siteId)) return json({ error: "checkout_disabled" }, 503);
    const authorize = async () => {
      const session = await deps.session(request), verified = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      if (!session || session.servicePaused || typeof verified !== "string" || !Number.isFinite(Date.parse(verified))) return null;
      return { accountId: session.accountId, userId: session.userId };
    };
    const initial = await authorize();
    if (!initial) return json({ error: "checkout_unauthorized" }, 401);
    const initialKey = checkoutPrincipalKey(initial);
    const result = await deps.preview({ request: body, authorize });
    const after = await authorize();
    if (!after || checkoutPrincipalKey(after) !== initialKey) return json({ error: "checkout_unauthorized" }, 401);
    return json({ ok: true, ...result, confirmationHash: checkoutConfirmationHash(result.quote, initial, result.slot) });
  } catch (error) {
    if (error instanceof Error && ["checkout_invalid_selection", "checkout_invalid_coupon_selection"].includes(error.message)) return json({ error: error.message }, 400);
    const safe = error instanceof MerchantCheckoutError && ["checkout_quote_changed", "checkout_offer_not_found", "checkout_source_changed", "checkout_module_unavailable",
      "checkout_quantity_unavailable", "checkout_slot_unavailable", "checkout_booking_quantity_unsupported", "checkout_coupon_unavailable", "checkout_membership_unavailable"].includes(error.code);
    if (safe) return json({ error: error.code }, error.code === "checkout_offer_not_found" ? 404 : error.code === "checkout_module_unavailable" ? 403 : 409);
    if (error instanceof MerchantCheckoutError && error.code === "checkout_identity_changed") return json({ error: "checkout_unauthorized" }, 401);
    return json({ error: "checkout_unavailable" }, 503);
  }
}
export async function POST(request: Request) { return handleMemberCheckoutPreview(request); }
