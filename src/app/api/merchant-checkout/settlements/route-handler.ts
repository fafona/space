import { NextResponse } from "next/server";
import { MerchantBusinessAccessError } from "@/lib/merchantBusinessActor.server";
import { authorizeCheckoutOwner as reportingOwner, checkoutOwnerDependencies } from "@/lib/merchantCheckoutOwnerAccess.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { parseCheckoutReportingRequest, parseCheckoutReportingSnapshot } from "@/lib/merchantCheckoutReporting";
import { readCheckoutReporting, readMixedCheckoutReporting, readCartCheckoutReporting } from "@/lib/merchantCheckoutReporting.server";
import { isMemberCheckoutCartPilotEnabled, isMemberCheckoutCartCollectionEnabled } from "@/lib/merchantCheckoutCartPilot.server";
import { isMemberCheckoutOnSitePilotEnabled, isMemberCheckoutOnSiteCollectionEnabled } from "@/lib/merchantCheckoutOnSitePilot.server";
import { isTrustedCheckoutReadRequest } from "@/lib/merchantCheckoutReadRequest";
import { isMemberCheckoutHistoryReadEnabled } from "@/lib/merchantCheckoutHistoryPilot.server";
import { checkoutHistoryReadBudget } from "@/lib/merchantCheckoutHistoryRead.server";

const defaults = { ...checkoutOwnerDependencies, enabled: isMemberCheckoutPilotEnabled, read: readCheckoutReporting,
  mixedEnabled: isMemberCheckoutOnSitePilotEnabled, readMixed: readMixedCheckoutReporting, collectionEnabled: isMemberCheckoutOnSiteCollectionEnabled };
const cartDefaults = { cartEnabled: (siteId: string) => isMemberCheckoutCartPilotEnabled(siteId, "points"), readCart: readCartCheckoutReporting, cartCollectionEnabled: isMemberCheckoutCartCollectionEnabled, historyEnabled: isMemberCheckoutHistoryReadEnabled };
export type CheckoutReportingDependencies = typeof defaults & Partial<typeof cartDefaults>;
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

// Only the new explicit history scope uses these bounded READ ports. The
// shared owner authority and every mutation keep their original purchase gate.
function historyOwnerPorts(request: Request, deps: typeof defaults & typeof cartDefaults, siteId: string, purchase: boolean) {
  const budget = checkoutHistoryReadBudget(request);
  return { ...deps, enabled: (id: string) => { budget.guard(); return id === siteId && deps.enabled(id) === purchase && deps.historyEnabled(id); },
    actor: (...args: Parameters<typeof deps.actor>) => budget.run(() => deps.actor(...args)),
    site: (...args: Parameters<typeof deps.site>) => budget.run(() => deps.site(...args)), budget };
}


/** UI discovery only, never an authorization token. No ledger/profile read.
 * The existing report still checks the actual owner before and after its read. */
export async function handleCheckoutReportingAccess(request: Request, overrides: Partial<CheckoutReportingDependencies> = {}) {
  const deps = { ...defaults, ...cartDefaults, ...overrides };
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedCheckoutReadRequest(request)) return json({ error: "forbidden_origin" }, 403);
  const params = new URL(request.url).searchParams, siteId = params.get("siteId") ?? "";
  if ([...params.keys()].some(k => k !== "siteId") || params.getAll("siteId").length !== 1 || !/^\d{8}$/.test(siteId)) return json({ error: "checkout_reporting_invalid" }, 400);
  const purchase = deps.enabled(siteId), history = deps.historyEnabled(siteId);
  if (!purchase && !history) return json({ ok: true, access: null });
  try {
    const access = await reportingOwner(request, siteId, history ? historyOwnerPorts(request, deps, siteId, purchase) : deps);
    await access.reauthorize();
    if (deps.enabled(siteId) !== purchase || deps.historyEnabled(siteId) !== history) throw new Error("unavailable");
    return json({ ok: true, access: { siteId, identityKey: access.identityKey } });
  } catch (error) {
    return error instanceof MerchantBusinessAccessError ? json({ error: error.code }, error.status) : json({ error: "checkout_reporting_unavailable" }, 503);
  }
}

/** POST carries bounded lookup keys only. It is a read, not a financial command.
 * Staff access is deliberately not assumed from booking/order edit permissions. */
export async function handleCheckoutReporting(request: Request, overrides: Partial<CheckoutReportingDependencies> = {}) {
  const deps = { ...defaults, ...cartDefaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (new URL(request.url).search || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return json({ error: "checkout_reporting_invalid" }, 400);
  try {
    const scope = parseCheckoutReportingRequest(await body(request));
    const purchase = deps.enabled(scope.siteId), history = deps.historyEnabled(scope.siteId);
    if (!purchase && !history) return json({ error: "checkout_disabled" }, 503);
    const ports = history ? historyOwnerPorts(request, deps, scope.siteId, purchase) : null;
    const { identityKey, reauthorize } = await reportingOwner(request, scope.siteId, ports ?? deps);
    const expectedIdentity = request.headers.get("x-checkout-owner-scope");
    if (expectedIdentity !== null && expectedIdentity !== identityKey) return json({ error: "permission_denied" }, 403);
    await reauthorize();
    const cart = deps.cartEnabled(scope.siteId), mixed = deps.mixedEnabled(scope.siteId), collect = purchase && mixed && deps.collectionEnabled(scope.siteId);
    const cartCollectGate = purchase && cart && mixed && deps.cartCollectionEnabled(scope.siteId);
    const cartCollect = cartCollectGate && (await (ports ? ports.site(scope.siteId) : deps.site(scope.siteId)))?.permissionConfig?.allowOrderManagement === true;
    const read = () => (history || cart ? deps.readCart : mixed ? deps.readMixed : deps.read)(scope);
    const report = await (ports ? ports.budget.run(read) : read());
    await reauthorize();
    if (deps.enabled(scope.siteId) !== purchase || deps.historyEnabled(scope.siteId) !== history || deps.cartEnabled(scope.siteId) !== cart || deps.mixedEnabled(scope.siteId) !== mixed || (purchase && mixed && deps.collectionEnabled(scope.siteId)) !== collect
      || (purchase && deps.cartEnabled(scope.siteId) && deps.mixedEnabled(scope.siteId) && deps.cartCollectionEnabled(scope.siteId)) !== cartCollectGate
      || report.version !== (history || cart ? 3 : mixed ? 2 : 1)) throw new Error("checkout_reporting_unavailable");
    let snapshot;
    try { snapshot = parseCheckoutReportingSnapshot(report, scope); } catch { throw new Error("checkout_reporting_unavailable"); }
    return json({ ok: true, snapshot, ...(collect ? { canRecordOnSiteReceipt: true } : {}), ...(cartCollect ? { canRecordCartReceipt: true } : {}) });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) return json({ error: error.code }, error.status);
    const message = error instanceof Error ? error.message : "";
    return message === "checkout_reporting_invalid" ? json({ error: message }, 400)
      : message === "checkout_reporting_too_large" ? json({ error: message }, 413) : json({ error: "checkout_reporting_unavailable" }, 503);
  }
}
export function POST(request: Request) { return handleCheckoutReporting(request); }
export function GET(request: Request) { return handleCheckoutReportingAccess(request); }
