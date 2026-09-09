import {
  normalizeMerchantMembershipSettings,
  type MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";
import { commitMerchantRedemptionTransaction } from "@/lib/merchantRedemptionTransaction.server";
import type { MerchantTransactionClient } from "@/lib/merchantOrderMembershipTransaction.server";

const MERCHANT_MEMBERSHIP_SETTINGS_SLUG_PREFIX = "__merchant_membership_settings__:";

export type MerchantMembershipSettingsStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
} & MerchantTransactionClient;

type StoredMerchantMembershipSettingsRow = {
  id?: string | number | null;
  slug?: unknown;
  blocks?: unknown;
  updated_at?: unknown;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "unknown_error";
  const message = (input as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "unknown_error";
}

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingMerchantIdColumn(message: string) {
  return (
    /column\s+pages\.merchant_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]merchant_id['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingUpdatedAtColumn(message: string) {
  return (
    /column\s+pages\.updated_at\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]updated_at['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function buildSettingsSlug(siteId: string) {
  return `${MERCHANT_MEMBERSHIP_SETTINGS_SLUG_PREFIX}${siteId}`;
}

async function queryStoredSettingsRows(supabase: MerchantMembershipSettingsStoreClient, siteId: string) {
  const normalizedSiteId = normalizeText(siteId);
  if (!normalizedSiteId) return [] as StoredMerchantMembershipSettingsRow[];
  const slug = buildSettingsSlug(normalizedSiteId);

  const initial = await supabase
    .from("pages")
    .select("id,slug,blocks,updated_at")
    .eq("merchant_id", normalizedSiteId)
    .eq("slug", slug);

  let data = (initial.data ?? []) as StoredMerchantMembershipSettingsRow[];
  let error = initial.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const retry = await supabase.from("pages").select("id,slug,blocks,updated_at").eq("slug", slug);
      data = (retry.data ?? []) as StoredMerchantMembershipSettingsRow[];
      error = retry.error;
    } else if (isMissingSlugColumn(message)) {
      return [];
    } else if (isMissingUpdatedAtColumn(message)) {
      const retry = await supabase
        .from("pages")
        .select("id,slug,blocks")
        .eq("merchant_id", normalizedSiteId)
        .eq("slug", slug);
      data = (retry.data ?? []) as StoredMerchantMembershipSettingsRow[];
      error = retry.error;
    }
  }

  if (!error && data.length === 0) {
    const retry = await supabase.from("pages").select("id,slug,blocks,updated_at").eq("slug", slug);
    data = (retry.data ?? []) as StoredMerchantMembershipSettingsRow[];
    error = retry.error;
    if (error && isMissingUpdatedAtColumn(toErrorMessage(error))) {
      const retryWithoutUpdatedAt = await supabase.from("pages").select("id,slug,blocks").eq("slug", slug);
      data = (retryWithoutUpdatedAt.data ?? []) as StoredMerchantMembershipSettingsRow[];
      error = retryWithoutUpdatedAt.error;
    }
  }

  if (error) throw new Error(`merchant_membership_settings_read_failed:${toErrorMessage(error)}`);
  if (!Array.isArray(data)) throw new Error("merchant_membership_settings_read_failed:invalid_rows");
  return data;
}

export async function loadStoredMerchantMembershipSettings(
  supabase: MerchantMembershipSettingsStoreClient,
  siteId: string,
): Promise<MerchantMembershipSettings | null> {
  const normalizedSiteId = normalizeText(siteId);
  if (!normalizedSiteId) return null;
  const rows = await queryStoredSettingsRows(supabase, normalizedSiteId);
  const row = rows.find((item) => normalizeText(item.slug) === buildSettingsSlug(normalizedSiteId)) ?? rows[0];
  if (!row) return null;
  const settings = normalizeMerchantMembershipSettings(normalizedSiteId, row.blocks);
  return {
    ...settings,
    updatedAt: normalizeText(row.updated_at) || settings.updatedAt,
  };
}

export async function saveStoredMerchantMembershipSettings(
  supabase: MerchantMembershipSettingsStoreClient,
  input: {
    siteId: string;
    settings: MerchantMembershipSettings;
    updatedAt?: string | null;
    expectedUpdatedAt?: string | null;
    view?: unknown;
  },
): Promise<{ error: string | null; updatedAt?: string | null }> {
  const normalizedSiteId = normalizeText(input.siteId);
  if (!normalizedSiteId) return { error: "invalid_site_id" };
  if (!Object.prototype.hasOwnProperty.call(input, "expectedUpdatedAt") ||
    (input.expectedUpdatedAt !== null && typeof input.expectedUpdatedAt !== "string")) {
    return { error: "merchant_membership_settings_conflict" };
  }
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const settings = normalizeMerchantMembershipSettings(normalizedSiteId, {
    ...input.settings,
    siteId: normalizedSiteId,
    updatedAt,
  });
  const committed = await commitMerchantRedemptionTransaction(supabase, normalizedSiteId, {
    settings: { expectedUpdatedAt: input.expectedUpdatedAt, next: settings },
  });
  if (committed.error) return { error: committed.error };
  return { error: null, updatedAt: committed.versions?.settings ?? null };
}
