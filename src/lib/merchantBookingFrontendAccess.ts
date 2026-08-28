import type {
  MerchantBusinessApiClient,
  MerchantBusinessCachePolicy,
} from "@/lib/merchantBusinessApiClient";
import type { MerchantBookingWorkbenchSettings } from "@/lib/merchantBookingWorkbench";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

export type MerchantBookingFrontendPermissions =
  | readonly MerchantStaffBusinessPermission[]
  | undefined;

export type MerchantBookingWorkbenchMutationSection =
  | "settings"
  | "automation"
  | "calendar";

export type MerchantBookingWorkbenchView =
  | "rules"
  | "reminders"
  | "analysis";

export const MERCHANT_BOOKING_NO_PERMISSIONS: readonly MerchantStaffBusinessPermission[] =
  Object.freeze([]);

export const MERCHANT_BOOKING_OWNER_CACHE_POLICY: MerchantBusinessCachePolicy =
  Object.freeze({
    mode: "default",
    allowPersistentRead: true,
    allowPersistentWrite: true,
    allowStaleOnError: true,
  });

export function hasMerchantBookingFrontendPermission(
  permissions: MerchantBookingFrontendPermissions,
  permission: MerchantStaffBusinessPermission,
) {
  return permissions === undefined || permissions.includes(permission);
}

export function isMerchantBookingEmployeeFrontend(input: {
  apiClient?: MerchantBusinessApiClient;
  cachePolicy?: MerchantBusinessCachePolicy;
  permissions?: MerchantBookingFrontendPermissions;
}) {
  return (
    input.apiClient !== undefined ||
    input.permissions !== undefined ||
    input.cachePolicy?.mode === "disabled"
  );
}

export function getMerchantBookingWorkbenchSectionPermission(
  section: MerchantBookingWorkbenchMutationSection,
): MerchantStaffBusinessPermission {
  if (section === "settings") return "bookings.settings.manage";
  if (section === "automation") return "bookings.automation.manage";
  return "bookings.calendar.manage";
}

export function canManageMerchantBookingWorkbenchSection(
  permissions: MerchantBookingFrontendPermissions,
  section: MerchantBookingWorkbenchMutationSection,
) {
  return hasMerchantBookingFrontendPermission(
    permissions,
    getMerchantBookingWorkbenchSectionPermission(section),
  );
}

export function canOpenMerchantBookingWorkbenchView(
  permissions: MerchantBookingFrontendPermissions,
  view: MerchantBookingWorkbenchView,
) {
  if (view === "rules") {
    return (
      hasMerchantBookingFrontendPermission(permissions, "bookings.settings.manage") ||
      hasMerchantBookingFrontendPermission(permissions, "bookings.automation.manage")
    );
  }
  if (view === "reminders") {
    return (
      hasMerchantBookingFrontendPermission(permissions, "bookings.automation.manage") ||
      hasMerchantBookingFrontendPermission(permissions, "bookings.calendar.manage")
    );
  }
  return hasMerchantBookingFrontendPermission(
    permissions,
    "bookings.analytics.view",
  );
}

export function canOpenMerchantBookingWorkbench(
  permissions: MerchantBookingFrontendPermissions,
) {
  return (["rules", "reminders", "analysis"] as const).some((view) =>
    canOpenMerchantBookingWorkbenchView(permissions, view),
  );
}

export function getMerchantBookingWorkbenchSectionFingerprint(
  settings: MerchantBookingWorkbenchSettings,
  section: Exclude<MerchantBookingWorkbenchMutationSection, "calendar">,
) {
  if (section === "settings") {
    return JSON.stringify({
      minAdvanceMinutes: settings.minAdvanceMinutes,
      dailyCutoffTime: settings.dailyCutoffTime,
      bufferMinutes: settings.bufferMinutes,
      recurringRules: settings.recurringRules,
      storeColorStyles: settings.storeColorStyles,
      itemColorStyles: settings.itemColorStyles,
    });
  }
  return JSON.stringify({
    customerEmailLocale: settings.customerEmailLocale,
    customerAutoEmailEnabled: settings.customerAutoEmailEnabled,
    customerAutoEmailStatuses: settings.customerAutoEmailStatuses,
    customerAutoEmailMessageByStatus:
      settings.customerAutoEmailMessageByStatus,
    customerEmailSenderName: settings.customerEmailSenderName,
    customerReminderOffsetsMinutes: settings.customerReminderOffsetsMinutes,
    merchantReminderOffsetsMinutes: settings.merchantReminderOffsetsMinutes,
    appointmentAutoStatus: settings.appointmentAutoStatus,
    noShowEnabled: settings.noShowEnabled,
    noShowGraceMinutes: settings.noShowGraceMinutes,
  });
}

export function createMerchantBookingEmployeeWorkbenchDraft(
  settings: MerchantBookingWorkbenchSettings,
  permissions: MerchantBookingFrontendPermissions,
): MerchantBookingWorkbenchSettings {
  const safe: MerchantBookingWorkbenchSettings = {
    minAdvanceMinutes: settings.minAdvanceMinutes,
    dailyCutoffTime: settings.dailyCutoffTime,
    bufferMinutes: settings.bufferMinutes,
    recurringRules: settings.recurringRules,
    storeColorStyles: settings.storeColorStyles,
    itemColorStyles: settings.itemColorStyles,
    customerEmailLocale: "",
    customerAutoEmailEnabled: true,
    customerAutoEmailStatuses: ["confirmed"],
    customerAutoEmailMessageByStatus: {},
    customerEmailSenderName: "",
    customerReminderOffsetsMinutes: [],
    merchantReminderOffsetsMinutes: [],
    appointmentAutoStatus: "",
    noShowEnabled: false,
    noShowGraceMinutes: null,
    calendarSyncToken: "",
    calendarSyncTokenUpdatedAt: "",
  };
  if (
    hasMerchantBookingFrontendPermission(
      permissions,
      "bookings.automation.manage",
    )
  ) {
    Object.assign(safe, {
      customerEmailLocale: settings.customerEmailLocale,
      customerAutoEmailEnabled: settings.customerAutoEmailEnabled,
      customerAutoEmailStatuses: settings.customerAutoEmailStatuses,
      customerAutoEmailMessageByStatus:
        settings.customerAutoEmailMessageByStatus,
      customerEmailSenderName: settings.customerEmailSenderName,
      customerReminderOffsetsMinutes:
        settings.customerReminderOffsetsMinutes,
      merchantReminderOffsetsMinutes:
        settings.merchantReminderOffsetsMinutes,
      appointmentAutoStatus: settings.appointmentAutoStatus,
      noShowEnabled: settings.noShowEnabled,
      noShowGraceMinutes: settings.noShowGraceMinutes,
    });
  }
  if (
    hasMerchantBookingFrontendPermission(
      permissions,
      "bookings.calendar.manage",
    )
  ) {
    safe.calendarSyncTokenUpdatedAt = settings.calendarSyncTokenUpdatedAt;
  }
  return safe;
}

export function createMerchantBookingApiRequest(input: {
  apiClient?: MerchantBusinessApiClient;
  employeeMode: boolean;
  ownerFetch: MerchantBusinessApiClient;
}): MerchantBusinessApiClient {
  return (path, init) => {
    if (input.apiClient) return input.apiClient(path, init);
    if (input.employeeMode) {
      return Promise.reject(new Error("employee_booking_api_client_required"));
    }
    return input.ownerFetch(path, init);
  };
}
