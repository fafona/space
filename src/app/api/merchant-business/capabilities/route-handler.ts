import { NextResponse } from "next/server";
import {
  resolveMerchantBusinessActor,
  toMerchantBusinessAccessResponse,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";
import type { MerchantStaffBusinessPermissionGroup } from "@/lib/merchantStaffBusiness";
import {
  resolveMerchantBookingRuleOptionSets,
  type MerchantBookingRulesSnapshot,
} from "@/lib/merchantBookingRules";
import { loadMerchantBookingRulesSnapshot } from "@/lib/merchantBookingRulesStore";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
} as const;

const BUSINESS_MENU_ROOTS = [
  ["redemptions.view", "积分兑换"],
  ["bookings.view", "预约管理"],
  ["orders.view", "订单管理"],
  ["conversations.view", "会话"],
  ["members.view", "会员管理"],
] as const;

type ResolveActor = typeof resolveMerchantBusinessActor;

type MerchantBusinessCapabilitiesDependencies = {
  resolveActor: ResolveActor;
  loadSnapshotSite: typeof loadCurrentMerchantSnapshotSiteBySiteId;
  loadBookingRules: typeof loadMerchantBookingRulesSnapshot;
};

const DEFAULT_DEPENDENCIES: MerchantBusinessCapabilitiesDependencies = {
  resolveActor: resolveMerchantBusinessActor,
  loadSnapshotSite: loadCurrentMerchantSnapshotSiteBySiteId,
  loadBookingRules: loadMerchantBookingRulesSnapshot,
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_RESPONSE_HEADERS,
  });
}

export function toPublicMerchantBusinessCapabilities(actor: MerchantBusinessActor) {
  const menus = BUSINESS_MENU_ROOTS.filter(([permission]) =>
    actor.businessPermissions.includes(permission),
  ).map(([, group]) => group) as MerchantStaffBusinessPermissionGroup[];
  const collaborationPermissions = [...actor.collaborationPermissions];
  const permissions = [...actor.businessPermissions];
  return {
    schemaVersion: 1 as const,
    actor: {
      type: actor.type,
      displayName: actor.displayName,
      principalKey: actor.principalKey,
      authorizationVersion: actor.authorizationVersion,
    },
    cacheNamespace: JSON.stringify([
      "merchant-business",
      1,
      actor.siteId,
      actor.principalKey,
      actor.authorizationVersion,
      collaborationPermissions,
      permissions,
    ]),
    collaborationPermissions,
    permissions,
    menus,
  };
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return "";
  }
  return normalized;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

export function toPublicMerchantBusinessWorkspace(
  actor: MerchantBusinessActor,
  snapshotSite: Awaited<ReturnType<typeof loadCurrentMerchantSnapshotSiteBySiteId>>,
  bookingRules: MerchantBookingRulesSnapshot | null,
) {
  const siteName =
    safeText(snapshotSite?.merchantName, 120) ||
    safeText(snapshotSite?.name, 120) ||
    actor.siteId;
  const workspace: Record<string, unknown> = {
    siteId: actor.siteId,
    siteName,
    siteCountryCode: safeText(snapshotSite?.location?.countryCode, 8),
  };
  if (!actor.businessPermissions.includes("bookings.view")) return workspace;
  const exactBookingRules =
    bookingRules?.siteId === actor.siteId ? bookingRules : null;
  const optionSets = (exactBookingRules?.entries ?? []).map((entry) =>
    resolveMerchantBookingRuleOptionSets(entry, siteName),
  );
  workspace.booking = {
    storeOptions: unique(optionSets.flatMap((options) => options.store)),
    itemOptions: unique(optionSets.flatMap((options) => options.item)),
    titleOptions: unique(optionSets.flatMap((options) => options.title)),
    bookingRulesSnapshot: exactBookingRules,
    allowBookingEmailPrefill:
      snapshotSite?.permissionConfig?.allowBookingEmailPrefill === true,
    allowCustomerAutoEmail:
      snapshotSite?.permissionConfig?.allowBookingAutoEmail === true,
  };
  return workspace;
}

export async function handleMerchantBusinessCapabilitiesGet(
  request: Request,
  dependencyOverrides: Partial<MerchantBusinessCapabilitiesDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const siteId = readUniqueMerchantBusinessSiteId(request.url);
  if (!siteId) return json({ ok: false, error: "invalid_site_id" }, 400);
  try {
    const actor = await dependencies.resolveActor(request, { siteId });
    const [snapshotSite, bookingRules] = await Promise.all([
      dependencies.loadSnapshotSite(siteId).catch(() => null),
      actor.businessPermissions.includes("bookings.view")
        ? dependencies.loadBookingRules(siteId).catch(() => null)
        : Promise.resolve(null),
    ]);
    return json({
      ok: true,
      ...toPublicMerchantBusinessCapabilities(actor),
      workspace: toPublicMerchantBusinessWorkspace(
        actor,
        snapshotSite,
        bookingRules,
      ),
    });
  } catch (error) {
    const resolved = toMerchantBusinessAccessResponse(error);
    return json(resolved.body, resolved.status);
  }
}

export async function GET(request: Request) {
  return handleMerchantBusinessCapabilitiesGet(request);
}
