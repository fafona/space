import { normalizeMerchantOrderRecords, type MerchantOrderRecord } from "@/lib/merchantOrders";

const MERCHANT_ORDER_SLUG_PREFIX = "__merchant_orders__:";

export type MerchantOrdersStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type StoredMerchantOrders = {
  siteId: string;
  orders: MerchantOrderRecord[];
  updatedAt: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSiteId(value: unknown) {
  return normalizeText(value);
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

function buildOrdersSlug(siteId: string) {
  return `${MERCHANT_ORDER_SLUG_PREFIX}${siteId}`;
}

export async function loadStoredMerchantOrders(
  supabase: MerchantOrdersStoreClient,
  siteId: string,
): Promise<StoredMerchantOrders | null> {
  const normalizedSiteId = normalizeSiteId(siteId);
  if (!normalizedSiteId) return null;
  const slug = buildOrdersSlug(normalizedSiteId);

  const initialQuery = await supabase
    .from("pages")
    .select("blocks,updated_at")
    .eq("merchant_id", normalizedSiteId)
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();

  let data = initialQuery.data as { blocks?: unknown; updated_at?: unknown } | null;
  let error = initialQuery.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const bySlug = await supabase.from("pages").select("blocks,updated_at").eq("slug", slug).limit(1).maybeSingle();
      data = bySlug.data as { blocks?: unknown; updated_at?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return null;
    } else {
      return null;
    }
  }

  if (error || !data) return null;
  return {
    siteId: normalizedSiteId,
    orders: normalizeMerchantOrderRecords(data.blocks),
    updatedAt: typeof data?.updated_at === "string" ? data.updated_at.trim() : null,
  };
}

export async function saveStoredMerchantOrders(
  supabase: MerchantOrdersStoreClient,
  input: {
    siteId: string;
    orders: MerchantOrderRecord[];
    updatedAt?: string | null;
  },
): Promise<{ error: string | null }> {
  const normalizedSiteId = normalizeSiteId(input.siteId);
  if (!normalizedSiteId) return { error: "invalid_site_id" };
  const slug = buildOrdersSlug(normalizedSiteId);
  const normalizedOrders = normalizeMerchantOrderRecords(input.orders);
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const basePayload = {
    blocks: normalizedOrders,
    updated_at: updatedAt,
  };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .eq("merchant_id", normalizedSiteId)
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();
    if (!scoped.error) {
      return {
        record: (scoped.data ?? null) as { id?: string | number | null } | null,
        supportsSlug: true,
        supportsMerchantId: true,
      };
    }

    const scopedMessage = toErrorMessage(scoped.error);
    if (isMissingMerchantIdColumn(scopedMessage)) {
      const bySlug = await supabase.from("pages").select("id").eq("slug", slug).limit(1).maybeSingle();
      if (!bySlug.error) {
        return {
          record: (bySlug.data ?? null) as { id?: string | number | null } | null,
          supportsSlug: true,
          supportsMerchantId: false,
        };
      }
      return { error: toErrorMessage(bySlug.error) };
    }

    if (isMissingSlugColumn(scopedMessage)) {
      return { error: "pages_slug_column_missing" };
    }

    return { error: scopedMessage };
  };

  const existing = await queryExisting();
  if ("error" in existing && existing.error) {
    return { error: existing.error };
  }

  const updatePayload = async (body: Record<string, unknown>) => {
    const recordId = existing.record?.id;
    if (recordId !== undefined && recordId !== null) {
      const updated = await supabase.from("pages").update(body).eq("id", recordId);
      return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
    }

    if (existing.supportsSlug) {
      const inserted = await supabase.from("pages").insert({
        ...body,
        slug,
        ...(existing.supportsMerchantId ? { merchant_id: normalizedSiteId } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }

    return { error: "pages_slug_column_missing" };
  };

  const first = await updatePayload(basePayload);
  if (!first.error) return { error: null };
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return updatePayload({ blocks: normalizedOrders });
}
