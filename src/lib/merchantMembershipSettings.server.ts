import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  createEmptyMerchantMembershipSettings,
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
}): Promise<MerchantMembershipSettings> {
  const normalizedSiteId = trimText(input.siteId, 64);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  const supabase = requireMembershipSettingsStoreClient();
  const now = new Date().toISOString();
  const settings = normalizeMerchantMembershipSettings(normalizedSiteId, {
    ...((input.settings && typeof input.settings === "object" && !Array.isArray(input.settings)
      ? input.settings
      : {}) as Record<string, unknown>),
    siteId: normalizedSiteId,
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
