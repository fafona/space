import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  authorizeMerchantBusinessRequest,
  MerchantBusinessAccessError,
  reauthorizeMerchantBusinessMutation,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import { getMerchantBookingAutomationRuntimeSnapshot } from "@/lib/merchantBookingAutomationRuntime";
import {
  getMerchantBookingWorkbenchPublicSettings,
  normalizeMerchantBookingWorkbenchSettings,
  type MerchantBookingWorkbenchSettings,
} from "@/lib/merchantBookingWorkbench";
import {
  loadMerchantBookingWorkbenchSettings,
  updateMerchantBookingWorkbenchSettings,
} from "@/lib/merchantBookingWorkbenchStore";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";
import {
  listMerchantPushSubscriptionsForMerchant,
} from "@/lib/merchantPushSubscriptions";
import {
  loadStoredMerchantPushSubscriptions,
  type MerchantPushSubscriptionStoreClient,
} from "@/lib/merchantPushSubscriptionStore";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CalendarSyncAction = "keep" | "ensure" | "reset" | "disable";
type WorkbenchSection = "settings" | "automation" | "calendar";

type WorkbenchDashboard = Awaited<ReturnType<typeof buildWorkbenchDashboard>>;

export type MerchantBookingWorkbenchRouteDependencies = {
  authorizeActor: typeof authorizeMerchantBusinessRequest;
  reauthorizeActor: typeof reauthorizeMerchantBusinessMutation;
  loadSettings: typeof loadMerchantBookingWorkbenchSettings;
  updateSettings: typeof updateMerchantBookingWorkbenchSettings;
  loadSnapshotSite: typeof loadCurrentMerchantSnapshotSiteBySiteId;
  buildDashboard: typeof buildWorkbenchDashboard;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function applyCalendarSyncAction(
  settings: MerchantBookingWorkbenchSettings,
  action: CalendarSyncAction,
): MerchantBookingWorkbenchSettings {
  if (action === "disable") {
    return {
      ...settings,
      calendarSyncToken: "",
      calendarSyncTokenUpdatedAt: "",
    };
  }
  if (action === "reset" || (action === "ensure" && !settings.calendarSyncToken)) {
    return {
      ...settings,
      calendarSyncToken: randomBytes(18).toString("hex"),
      calendarSyncTokenUpdatedAt: new Date().toISOString(),
    };
  }
  return settings;
}

function applyAutoEmailPermissionGuard(
  nextSettings: MerchantBookingWorkbenchSettings,
  currentSettings: MerchantBookingWorkbenchSettings,
  allowAutoEmail: boolean,
) {
  if (allowAutoEmail) return nextSettings;
  return {
    ...nextSettings,
    customerAutoEmailEnabled: currentSettings.customerAutoEmailEnabled,
    customerAutoEmailStatuses: [...currentSettings.customerAutoEmailStatuses],
    customerAutoEmailMessageByStatus: {
      ...currentSettings.customerAutoEmailMessageByStatus,
    },
    customerReminderOffsetsMinutes: [
      ...currentSettings.customerReminderOffsetsMinutes,
    ],
  } satisfies MerchantBookingWorkbenchSettings;
}

async function buildWorkbenchDashboard(siteId: string) {
  let pushDeviceCount = 0;
  const supabase = createServerSupabaseServiceClient();
  if (supabase) {
    const payload = await loadStoredMerchantPushSubscriptions(
      supabase as unknown as MerchantPushSubscriptionStoreClient,
    ).catch(() => null);
    if (payload) {
      pushDeviceCount = listMerchantPushSubscriptionsForMerchant(
        payload,
        siteId,
      ).filter((item) => item.permission === "granted").length;
    }
  }
  return {
    pushDeviceCount,
    automation: getMerchantBookingAutomationRuntimeSnapshot(),
  };
}

const DEFAULT_DEPENDENCIES: MerchantBookingWorkbenchRouteDependencies = {
  authorizeActor: authorizeMerchantBusinessRequest,
  reauthorizeActor: reauthorizeMerchantBusinessMutation,
  loadSettings: loadMerchantBookingWorkbenchSettings,
  updateSettings: updateMerchantBookingWorkbenchSettings,
  loadSnapshotSite: loadCurrentMerchantSnapshotSiteBySiteId,
  buildDashboard: buildWorkbenchDashboard,
};

function getSectionPermission(
  section: WorkbenchSection | null,
): MerchantStaffBusinessPermission {
  if (section === "settings") return "bookings.settings.manage";
  if (section === "automation") return "bookings.automation.manage";
  if (section === "calendar") return "bookings.calendar.manage";
  return "bookings.view";
}

function parseSection(value: unknown): WorkbenchSection | null {
  return value === "settings" || value === "automation" || value === "calendar"
    ? value
    : null;
}

function parseCalendarSyncAction(value: unknown): CalendarSyncAction {
  return value === "ensure" || value === "reset" || value === "disable"
    ? value
    : "keep";
}

function projectSettingsForActor(
  settings: MerchantBookingWorkbenchSettings,
  actor: MerchantBusinessActor,
) {
  if (actor.type === "owner") return settings;
  const visible: Record<string, unknown> = {
    ...getMerchantBookingWorkbenchPublicSettings(settings),
  };
  if (actor.businessPermissions.includes("bookings.automation.manage")) {
    Object.assign(visible, {
      customerEmailLocale: settings.customerEmailLocale,
      customerAutoEmailEnabled: settings.customerAutoEmailEnabled,
      customerAutoEmailStatuses: [...settings.customerAutoEmailStatuses],
      customerAutoEmailMessageByStatus: {
        ...settings.customerAutoEmailMessageByStatus,
      },
      customerEmailSenderName: settings.customerEmailSenderName,
      customerReminderOffsetsMinutes: [
        ...settings.customerReminderOffsetsMinutes,
      ],
      merchantReminderOffsetsMinutes: [
        ...settings.merchantReminderOffsetsMinutes,
      ],
      appointmentAutoStatus: settings.appointmentAutoStatus,
      noShowEnabled: settings.noShowEnabled,
      noShowGraceMinutes: settings.noShowGraceMinutes,
    });
  }
  if (actor.businessPermissions.includes("bookings.calendar.manage")) {
    Object.assign(visible, {
      // Calendar feed tokens are long-lived bearer credentials. Employees may
      // rotate or disable the feed, but must never receive a credential that
      // would remain usable after their role or employment is revoked.
      calendarSyncEnabled: Boolean(settings.calendarSyncToken),
      calendarSyncTokenUpdatedAt: settings.calendarSyncTokenUpdatedAt,
    });
  }
  return visible;
}

function projectDashboardForActor(
  dashboard: WorkbenchDashboard,
  actor: MerchantBusinessActor,
) {
  if (actor.type === "owner") return dashboard;
  return {
    ...(actor.businessPermissions.includes("bookings.analytics.view")
      ? { pushDeviceCount: dashboard.pushDeviceCount }
      : {}),
    ...(actor.businessPermissions.includes("bookings.automation.manage")
      ? { automation: dashboard.automation }
      : {}),
  };
}

function buildCapabilities(actor: MerchantBusinessActor) {
  return {
    settings: actor.businessPermissions.includes("bookings.settings.manage"),
    automation: actor.businessPermissions.includes("bookings.automation.manage"),
    calendar: actor.businessPermissions.includes("bookings.calendar.manage"),
    analytics: actor.businessPermissions.includes("bookings.analytics.view"),
  };
}

function mergeSettingsSection(
  current: MerchantBookingWorkbenchSettings,
  proposed: MerchantBookingWorkbenchSettings,
  section: WorkbenchSection,
  calendarSyncAction: CalendarSyncAction,
  allowAutoEmail: boolean,
) {
  if (section === "settings") {
    return {
      ...current,
      minAdvanceMinutes: proposed.minAdvanceMinutes,
      dailyCutoffTime: proposed.dailyCutoffTime,
      bufferMinutes: proposed.bufferMinutes,
      recurringRules: proposed.recurringRules,
      storeColorStyles: proposed.storeColorStyles,
      itemColorStyles: proposed.itemColorStyles,
    };
  }
  if (section === "automation") {
    return applyAutoEmailPermissionGuard(
      {
        ...current,
        customerEmailLocale: proposed.customerEmailLocale,
        customerAutoEmailEnabled: proposed.customerAutoEmailEnabled,
        customerAutoEmailStatuses: proposed.customerAutoEmailStatuses,
        customerAutoEmailMessageByStatus:
          proposed.customerAutoEmailMessageByStatus,
        customerEmailSenderName: proposed.customerEmailSenderName,
        customerReminderOffsetsMinutes:
          proposed.customerReminderOffsetsMinutes,
        merchantReminderOffsetsMinutes:
          proposed.merchantReminderOffsetsMinutes,
        appointmentAutoStatus: proposed.appointmentAutoStatus,
        noShowEnabled: proposed.noShowEnabled,
        noShowGraceMinutes: proposed.noShowGraceMinutes,
      },
      current,
      allowAutoEmail,
    );
  }
  return applyCalendarSyncAction(current, calendarSyncAction);
}

function authorizationErrorResponse(error: unknown) {
  if (error instanceof MerchantBusinessAccessError) {
    return privateJson({ error: error.code }, { status: error.status });
  }
  return privateJson({ error: "booking_workbench_failed" }, { status: 503 });
}

export async function handleMerchantBookingWorkbenchGet(
  request: Request,
  dependencyOverrides: Partial<MerchantBookingWorkbenchRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const siteId = readUniqueMerchantBusinessSiteId(request.url);
  if (!siteId) {
    return privateJson({ error: "invalid_site_id" }, { status: 400 });
  }
  try {
    const actor = await dependencies.authorizeActor(request, {
      siteId,
      requiredPermission: "bookings.view",
    });
    const settings = await dependencies.loadSettings(siteId);
    const dashboard = await dependencies.buildDashboard(siteId);
    return privateJson({
      ok: true,
      settings: projectSettingsForActor(settings, actor),
      dashboard: projectDashboardForActor(dashboard, actor),
      ...(actor.type === "employee"
        ? { capabilities: buildCapabilities(actor) }
        : {}),
    });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantBookingWorkbenchGet(request);
}

export async function handleMerchantBookingWorkbenchPatch(
  request: Request,
  dependencyOverrides: Partial<MerchantBookingWorkbenchRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  if (!isTrustedSameOriginMutationRequest(request)) {
    return applyPrivateResponseHeaders(getTrustedMutationRequestErrorResponse());
  }

  const body = (await request.json().catch(() => null)) as
    | {
        siteId?: unknown;
        settings?: unknown;
        section?: unknown;
        calendarSyncAction?: unknown;
      }
    | null;
  if (!body) {
    return privateJson(
      { error: "invalid_booking_workbench_request" },
      { status: 400 },
    );
  }
  const siteId = trimText(body.siteId);
  if (!/^\d{8}$/.test(siteId)) {
    return privateJson({ error: "invalid_site_id" }, { status: 400 });
  }
  const rawSection = trimText(body.section);
  const section = parseSection(rawSection);
  if (rawSection && !section) {
    return privateJson(
      { error: "invalid_booking_workbench_section" },
      { status: 400 },
    );
  }
  const requiredPermission = getSectionPermission(section);

  try {
    const actor = await dependencies.authorizeActor(request, {
      siteId,
      requiredPermission,
    });
    if (actor.type === "employee" && !section) {
      return privateJson(
        { error: "booking_workbench_section_required" },
        { status: 400 },
      );
    }
    const calendarSyncAction = parseCalendarSyncAction(
      body.calendarSyncAction,
    );
    if (
      actor.type === "employee" &&
      section !== "calendar" &&
      calendarSyncAction !== "keep"
    ) {
      return privateJson({ error: "permission_denied" }, { status: 403 });
    }
    const proposed = normalizeMerchantBookingWorkbenchSettings(body.settings);
    const snapshotSite = await dependencies.loadSnapshotSite(siteId).catch(
      () => null,
    );
    const allowAutoEmail = Boolean(
      snapshotSite?.permissionConfig?.allowBookingBlock &&
        snapshotSite.permissionConfig.allowBookingAutoEmail,
    );
    const saved = await dependencies.updateSettings(siteId, {
      assertAuthorizationCurrent: async () => {
        await dependencies.reauthorizeActor(request, {
          actor,
          requiredPermissions: [requiredPermission],
        });
      },
      update: (current) => {
        if (actor.type === "employee" && section) {
          return mergeSettingsSection(
            current,
            proposed,
            section,
            calendarSyncAction,
            allowAutoEmail,
          );
        }
        return applyCalendarSyncAction(
          applyAutoEmailPermissionGuard(proposed, current, allowAutoEmail),
          calendarSyncAction,
        );
      },
    });
    return privateJson({
      ok: true,
      settings: projectSettingsForActor(saved, actor),
      ...(actor.type === "employee"
        ? { capabilities: buildCapabilities(actor) }
        : {}),
    });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  return handleMerchantBookingWorkbenchPatch(request);
}
