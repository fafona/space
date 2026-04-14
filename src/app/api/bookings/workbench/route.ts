import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  normalizeMerchantBookingWorkbenchSettings,
  type MerchantBookingWorkbenchSettings,
} from "@/lib/merchantBookingWorkbench";
import {
  loadMerchantBookingWorkbenchSettings,
  saveMerchantBookingWorkbenchSettings,
} from "@/lib/merchantBookingWorkbenchStore";
import { getMerchantBookingAutomationRuntimeSnapshot } from "@/lib/merchantBookingAutomationRuntime";
import {
  listMerchantPushSubscriptionsForMerchant,
} from "@/lib/merchantPushSubscriptions";
import {
  loadStoredMerchantPushSubscriptions,
  type MerchantPushSubscriptionStoreClient,
} from "@/lib/merchantPushSubscriptionStore";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CalendarSyncAction = "keep" | "ensure" | "reset" | "disable";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function resolveWorkbenchSession(request: Request, hintedSiteId: string) {
  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: hintedSiteId,
  });
  if (!session || session.merchantId !== hintedSiteId) return null;
  return session;
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
    customerAutoEmailMessageByStatus: { ...currentSettings.customerAutoEmailMessageByStatus },
    customerReminderOffsetsMinutes: [...currentSettings.customerReminderOffsetsMinutes],
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
      pushDeviceCount = listMerchantPushSubscriptionsForMerchant(payload, siteId).filter(
        (item) => item.permission === "granted",
      ).length;
    }
  }
  return {
    pushDeviceCount,
    automation: getMerchantBookingAutomationRuntimeSnapshot(),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = trimText(searchParams.get("siteId"));
  if (!isMerchantNumericId(siteId)) {
    return noStoreJson({ error: "invalid_site_id" }, { status: 400 });
  }
  const session = await resolveWorkbenchSession(request, siteId);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }
  const settings = await loadMerchantBookingWorkbenchSettings(siteId);
  const dashboard = await buildWorkbenchDashboard(siteId);
  return noStoreJson({ ok: true, settings, dashboard });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        siteId?: unknown;
        settings?: unknown;
        calendarSyncAction?: unknown;
      }
    | null;
  const siteId = trimText(body?.siteId);
  if (!isMerchantNumericId(siteId)) {
    return noStoreJson({ error: "invalid_site_id" }, { status: 400 });
  }
  const session = await resolveWorkbenchSession(request, siteId);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const currentSettings = await loadMerchantBookingWorkbenchSettings(siteId);
  const baseSettings = normalizeMerchantBookingWorkbenchSettings(body?.settings);
  const calendarSyncAction =
    body?.calendarSyncAction === "ensure" ||
    body?.calendarSyncAction === "reset" ||
    body?.calendarSyncAction === "disable"
      ? body.calendarSyncAction
      : "keep";
  const snapshotSite = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  const allowAutoEmail = Boolean(
    snapshotSite?.permissionConfig?.allowBookingBlock && snapshotSite?.permissionConfig?.allowBookingAutoEmail,
  );
  const nextSettings = applyCalendarSyncAction(
    applyAutoEmailPermissionGuard(baseSettings, currentSettings, allowAutoEmail),
    calendarSyncAction,
  );
  const saved = await saveMerchantBookingWorkbenchSettings(siteId, nextSettings);
  return noStoreJson({ ok: true, settings: saved });
}
