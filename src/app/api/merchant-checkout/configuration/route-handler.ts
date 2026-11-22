import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveMerchantBusinessActor, MerchantBusinessAccessError } from "@/lib/merchantBusinessActor.server";
import { loadAuthoritativeCurrentMerchantSnapshotSites } from "@/lib/publishedMerchantService";
import { getMerchantServiceState } from "@/lib/merchantServiceStatus";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { loadCheckoutConfiguration, saveCheckoutConfiguration } from "@/lib/merchantCheckoutConfigurationStore.server";
import { loadCheckoutConfigurationOptions } from "@/lib/merchantCheckoutConfigurationOptions.server";
import { buildConfiguredCheckoutOffer, checkoutConfigurationUuid, parseCheckoutConfigurationEdit } from "@/lib/merchantCheckoutConfiguration";

const defaults = { enabled: isMemberCheckoutPilotEnabled, actor: resolveMerchantBusinessActor,
  site: async (siteId: string) => (await loadAuthoritativeCurrentMerchantSnapshotSites()).find(site => site.id === siteId) ?? null,
  load: loadCheckoutConfiguration, save: saveCheckoutConfiguration, options: loadCheckoutConfigurationOptions, uuid: () => randomUUID() as string };
export type CheckoutConfigurationRouteDependencies = typeof defaults;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: {
  "cache-control": "private, no-store", "pragma": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin",
} });
const safe = new Set(["checkout_configuration_invalid", "checkout_configuration_conflict", "checkout_configuration_unconfirmed", "checkout_source_changed",
  "checkout_offer_not_found", "checkout_source_rebinding_forbidden", "checkout_source_already_configured", "checkout_configuration_limit", "checkout_stock_binding_unavailable", "checkout_stock_price_changed",
  "checkout_voucher_binding_unavailable", "checkout_duration_required", "checkout_source_price_changed", "checkout_invalid_offer"]);
async function readBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0, value = "";
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength;
      if (total > 32768) { await reader.cancel(); return null; }
      value += decoder.decode(part.value, { stream: true });
    }
    return value + decoder.decode();
  } finally { reader.releaseLock(); }
}
export async function handleCheckoutConfiguration(request: Request, overrides: Partial<CheckoutConfigurationRouteDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (!["GET", "PUT"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "siteId") || params.getAll("siteId").length !== 1) return json({ error: "checkout_configuration_invalid" }, 400);
    const siteId = params.get("siteId")!;
    if (!/^\d{8}$/.test(siteId)) return json({ error: "checkout_configuration_invalid" }, 400);
    if (!deps.enabled(siteId)) return json({ error: "checkout_disabled" }, 503);
    const initial = await deps.actor(request, { siteId });
    if (initial.type !== "owner" || initial.siteId !== siteId) return json({ error: "owner_required" }, 403);
    const site = await deps.site(siteId);
    if (!site || site.id !== siteId || getMerchantServiceState(site.status, site.serviceExpiresAt).reason !== null) return json({ error: "checkout_module_unavailable" }, 403);
    const reauthorize = async () => {
      const current = await deps.actor(request, { siteId });
      if (current.type !== "owner" || current.siteId !== siteId || current.principalKey !== initial.principalKey
        || current.authorizationVersion !== initial.authorizationVersion) throw new MerchantBusinessAccessError("permission_denied", 403);
      const refreshed = await deps.site(siteId);
      if (!refreshed || JSON.stringify(refreshed.permissionConfig) !== JSON.stringify(site.permissionConfig)
        || getMerchantServiceState(refreshed.status, refreshed.serviceExpiresAt).reason !== null) throw new MerchantBusinessAccessError("permission_denied", 403);
    };
    const [snapshot, options] = await Promise.all([deps.load(siteId), deps.options(site)]);
    if (request.method === "GET") { await reauthorize(); return json({ ok: true, snapshot, options }); }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "checkout_configuration_invalid" }, 400);
    const raw = await readBody(request);
    if (raw === null) return json({ error: "checkout_configuration_invalid" }, 413);
    let body: { expectedVersion: unknown; edit: unknown };
    try { body = JSON.parse(raw); } catch { return json({ error: "checkout_configuration_invalid" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2
      || !Object.hasOwn(body, "edit") || !Object.hasOwn(body, "expectedVersion")
      || body.expectedVersion !== null && !checkoutConfigurationUuid(body.expectedVersion)) return json({ error: "checkout_configuration_invalid" }, 400);
    if (body.expectedVersion !== snapshot.version) return json({ error: "checkout_configuration_conflict" }, 409);
    const edit = parseCheckoutConfigurationEdit(body.edit);
    const source = options.sources.find(row => row.key === edit.sourceKey);
    const permissions = site.permissionConfig;
    if (!source || (source.kind === "booking" ? !permissions?.allowBookingBlock : !permissions?.allowProductBlock || !permissions.allowOrderManagement)
      || edit.unitPoints !== null && (!permissions?.allowMembershipManagement || !permissions.allowPointsRedemption)
      || edit.voucherCouponIds.length > 0 && (!permissions?.allowMembershipManagement || !permissions.allowCouponModule)) return json({ error: "checkout_module_unavailable" }, 403);
    const offer = buildConfiguredCheckoutOffer({ siteId, edit, current: snapshot, options, newId: deps.uuid(), newRevision: deps.uuid() });
    await reauthorize();
    const saved = await deps.save({ siteId, expectedVersion: snapshot.version, nextVersion: deps.uuid(), actorKey: initial.principalKey, offer });
    await reauthorize();
    return json({ ok: true, snapshot: saved });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) return json({ error: error.code }, error.status);
    const code = error instanceof Error && safe.has(error.message) ? error.message : "checkout_configuration_unavailable";
    return json({ error: code }, code === "checkout_configuration_conflict" || code === "checkout_source_changed" ? 409
      : code === "checkout_configuration_unconfirmed" || code === "checkout_configuration_unavailable" ? 503 : 400);
  }
}
export function GET(request: Request) { return handleCheckoutConfiguration(request); }
export function PUT(request: Request) { return handleCheckoutConfiguration(request); }
