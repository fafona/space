import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  createEmptyMerchantMembershipSettings,
  mergeMerchantMembershipSettingsForView,
  releaseMerchantRedemptionStock,
  reserveMerchantRedemptionStock,
  type MerchantMemberSettingsView,
  type MerchantRedemptionStockDelta,
  normalizeMerchantMembershipSettings,
  type MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";
import {
  loadStoredMerchantMembershipSettings,
  saveStoredMerchantMembershipSettings,
} from "@/lib/merchantMembershipSettingsStore";
import { buildMutationOperationMarker } from "@/lib/mutationOperationId";

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
    redemptionStockOperationIds: [],
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
  expectedUpdatedAt?: unknown;
}): Promise<MerchantMembershipSettings> {
  const normalizedSiteId = trimText(input.siteId, 64);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  const supabase = requireMembershipSettingsStoreClient();
  const now = new Date().toISOString();
  const existing =
    (await loadStoredMerchantMembershipSettings(supabase, normalizedSiteId)) ??
    createEmptyMerchantMembershipSettings(normalizedSiteId);
  const hasExpectedUpdatedAt = Object.prototype.hasOwnProperty.call(input, "expectedUpdatedAt");
  const expectedUpdatedAt = trimText(input.expectedUpdatedAt, 128);
  if (hasExpectedUpdatedAt && expectedUpdatedAt !== trimText(existing.updatedAt, 128)) {
    throw new Error("merchant_membership_settings_conflict");
  }
  const incomingSettings = normalizeMerchantMembershipSettings(normalizedSiteId, {
    ...((input.settings && typeof input.settings === "object" && !Array.isArray(input.settings)
      ? input.settings
      : {}) as Record<string, unknown>),
    siteId: normalizedSiteId,
    updatedAt: now,
  });
  const settings = normalizeMerchantMembershipSettings(
    normalizedSiteId,
    mergeMerchantMembershipSettingsForView(incomingSettings, existing, normalizeSettingsView(input.view)),
  );
  const saved = await saveStoredMerchantMembershipSettings(supabase, {
    siteId: normalizedSiteId,
    settings,
    updatedAt: now,
    ...(hasExpectedUpdatedAt ? { expectedUpdatedAt: existing.updatedAt } : {}),
    view: normalizeSettingsView(input.view) || "membership-settings",
  });
  if (saved.error) throw new Error(saved.error);
  return settings;
}

export async function reserveMerchantMembershipRedemptionStock(input: {
  siteId: string;
  operationId: unknown;
  deltas: readonly MerchantRedemptionStockDelta[];
  expectedUpdatedAt?: string | null;
}): Promise<MerchantMembershipSettings> {
  const normalizedSiteId = trimText(input.siteId, 64);
  const operationMarker = buildMutationOperationMarker("member-redemption-stock", input.operationId);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  if (!operationMarker) throw new Error("mutation_operation_id_required");
  const supabase = requireMembershipSettingsStoreClient();
  const stored = await loadStoredMerchantMembershipSettings(supabase, normalizedSiteId);
  const current = stored ?? createEmptyMerchantMembershipSettings(normalizedSiteId);
  if (
    input.expectedUpdatedAt !== undefined &&
    trimText(input.expectedUpdatedAt, 128) !== trimText(current.updatedAt, 128)
  ) {
    throw new Error("merchant_membership_settings_conflict");
  }
  const reservation = reserveMerchantRedemptionStock({
    settings: current,
    operationId: operationMarker,
    deltas: input.deltas,
  });
  if (reservation.alreadyApplied || input.deltas.length === 0) return current;
  const now = new Date().toISOString();
  const settings = { ...reservation.settings, updatedAt: now };
  const saved = await saveStoredMerchantMembershipSettings(supabase, {
    siteId: normalizedSiteId,
    settings,
    updatedAt: now,
    expectedUpdatedAt: stored?.updatedAt ?? null,
    view: "redemption-stock-reserve",
  });
  if (saved.error) throw new Error(saved.error);
  return settings;
}

export async function releaseMerchantMembershipRedemptionStock(input: {
  siteId: string;
  operationId: unknown;
  deltas: readonly MerchantRedemptionStockDelta[];
}): Promise<MerchantMembershipSettings> {
  const normalizedSiteId = trimText(input.siteId, 64);
  const operationMarker = buildMutationOperationMarker("member-redemption-stock", input.operationId);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  if (!operationMarker) throw new Error("mutation_operation_id_required");
  const supabase = requireMembershipSettingsStoreClient();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await loadStoredMerchantMembershipSettings(supabase, normalizedSiteId);
    const current = stored ?? createEmptyMerchantMembershipSettings(normalizedSiteId);
    const release = releaseMerchantRedemptionStock({
      settings: current,
      operationId: operationMarker,
      deltas: input.deltas,
    });
    if (release.alreadyReleased) return current;
    const now = new Date().toISOString();
    const settings = { ...release.settings, updatedAt: now };
    const saved = await saveStoredMerchantMembershipSettings(supabase, {
      siteId: normalizedSiteId,
      settings,
      updatedAt: now,
      expectedUpdatedAt: stored?.updatedAt ?? null,
      view: "redemption-stock-release",
    });
    if (!saved.error) return settings;
    if (saved.error !== "merchant_membership_settings_conflict" || attempt >= 2) throw new Error(saved.error);
  }
  throw new Error("merchant_membership_settings_conflict");
}

export async function updateMerchantMembershipPrintSettings(input: {
  siteId: string;
  printSettings: unknown;
}): Promise<MerchantMembershipSettings> {
  const normalizedSiteId = trimText(input.siteId, 64);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  const supabase = requireMembershipSettingsStoreClient();
  const now = new Date().toISOString();
  const incomingPrintSettings =
    input.printSettings && typeof input.printSettings === "object" && !Array.isArray(input.printSettings)
      ? (input.printSettings as Record<string, unknown>)
      : {};
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current =
      (await loadStoredMerchantMembershipSettings(supabase, normalizedSiteId)) ??
      createEmptyMerchantMembershipSettings(normalizedSiteId);
    const updatedAt = attempt === 0 ? now : new Date().toISOString();
    const settings = normalizeMerchantMembershipSettings(normalizedSiteId, {
      ...current,
      siteId: normalizedSiteId,
      printSettings: {
        ...current.printSettings,
        ...incomingPrintSettings,
      },
      updatedAt,
    });
    const saved = await saveStoredMerchantMembershipSettings(supabase, {
      siteId: normalizedSiteId,
      settings,
      updatedAt,
      expectedUpdatedAt: current.updatedAt,
      view: "print-settings",
    });
    if (!saved.error) return settings;
    if (saved.error !== "merchant_membership_settings_conflict" || attempt >= 2) throw new Error(saved.error);
  }
  throw new Error("merchant_membership_settings_conflict");
}
