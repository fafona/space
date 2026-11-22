import { NextResponse } from "next/server";
import { checkoutPrincipalKey } from "@/lib/merchantCheckoutQuote.server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { readMemberCheckoutResult, cancelMemberCheckout } from "@/lib/merchantMemberCheckoutResult.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
const defaults = { session: resolvePersonalAccountSessionFromRequest, enabled: isMemberCheckoutPilotEnabled, read: readMemberCheckoutResult, cancel: cancelMemberCheckout };
export type MemberCheckoutResultDependencies = typeof defaults;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache",
  "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin", "referrer-policy": "no-referrer", vary: "Cookie, Authorization" } });
function principal(session: Awaited<ReturnType<typeof defaults.session>>) {
  const verified = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
  if (!session || session.servicePaused || typeof verified !== "string" || !Number.isFinite(Date.parse(verified))) return null;
  return checkoutPrincipalKey(session);
}
async function boundedJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) throw new Error("checkout_invalid_request");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
  try { while (true) { const part = await reader.read(); if (part.done) break;
    bytes += part.value.byteLength; if (bytes > 4096) { await reader.cancel(); throw new Error("checkout_invalid_request"); }
    text += decoder.decode(part.value, { stream: true });
  } return JSON.parse(text + decoder.decode()) as Record<string, unknown>; }
  catch { throw new Error("checkout_invalid_request"); } finally { reader.releaseLock(); }
}
export async function handleMemberCheckoutResult(request: Request, overrides: Partial<MemberCheckoutResultDependencies> = {}) {
  const deps = { ...defaults, ...overrides }, writing = request.method === "POST";
  if (request.method !== "GET" && !writing) return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (request.headers.has("x-merchant-access-token")) return json({ error: "checkout_unauthorized" }, 401);
  try {
    const params = new URL(request.url).searchParams;
    let body: Record<string, unknown>;
    if (writing) {
      if ([...params].length) throw new Error("checkout_invalid_request");
      body = await boundedJson(request);
      if (!body || Array.isArray(body) || Object.keys(body).length !== 3 || !["siteId", "operationKey", "expectedUpdatedAt"].every(key => Object.hasOwn(body, key))
        || typeof body.expectedUpdatedAt !== "string" || body.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) throw new Error("checkout_invalid_request");
    } else {
      if ([...params.keys()].some(key => key !== "siteId" && key !== "operationKey") || params.getAll("siteId").length !== 1 || params.getAll("operationKey").length !== 1) throw new Error("checkout_invalid_request");
      body = { siteId: params.get("siteId"), operationKey: params.get("operationKey") };
    }
    const { siteId, operationKey } = body;
    if (typeof siteId !== "string" || !/^\d{8}$/.test(siteId) || typeof operationKey !== "string" || !/^[a-f0-9]{64}$/.test(operationKey)) throw new Error("checkout_invalid_request");
    if (!deps.enabled(siteId)) return json({ error: "checkout_disabled" }, 503);
    const initial = principal(await deps.session(request));
    if (!initial) return json({ error: "checkout_unauthorized" }, 401);
    // Neither merchant-module removal nor membership leaving invalidates an
    // already committed receipt/refund entitlement. SQL rechecks ORIGINAL IDs.
    const result = writing ? await deps.cancel({ siteId, operationKey, principalKey: initial, expectedUpdatedAt: body.expectedUpdatedAt as string })
      : await deps.read({ siteId, operationKey, principalKey: initial });
    if (principal(await deps.session(request)) !== initial) return json({ error: writing ? "checkout_unconfirmed" : "checkout_unauthorized" }, writing ? 503 : 401);
    if (!result) return json({ error: "checkout_not_found" }, 404);
    return json({ ok: true, ...(writing ? result : { result }) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "checkout_invalid_request" ? 400 : code === "checkout_unauthorized" ? 401 : code === "checkout_not_found" ? 404
      : ["checkout_conflict", "checkout_cancellation_review_required", "checkout_cancellation_not_allowed", "checkout_cancellation_deadline"].includes(code) ? 409 : 503;
    return json({ error: status < 500 ? code : writing ? "checkout_unconfirmed" : "checkout_unavailable" }, status);
  }
}
