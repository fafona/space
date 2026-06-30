import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  createEmptyMerchantMembershipSettings,
  type MerchantMemberSettingsView,
  normalizeMerchantMembershipSettings,
  type MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";
import {
  loadStoredMerchantMembershipSettings,
  saveStoredMerchantMembershipSettings,
} from "@/lib/merchantMembershipSettingsStore";

function requireMembershipSettingsStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    throw new Error("membership_settings_store_unavailable");
  }
  return supabase;
}

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeSettingsView(value: unknown): MerchantMemberSettingsView | "" {
  const text = trimText(value, 64);
  return text === "list" ||
    text === "rechargePlans" ||
    text === "redemptionCategories" ||
    text === "redemptionItems" ||
    text === "levels" ||
    text === "pointsRules"
    ? text
    : "";
}

function mergeSettingsWithExisting(
  incoming: MerchantMembershipSettings,
  existing: MerchantMembershipSettings,
  view: MerchantMemberSettingsView | "",
): MerchantMembershipSettings {
  if (!existing.redemptionItems.length && !existing.redemptionCategories.length) return incoming;
  return {
    ...incoming,
    redemptionItems:
      view !== "redemptionItems" && incoming.redemptionItems.length === 0 && existing.redemptionItems.length > 0
        ? existing.redemptionItems
        : incoming.redemptionItems,
    redemptionCategories:
      view !== "redemptionCategories" &&
      incoming.redemptionCategories.length === 0 &&
      existing.redemptionCategories.length > 0
        ? existing.redemptionCategories
        : incoming.redemptionCategories,
  };
}

export async function getMerchantMembershipSettings(siteId: string): Promise<MerchantMembershipSettings> {
  const normalizedSiteId = trimText(siteId, 64);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  const supabase = requireMembershipSettingsStoreClient();
  const stored = await loadStoredMerchantMembershipSettings(supabase, normalizedSiteId);
  return stored ?? createEmptyMerchantMembershipSettings(normalizedSiteId);
}

export function buildRedemptionCashierSettings(settings: MerchantMembershipSettings): MerchantMembershipSettings {
  return {
    ...settings,
    rechargePlans: settings.rechargePlans.filter((plan) => plan.enabled),
    redemptionCategories: settings.redemptionCategories
      .filter((category) => category.enabled)
      .map((category) => ({
        id: category.id,
        name: category.name,
        iconName: category.iconName,
        enabled: category.enabled,
        sort: category.sort,
      })),
    redemptionItems: settings.redemptionItems
      .filter((item) => item.enabled)
      .map((item) => ({
        id: item.id,
        categoryId: item.categoryId,
        code: item.code,
        barcode: item.barcode,
        name: item.name,
        imageUrl: item.imageUrl,
        iconName: item.iconName,
        description: item.description,
        enabled: item.enabled,
        pointsCost: item.pointsCost,
        referenceAmount: item.referenceAmount,
        memberPrice: item.memberPrice,
        taxRate: item.taxRate,
        stock: item.stock,
        pointProduct: item.pointProduct,
        recommended: item.recommended,
        sort: item.sort,
      })),
    levels: settings.levels
      .filter((level) => level.enabled)
      .map((level) => ({
        ...level,
        benefit: {
          ...level.benefit,
          pointDiscount: level.benefit.pointDiscount,
        },
      })),
  };
}

export async function updateMerchantMembershipSettings(input: {
  siteId: string;
  settings: unknown;
  view?: unknown;
}): Promise<MerchantMembershipSettings> {
  const normalizedSiteId = trimText(input.siteId, 64);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  const supabase = requireMembershipSettingsStoreClient();
  const now = new Date().toISOString();
  const existing =
    (await loadStoredMerchantMembershipSettings(supabase, normalizedSiteId)) ??
    createEmptyMerchantMembershipSettings(normalizedSiteId);
  const incomingSettings = normalizeMerchantMembershipSettings(normalizedSiteId, {
    ...((input.settings && typeof input.settings === "object" && !Array.isArray(input.settings)
      ? input.settings
      : {}) as Record<string, unknown>),
    siteId: normalizedSiteId,
    updatedAt: now,
  });
  const settings = normalizeMerchantMembershipSettings(
    normalizedSiteId,
    mergeSettingsWithExisting(incomingSettings, existing, normalizeSettingsView(input.view)),
  );
  const saved = await saveStoredMerchantMembershipSettings(supabase, {
    siteId: normalizedSiteId,
    settings,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  return settings;
}

export async function updateMerchantMembershipPrintSettings(input: {
  siteId: string;
  printSettings: unknown;
}): Promise<MerchantMembershipSettings> {
  const normalizedSiteId = trimText(input.siteId, 64);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  const supabase = requireMembershipSettingsStoreClient();
  const now = new Date().toISOString();
  const current =
    (await loadStoredMerchantMembershipSettings(supabase, normalizedSiteId)) ??
    createEmptyMerchantMembershipSettings(normalizedSiteId);
  const incomingPrintSettings =
    input.printSettings && typeof input.printSettings === "object" && !Array.isArray(input.printSettings)
      ? (input.printSettings as Record<string, unknown>)
      : {};
  const settings = normalizeMerchantMembershipSettings(normalizedSiteId, {
    ...current,
    siteId: normalizedSiteId,
    printSettings: {
      ...current.printSettings,
      ...incomingPrintSettings,
    },
    updatedAt: now,
  });
  const saved = await saveStoredMerchantMembershipSettings(supabase, {
    siteId: normalizedSiteId,
    settings,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  return settings;
}
