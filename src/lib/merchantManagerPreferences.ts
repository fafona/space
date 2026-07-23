import {
  normalizeMerchantBookingManagerPreferences,
  type MerchantBookingManagerPreferences,
} from "@/lib/merchantBookingManagerPreferences";
import {
  normalizeMerchantOrderManagerPreferences,
  type MerchantOrderManagerPreferences,
} from "@/lib/merchantOrderManagerPreferences";

export type MerchantManagerPreferenceKind = "booking" | "order";

export type MerchantManagerPreferencesSnapshot = {
  version: 1;
  siteId: string;
  booking: MerchantBookingManagerPreferences | null;
  order: MerchantOrderManagerPreferences | null;
  updatedAt: string;
};

export type MerchantManagerPreferencesStoredState = {
  booking: boolean;
  order: boolean;
};

function normalizeText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasStoredPreference(value: Record<string, unknown>, key: MerchantManagerPreferenceKind) {
  return Object.prototype.hasOwnProperty.call(value, key) && isPlainObject(value[key]);
}

export function createEmptyMerchantManagerPreferencesSnapshot(
  siteId: string,
): MerchantManagerPreferencesSnapshot {
  return {
    version: 1,
    siteId: normalizeText(siteId, 64),
    booking: null,
    order: null,
    updatedAt: "",
  };
}

export function normalizeMerchantManagerPreferencesSnapshot(
  siteId: string,
  value: unknown,
): MerchantManagerPreferencesSnapshot {
  const normalizedSiteId = normalizeText(siteId, 64);
  const input = isPlainObject(value) ? value : {};
  return {
    version: 1,
    siteId: normalizedSiteId,
    booking: hasStoredPreference(input, "booking")
      ? normalizeMerchantBookingManagerPreferences(input.booking)
      : null,
    order: hasStoredPreference(input, "order")
      ? normalizeMerchantOrderManagerPreferences(input.order)
      : null,
    updatedAt: normalizeText(input.updatedAt, 128),
  };
}

export function parseStoredMerchantManagerPreferencesSnapshot(
  siteId: string,
  value: unknown,
): MerchantManagerPreferencesSnapshot | null {
  if (!isPlainObject(value)) return null;
  const storedSiteId = normalizeText(value.siteId, 64);
  const normalizedSiteId = normalizeText(siteId, 64);
  if (storedSiteId && storedSiteId !== normalizedSiteId) return null;
  if (!hasStoredPreference(value, "booking") && !hasStoredPreference(value, "order")) return null;
  return normalizeMerchantManagerPreferencesSnapshot(normalizedSiteId, value);
}

export function getMerchantManagerPreferencesStoredState(
  snapshot: MerchantManagerPreferencesSnapshot,
): MerchantManagerPreferencesStoredState {
  return {
    booking: snapshot.booking !== null,
    order: snapshot.order !== null,
  };
}

export function updateMerchantManagerPreferencesSnapshot(
  current: MerchantManagerPreferencesSnapshot | null,
  input:
    | {
        siteId: string;
        kind: "booking";
        preferences: unknown;
        updatedAt?: string;
      }
    | {
        siteId: string;
        kind: "order";
        preferences: unknown;
        updatedAt?: string;
      },
): MerchantManagerPreferencesSnapshot {
  const siteId = normalizeText(input.siteId, 64);
  const base = current
    ? normalizeMerchantManagerPreferencesSnapshot(siteId, current)
    : createEmptyMerchantManagerPreferencesSnapshot(siteId);
  const updatedAt = normalizeText(input.updatedAt, 128) || new Date().toISOString();
  if (input.kind === "booking") {
    return {
      ...base,
      booking: normalizeMerchantBookingManagerPreferences(input.preferences),
      updatedAt,
    };
  }
  return {
    ...base,
    order: normalizeMerchantOrderManagerPreferences(input.preferences),
    updatedAt,
  };
}
