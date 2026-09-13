import { NextResponse } from "next/server";
import {
  MerchantBusinessAccessError,
  resolveMerchantBusinessActor,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getMerchantMembershipSettingsScopePermission,
  isMerchantMembershipSettingsViewAllowedForScope,
  selectMerchantMembershipSettingsForEmployeeScope,
  type MerchantMembershipSettingsEmployeeScope,
} from "@/lib/merchantMembershipBusinessPermissions";
import {
  buildRedemptionCashierSettings,
  getMerchantMembershipSettings,
  updateMerchantMembershipSettings,
  updateMerchantMembershipPrintSettings,
} from "@/lib/merchantMembershipSettings.server";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type MerchantMembershipSettingsRouteDependencies = {
  resolveActor: typeof resolveMerchantBusinessActor;
  loadSettings: typeof getMerchantMembershipSettings;
  updateSettings: typeof updateMerchantMembershipSettings;
  updatePrintSettings: typeof updateMerchantMembershipPrintSettings;
};

const DEFAULT_DEPENDENCIES: MerchantMembershipSettingsRouteDependencies = {
  resolveActor: resolveMerchantBusinessActor,
  loadSettings: getMerchantMembershipSettings,
  updateSettings: updateMerchantMembershipSettings,
  updatePrintSettings: updateMerchantMembershipPrintSettings,
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function applyPrivateResponseHeaders(response: Response) {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function privateJson(body: unknown, init?: ResponseInit) {
  return applyPrivateResponseHeaders(NextResponse.json(body, init));
}

function readEmployeeScope(value: unknown): MerchantMembershipSettingsEmployeeScope | null {
  return value === "members" || value === "redemptions" ? value : null;
}

function requireActorPermission(
  actor: MerchantBusinessActor,
  permission: MerchantStaffBusinessPermission,
) {
  if (actor.type === "owner" || actor.businessPermissions.includes(permission)) return;
  throw new MerchantBusinessAccessError("permission_denied", 403);
}

async function assertSettingsAuthorizationCurrent(
  request: Request,
  actor: MerchantBusinessActor,
  resolveActor: MerchantMembershipSettingsRouteDependencies["resolveActor"],
  requiredPermission?: MerchantStaffBusinessPermission,
) {
  const current = await resolveActor(request, { siteId: actor.siteId });
  if (
    current.type !== actor.type ||
    current.principalKey !== actor.principalKey ||
    current.authorizationVersion !== actor.authorizationVersion ||
    (requiredPermission &&
      current.type !== "owner" &&
      !current.businessPermissions.includes(requiredPermission))
  ) {
    throw new MerchantBusinessAccessError("permission_denied", 403);
  }
}

function settingsErrorResponse(error: unknown, code: string) {
  if (error instanceof MerchantBusinessAccessError) {
    return privateJson({ error: error.code }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "unknown_error";
  return privateJson(
    { error: code, message },
    { status: message === "merchant_membership_settings_conflict" ? 409 : 400 },
  );
}

export async function handleMerchantMembershipSettingsGet(
  request: Request,
  dependencyOverrides: Partial<MerchantMembershipSettingsRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const url = new URL(request.url);
    const siteId = readUniqueMerchantBusinessSiteId(url);
    if (!isMerchantNumericId(siteId)) {
      return privateJson({ error: "invalid_site_id" }, { status: 400 });
    }
    const actor = await dependencies.resolveActor(request, { siteId });
    const rawScope = trimText(url.searchParams.get("scope"), 64);
    const employeeScope = readEmployeeScope(rawScope);
    if (actor.type === "employee") {
      if (rawScope === "redemption-cashier") {
        requireActorPermission(actor, "redemptions.view");
      } else {
        const permission = getMerchantMembershipSettingsScopePermission(employeeScope);
        if (!employeeScope || !permission) {
          throw new MerchantBusinessAccessError("membership_settings_scope_required", 400);
        }
        requireActorPermission(actor, permission);
      }
    }

    const settings = await dependencies.loadSettings(siteId);
    const version = settings.updatedAt ?? null;
    const knownVersion = trimText(url.searchParams.get("knownVersion"), 128);
    // Employees never receive `notModified`: a shared browser cache may have
    // been populated by an owner or a differently privileged role.
    if (actor.type === "owner" && knownVersion && version && knownVersion === version) {
      return privateJson({ ok: true, notModified: true, version });
    }
    const responseSettings =
      rawScope === "redemption-cashier"
        ? buildRedemptionCashierSettings(settings)
        : employeeScope
          ? selectMerchantMembershipSettingsForEmployeeScope(settings, employeeScope)
          : settings;
    return privateJson({ ok: true, settings: responseSettings, version });
  } catch (error) {
    return settingsErrorResponse(error, "membership_settings_load_failed");
  }
}

export async function GET(request: Request) {
  return handleMerchantMembershipSettingsGet(request);
}

export async function handleMerchantMembershipSettingsPut(
  request: Request,
  dependencyOverrides: Partial<MerchantMembershipSettingsRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  if (!isTrustedSameOriginMutationRequest(request)) {
    return applyPrivateResponseHeaders(getTrustedMutationRequestErrorResponse());
  }
  try {
    const body = (await request.json().catch(() => null)) as {
      siteId?: unknown;
      settings?: unknown;
      view?: unknown;
      scope?: unknown;
      expectedUpdatedAt?: unknown;
    } | null;
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return privateJson({ error: "invalid_site_id" }, { status: 400 });
    }
    const actor = await dependencies.resolveActor(request, { siteId });
    let requiredPermission: MerchantStaffBusinessPermission | undefined;
    if (actor.type === "employee") {
      const scope = readEmployeeScope(trimText(body?.scope, 64));
      requiredPermission = getMerchantMembershipSettingsScopePermission(scope) ?? undefined;
      if (!scope || !requiredPermission) {
        throw new MerchantBusinessAccessError("membership_settings_scope_required", 400);
      }
      requireActorPermission(actor, requiredPermission);
      if (!isMerchantMembershipSettingsViewAllowedForScope(scope, body?.view)) {
        throw new MerchantBusinessAccessError("membership_settings_scope_mismatch", 403);
      }
    }
    const updateSettings = dependencyOverrides.updateSettings
      ? dependencies.updateSettings
      : (input: Parameters<typeof updateMerchantMembershipSettings>[0]) =>
          updateMerchantMembershipSettings({
            ...input,
            settings: body?.settings,
            view: body?.view,
          });
    const settings = await updateSettings({
      siteId,
      settings: body?.settings,
      view: body?.view,
      operatorId: actor.principalKey,
      assertAuthorizationCurrent: () =>
        assertSettingsAuthorizationCurrent(
          request,
          actor,
          dependencies.resolveActor,
          requiredPermission,
        ),
      ...(body && Object.prototype.hasOwnProperty.call(body, "expectedUpdatedAt")
        ? { expectedUpdatedAt: body.expectedUpdatedAt }
        : {}),
    });
    const scope = readEmployeeScope(trimText(body?.scope, 64));
    return privateJson({
      ok: true,
      settings:
        actor.type === "employee" && scope
          ? selectMerchantMembershipSettingsForEmployeeScope(settings, scope)
          : settings,
    });
  } catch (error) {
    return settingsErrorResponse(error, "membership_settings_save_failed");
  }
}

export async function PUT(request: Request) {
  return handleMerchantMembershipSettingsPut(request);
}

export async function handleMerchantMembershipSettingsPatch(
  request: Request,
  dependencyOverrides: Partial<MerchantMembershipSettingsRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  if (!isTrustedSameOriginMutationRequest(request)) {
    return applyPrivateResponseHeaders(getTrustedMutationRequestErrorResponse());
  }
  try {
    const body = (await request.json().catch(() => null)) as {
      siteId?: unknown;
      printSettings?: unknown;
    } | null;
    const siteId = trimText(body?.siteId, 64);
    if (!isMerchantNumericId(siteId)) {
      return privateJson({ error: "invalid_site_id" }, { status: 400 });
    }
    const actor = await dependencies.resolveActor(request, { siteId });
    if (actor.type !== "owner") {
      throw new MerchantBusinessAccessError("owner_required", 403);
    }
    const settings = await dependencies.updatePrintSettings({
      siteId,
      printSettings: body?.printSettings,
      operatorId: actor.principalKey,
      assertAuthorizationCurrent: () =>
        assertSettingsAuthorizationCurrent(
          request,
          actor,
          dependencies.resolveActor,
        ),
    });
    return privateJson({ ok: true, settings });
  } catch (error) {
    return settingsErrorResponse(error, "membership_print_settings_save_failed");
  }
}

export async function PATCH(request: Request) {
  return handleMerchantMembershipSettingsPatch(request);
}
