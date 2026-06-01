import {
  normalizeMerchantMembershipSettings,
  type MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";

const MERCHANT_MEMBERSHIP_SETTINGS_SLUG_PREFIX = "__merchant_membership_settings__:";

export type MerchantMembershipSettingsStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

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

  if (error) return [];
  return Array.isArray(data) ? data : [];
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
  },
): Promise<{ error: string | null }> {
  const normalizedSiteId = normalizeText(input.siteId);
  if (!normalizedSiteId) return { error: "invalid_site_id" };
  const slug = buildSettingsSlug(normalizedSiteId);
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const settings = normalizeMerchantMembershipSettings(normalizedSiteId, {
    ...input.settings,
    siteId: normalizedSiteId,
    updatedAt,
  });
  const existing = (await queryStoredSettingsRows(supabase, normalizedSiteId))[0];

  const updateExisting = async (body: Record<string, unknown>) => {
    if (existing?.id === undefined || existing?.id === null) return { error: "missing_existing_id" };
    const updated = await supabase.from("pages").update(body).eq("id", existing.id);
    return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
  };

  const insertNew = async (body: Record<string, unknown>) => {
    const inserted = await supabase.from("pages").insert({
      ...body,
      slug,
      merchant_id: normalizedSiteId,
    });
    const error = inserted.error ? toErrorMessage(inserted.error) : null;
    if (!error || !isMissingMerchantIdColumn(error)) return { error };
    const retry = await supabase.from("pages").insert({
      ...body,
      slug,
    });
    return retry.error ? { error: toErrorMessage(retry.error) } : { error: null };
  };

  const basePayload = {
    blocks: settings,
    updated_at: updatedAt,
  };
  const first = existing ? await updateExisting(basePayload) : await insertNew(basePayload);
  if (!first.error) return first;
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return existing ? updateExisting({ blocks: settings }) : insertNew({ blocks: settings });
}
