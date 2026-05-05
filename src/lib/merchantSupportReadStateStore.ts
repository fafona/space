import {
  MERCHANT_SUPPORT_READ_STATE_SLUG,
  buildMerchantSupportReadStateBlocks,
  normalizeMerchantSupportReadStatePayload,
  readMerchantSupportReadStateFromBlocks,
  type MerchantSupportReadStatePayload,
} from "@/lib/merchantSupportReadState";

type StoreErrorLike = { message?: string } | null;

type MerchantSupportReadStateQueryBuilder = PromiseLike<{ data?: unknown; error: StoreErrorLike }> & {
  select: (columns: string) => MerchantSupportReadStateQueryBuilder;
  update: (payload: Record<string, unknown>) => MerchantSupportReadStateQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: StoreErrorLike }>;
  is: (column: string, value: unknown) => MerchantSupportReadStateQueryBuilder;
  eq: (column: string, value: unknown) => MerchantSupportReadStateQueryBuilder;
  limit: (value: number) => MerchantSupportReadStateQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: StoreErrorLike }>;
};

export type MerchantSupportReadStateStoreClient = {
  from: (table: string) => MerchantSupportReadStateQueryBuilder;
};

const MERCHANT_SUPPORT_READ_STATE_CACHE_TTL_MS = 2_000;
let merchantSupportReadStateCache:
  | {
      expiresAt: number;
      value: MerchantSupportReadStatePayload;
    }
  | null = null;

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

export async function loadStoredMerchantSupportReadState(
  supabase: MerchantSupportReadStateStoreClient,
): Promise<MerchantSupportReadStatePayload> {
  if (merchantSupportReadStateCache && merchantSupportReadStateCache.expiresAt > Date.now()) {
    return merchantSupportReadStateCache.value;
  }

  const initialQuery = await supabase
    .from("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", MERCHANT_SUPPORT_READ_STATE_SLUG)
    .limit(1)
    .maybeSingle();

  let data = initialQuery.data as { blocks?: unknown } | null;
  let error = initialQuery.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const bySlug = await supabase
        .from("pages")
        .select("blocks")
        .eq("slug", MERCHANT_SUPPORT_READ_STATE_SLUG)
        .limit(1)
        .maybeSingle();
      data = bySlug.data as { blocks?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return { accounts: [] };
    } else {
      return { accounts: [] };
    }
  }

  if (error) return { accounts: [] };
  const payload = readMerchantSupportReadStateFromBlocks(data?.blocks);
  merchantSupportReadStateCache = {
    expiresAt: Date.now() + MERCHANT_SUPPORT_READ_STATE_CACHE_TTL_MS,
    value: payload,
  };
  return payload;
}

export async function saveMerchantSupportReadState(
  supabase: MerchantSupportReadStateStoreClient,
  payload: MerchantSupportReadStatePayload,
): Promise<{ error: string | null }> {
  const normalizedPayload = normalizeMerchantSupportReadStatePayload(payload);
  const blocks = buildMerchantSupportReadStateBlocks(normalizedPayload);
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .is("merchant_id", null)
      .eq("slug", MERCHANT_SUPPORT_READ_STATE_SLUG)
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
      const bySlug = await supabase
        .from("pages")
        .select("id")
        .eq("slug", MERCHANT_SUPPORT_READ_STATE_SLUG)
        .limit(1)
        .maybeSingle();
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

  const recordId = existing.record?.id;
  const payloadWithoutUpdatedAt = { blocks };
  const updatePayload = async (body: Record<string, unknown>) => {
    if (recordId !== undefined && recordId !== null) {
      const updated = await supabase.from("pages").update(body).eq("id", recordId);
      return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
    }

    if (existing.supportsSlug) {
      const inserted = await supabase.from("pages").insert({
        ...body,
        slug: MERCHANT_SUPPORT_READ_STATE_SLUG,
        ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }

    return { error: "pages_slug_column_missing" };
  };

  const first = await updatePayload(basePayload);
  if (!first.error) {
    merchantSupportReadStateCache = {
      expiresAt: Date.now() + MERCHANT_SUPPORT_READ_STATE_CACHE_TTL_MS,
      value: normalizedPayload,
    };
    return { error: null };
  }
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  const fallback = await updatePayload(payloadWithoutUpdatedAt);
  if (!fallback.error) {
    merchantSupportReadStateCache = {
      expiresAt: Date.now() + MERCHANT_SUPPORT_READ_STATE_CACHE_TTL_MS,
      value: normalizedPayload,
    };
  }
  return fallback;
}
