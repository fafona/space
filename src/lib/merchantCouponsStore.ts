import { normalizeMerchantCouponRecords, type MerchantCouponRecord } from "@/lib/merchantCoupons";

const MERCHANT_COUPON_SLUG_PREFIX = "__merchant_coupons__:";

export type MerchantCouponsStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type StoredMerchantCoupons = {
  siteId: string;
  coupons: MerchantCouponRecord[];
  updatedAt: string | null;
};

type StoredMerchantCouponsRow = {
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

function buildCouponsSlug(siteId: string) {
  return `${MERCHANT_COUPON_SLUG_PREFIX}${siteId}`;
}

async function queryStoredCouponRows(supabase: MerchantCouponsStoreClient, siteId: string) {
  const normalizedSiteId = normalizeText(siteId);
  if (!normalizedSiteId) return [] as StoredMerchantCouponsRow[];
  const slug = buildCouponsSlug(normalizedSiteId);

  const initial = await supabase
    .from("pages")
    .select("id,slug,blocks,updated_at")
    .eq("merchant_id", normalizedSiteId)
    .eq("slug", slug);

  let data = (initial.data ?? []) as StoredMerchantCouponsRow[];
  let error = initial.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const retry = await supabase.from("pages").select("id,slug,blocks,updated_at").eq("slug", slug);
      data = (retry.data ?? []) as StoredMerchantCouponsRow[];
      error = retry.error;
    } else if (isMissingSlugColumn(message)) {
      return [];
    } else if (isMissingUpdatedAtColumn(message)) {
      const retry = await supabase
        .from("pages")
        .select("id,slug,blocks")
        .eq("merchant_id", normalizedSiteId)
        .eq("slug", slug);
      data = (retry.data ?? []) as StoredMerchantCouponsRow[];
      error = retry.error;
    }
  }

  if (error) return [];
  return Array.isArray(data) ? data : [];
}

export function mergeStoredMerchantCouponRows(siteId: string, rows: StoredMerchantCouponsRow[]): StoredMerchantCoupons | null {
  const normalizedSiteId = normalizeText(siteId);
  if (!normalizedSiteId || !Array.isArray(rows) || rows.length === 0) return null;
  const slug = buildCouponsSlug(normalizedSiteId);
  const matchedRows = rows.filter((row) => normalizeText(row.slug) === slug || !normalizeText(row.slug));
  if (matchedRows.length === 0) return null;

  const couponMap = new Map<string, MerchantCouponRecord>();
  matchedRows.forEach((row) => {
    normalizeMerchantCouponRecords(row.blocks).forEach((coupon) => {
      if (coupon.siteId !== normalizedSiteId) return;
      const existing = couponMap.get(coupon.id);
      if (!existing || Date.parse(coupon.updatedAt) >= Date.parse(existing.updatedAt)) {
        couponMap.set(coupon.id, coupon);
      }
    });
  });

  const updatedAt = matchedRows.reduce<string | null>((latest, row) => {
    const current = normalizeText(row.updated_at);
    if (!current) return latest;
    if (!latest) return current;
    return Date.parse(current) > Date.parse(latest) ? current : latest;
  }, null);

  return {
    siteId: normalizedSiteId,
    coupons: normalizeMerchantCouponRecords(Array.from(couponMap.values())),
    updatedAt,
  };
}

export async function loadStoredMerchantCoupons(
  supabase: MerchantCouponsStoreClient,
  siteId: string,
): Promise<StoredMerchantCoupons | null> {
  const normalizedSiteId = normalizeText(siteId);
  if (!normalizedSiteId) return null;
  const rows = await queryStoredCouponRows(supabase, normalizedSiteId);
  return mergeStoredMerchantCouponRows(normalizedSiteId, rows);
}

export async function saveStoredMerchantCoupons(
  supabase: MerchantCouponsStoreClient,
  input: {
    siteId: string;
    coupons: MerchantCouponRecord[];
    updatedAt?: string | null;
  },
): Promise<{ error: string | null }> {
  const normalizedSiteId = normalizeText(input.siteId);
  if (!normalizedSiteId) return { error: "invalid_site_id" };
  const slug = buildCouponsSlug(normalizedSiteId);
  const coupons = normalizeMerchantCouponRecords(input.coupons).filter((coupon) => coupon.siteId === normalizedSiteId);
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const existing = (await queryStoredCouponRows(supabase, normalizedSiteId))[0];

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
    blocks: coupons,
    updated_at: updatedAt,
  };
  const first = existing ? await updateExisting(basePayload) : await insertNew(basePayload);
  if (!first.error) return first;
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return existing ? updateExisting({ blocks: coupons }) : insertNew({ blocks: coupons });
}
