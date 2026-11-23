import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { resolveMerchantBusinessActor, MerchantBusinessAccessError } from "@/lib/merchantBusinessActor.server";
import { loadAuthoritativeCurrentMerchantSnapshotSites } from "@/lib/publishedMerchantService";
import { getMerchantServiceState } from "@/lib/merchantServiceStatus";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { parseCheckoutReportingRequest, parseCheckoutReportingSnapshot } from "@/lib/merchantCheckoutReporting";
import { readCheckoutReporting, readMixedCheckoutReporting } from "@/lib/merchantCheckoutReporting.server";
import { isMemberCheckoutOnSitePilotEnabled } from "@/lib/merchantCheckoutOnSitePilot.server";
import { isTrustedCheckoutReadRequest } from "@/lib/merchantCheckoutReadRequest";

const defaults = { enabled: isMemberCheckoutPilotEnabled, actor: resolveMerchantBusinessActor,
  site: async (id: string) => (await loadAuthoritativeCurrentMerchantSnapshotSites()).find(s => s.id === id) ?? null, read: readCheckoutReporting,
  mixedEnabled: isMemberCheckoutOnSitePilotEnabled, readMixed: readMixedCheckoutReporting };
export type CheckoutReportingDependencies = typeof defaults;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: {
  "cache-control": "private, no-store", pragma: "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", vary: "Cookie, Authorization",
} });
async function body(request: Request) {
  if (!request.body) throw new Error("checkout_reporting_invalid");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let value = "", size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new Error("checkout_reporting_too_large"); }
      value += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(value + decoder.decode());
  } catch (error) {
    if (error instanceof Error && error.message === "checkout_reporting_too_large") throw error;
    throw new Error("checkout_reporting_invalid");
  } finally { reader.releaseLock(); }
}

async function reportingOwner(request: Request, siteId: string, deps: CheckoutReportingDependencies) {
  const initial = await deps.actor(request, { siteId });
  if (initial.type !== "owner" || initial.siteId !== siteId) throw new MerchantBusinessAccessError("owner_required", 403);
  const ownerSignature = JSON.stringify([initial.authUserId, initial.principalKey, initial.authorizationVersion]);
  const initialSite = await deps.site(siteId);
  if (!initialSite || initialSite.id !== siteId || initialSite.status !== "online" || getMerchantServiceState(initialSite.status, initialSite.serviceExpiresAt).reason !== null) throw new MerchantBusinessAccessError("permission_denied", 403);
  const permissionSignature = JSON.stringify(initialSite.permissionConfig);
  const serviceExpiresAt = initialSite.serviceExpiresAt;
  const identityKey = createHash("sha256").update(JSON.stringify([siteId, ownerSignature, permissionSignature, serviceExpiresAt])).digest("hex");
  const reauthorize = async () => {
    const current = await deps.actor(request, { siteId }), site = await deps.site(siteId);
    if (current.type !== "owner" || current.siteId !== siteId
      || JSON.stringify([current.authUserId, current.principalKey, current.authorizationVersion]) !== ownerSignature
      || !site || site.id !== siteId || site.status !== "online" || getMerchantServiceState(site.status, site.serviceExpiresAt).reason !== null
      || JSON.stringify(site.permissionConfig) !== permissionSignature || site.serviceExpiresAt !== serviceExpiresAt || !deps.enabled(siteId)) throw new MerchantBusinessAccessError("permission_denied", 403);
  };
  return { identityKey, reauthorize };
}

/** UI discovery only, never an authorization token. No ledger/profile read.
 * The existing report still checks the actual owner before and after its read. */
export async function handleCheckoutReportingAccess(request: Request, overrides: Partial<CheckoutReportingDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedCheckoutReadRequest(request)) return json({ error: "forbidden_origin" }, 403);
  const params = new URL(request.url).searchParams, siteId = params.get("siteId") ?? "";
  if ([...params.keys()].some(k => k !== "siteId") || params.getAll("siteId").length !== 1 || !/^\d{8}$/.test(siteId)) return json({ error: "checkout_reporting_invalid" }, 400);
  if (!deps.enabled(siteId)) return json({ ok: true, access: null });
  try {
    const access = await reportingOwner(request, siteId, deps);
    await access.reauthorize();
    return json({ ok: true, access: { siteId, identityKey: access.identityKey } });
  } catch (error) {
    return error instanceof MerchantBusinessAccessError ? json({ error: error.code }, error.status) : json({ error: "checkout_reporting_unavailable" }, 503);
  }
}

/** POST carries bounded lookup keys only. It is a read, not a financial command.
 * Staff access is deliberately not assumed from booking/order edit permissions. */
export async function handleCheckoutReporting(request: Request, overrides: Partial<CheckoutReportingDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (new URL(request.url).search || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return json({ error: "checkout_reporting_invalid" }, 400);
  try {
    const scope = parseCheckoutReportingRequest(await body(request));
    if (!deps.enabled(scope.siteId)) return json({ error: "checkout_disabled" }, 503);
    const { identityKey, reauthorize } = await reportingOwner(request, scope.siteId, deps);
    const expectedIdentity = request.headers.get("x-checkout-owner-scope");
    if (expectedIdentity !== null && expectedIdentity !== identityKey) return json({ error: "permission_denied" }, 403);
    await reauthorize();
    const mixed = deps.mixedEnabled(scope.siteId), report = await (mixed ? deps.readMixed : deps.read)(scope);
    await reauthorize();
    if (deps.mixedEnabled(scope.siteId) !== mixed) throw new Error("checkout_reporting_unavailable");
    let snapshot;
    try { snapshot = parseCheckoutReportingSnapshot(report, scope); } catch { throw new Error("checkout_reporting_unavailable"); }
    return json({ ok: true, snapshot });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) return json({ error: error.code }, error.status);
    const message = error instanceof Error ? error.message : "";
    return message === "checkout_reporting_invalid" ? json({ error: message }, 400)
      : message === "checkout_reporting_too_large" ? json({ error: message }, 413) : json({ error: "checkout_reporting_unavailable" }, 503);
  }
}
export function POST(request: Request) { return handleCheckoutReporting(request); }
export function GET(request: Request) { return handleCheckoutReportingAccess(request); }
