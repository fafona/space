import { NextResponse } from "next/server";
import { checkoutLegacyErrorDetails, readPersonalCheckoutResource } from "@/lib/merchantCheckoutLegacyBoundary.server";
import { isTrustedCheckoutReadRequest } from "@/lib/merchantCheckoutReadRequest";
import { parseMemberCheckoutResult } from "@/lib/merchantMemberCheckoutResult";
import { isMemberCheckoutOnSitePilotEnabled } from "@/lib/merchantCheckoutOnSitePilot.server";
import { readPersonalCheckoutOriginalResource } from "@/lib/merchantCheckoutOriginalResource.server";
import { parseCheckoutOriginalResult } from "@/lib/merchantCheckoutOriginalResult";
const mixedDefaults = { enabled: isMemberCheckoutOnSitePilotEnabled, read: readPersonalCheckoutOriginalResource };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", vary: "Cookie, Authorization" } });

export async function handlePersonalCheckoutResource(request: Request, read = readPersonalCheckoutResource, overrides: Partial<typeof mixedDefaults> = {}) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedCheckoutReadRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (request.headers.has("x-merchant-access-token")) return json({ error: "checkout_unauthorized" }, 401);
  const p = new URL(request.url).searchParams, siteId = p.get("siteId") ?? "", kind = p.get("kind"), id = p.get("id") ?? "";
  const expectedAccountId = request.headers.get("x-checkout-account-scope") ?? undefined;
  if ([...p.keys()].some(k => !["siteId", "kind", "id"].includes(k)) || ["siteId", "kind", "id"].some(k => p.getAll(k).length !== 1)
    || !/^\d{8}$/.test(siteId) || (kind !== "booking" && kind !== "order") || !/^[A-Za-z0-9:_-]{1,160}$/.test(id)
    || expectedAccountId !== undefined && !/^\d{8}$/.test(expectedAccountId)) return json({ error: "checkout_invalid_request" }, 400);
  try {
    const mixed = { ...mixedDefaults, ...overrides };
    if (mixed.enabled(siteId)) {
      const raw = await mixed.read({ request, siteId, kind, id, expectedAccountId });
      if (!mixed.enabled(siteId)) throw new Error("unavailable");
      const original = raw === null ? null : parseCheckoutOriginalResult(raw, { siteId, operationKey: raw.result.operationKey });
      if (original && (original.method === "on_site" ? original.result.terms.resourceKind !== kind || original.result.terms.resourceId !== id : original.result.resourceKind !== kind || original.result.resourceId !== id)) throw new Error("unavailable");
      return json(original?.method === "on_site" ? { ok: true, result: null, onSite: original.result } : { ok: true, result: original?.result ?? null });
    }
    const raw = await read({ request, siteId, kind, id, expectedAccountId });
    const result = raw === null ? null : parseMemberCheckoutResult(raw, { siteId, operationKey: raw.operationKey });
    if (result && (result.resourceKind !== kind || result.resourceId !== id)) throw new Error("unavailable");
    return json({ ok: true, result });
  }
  catch (error) { const safe = checkoutLegacyErrorDetails(error); return json({ error: safe?.error ?? "checkout_unavailable" }, safe?.status ?? 503); }
}
export function GET(request: Request) { return handlePersonalCheckoutResource(request); }
