import {
  MERCHANT_PUSH_SUBSCRIPTIONS_PAGE_SLUG,
  createEmptyMerchantPushSubscriptionPayload,
  normalizeMerchantPushSubscriptionPayload,
  type MerchantPushSubscriptionPayload,
} from "@/lib/merchantPushSubscriptions";

type StoreErrorLike = { message?: string } | null;

type PushQueryBuilder = PromiseLike<{ data?: unknown; error: StoreErrorLike }> & {
  select: (columns: string) => PushQueryBuilder;
  update: (payload: Record<string, unknown>) => PushQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: StoreErrorLike }>;
  is: (column: string, value: unknown) => PushQueryBuilder;
  eq: (column: string, value: unknown) => PushQueryBuilder;
  limit: (value: number) => PushQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: StoreErrorLike }>;
};

export type MerchantPushSubscriptionStoreClient = {
  from: (table: string) => PushQueryBuilder;
};

const MERCHANT_PUSH_SUBSCRIPTION_CACHE_TTL_MS = 8_000;
let merchantPushSubscriptionCache:
  | {
      expiresAt: number;
      value: MerchantPushSubscriptionPayload;
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

export async function loadStoredMerchantPushSubscriptions(
  supabase: MerchantPushSubscriptionStoreClient,
): Promise<MerchantPushSubscriptionPayload> {
  if (merchantPushSubscriptionCache && merchantPushSubscriptionCache.expiresAt > Date.now()) {
    return merchantPushSubscriptionCache.value;
  }

  const initialQuery = await supabase
    .from("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", MERCHANT_PUSH_SUBSCRIPTIONS_PAGE_SLUG)
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
        .eq("slug", MERCHANT_PUSH_SUBSCRIPTIONS_PAGE_SLUG)
        .limit(1)
        .maybeSingle();
      data = bySlug.data as { blocks?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return createEmptyMerchantPushSubscriptionPayload();
    } else {
      return createEmptyMerchantPushSubscriptionPayload();
    }
  }

  if (error) return createEmptyMerchantPushSubscriptionPayload();
  const payload = normalizeMerchantPushSubscriptionPayload(data?.blocks);
  merchantPushSubscriptionCache = {
    expiresAt: Date.now() + MERCHANT_PUSH_SUBSCRIPTION_CACHE_TTL_MS,
    value: payload,
  };
  return payload;
}

export async function saveStoredMerchantPushSubscriptions(
  supabase: MerchantPushSubscriptionStoreClient,
  payload: MerchantPushSubscriptionPayload,
): Promise<{ error: string | null }> {
  const blocks = payload;
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .is("merchant_id", null)
      .eq("slug", MERCHANT_PUSH_SUBSCRIPTIONS_PAGE_SLUG)
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
        .eq("slug", MERCHANT_PUSH_SUBSCRIPTIONS_PAGE_SLUG)
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
        slug: MERCHANT_PUSH_SUBSCRIPTIONS_PAGE_SLUG,
        ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }

    return { error: "pages_slug_column_missing" };
  };

  const first = await updatePayload(basePayload);
  if (!first.error) {
    merchantPushSubscriptionCache = {
      expiresAt: Date.now() + MERCHANT_PUSH_SUBSCRIPTION_CACHE_TTL_MS,
      value: payload,
    };
    return { error: null };
  }
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  const fallback = await updatePayload(payloadWithoutUpdatedAt);
  if (!fallback.error) {
    merchantPushSubscriptionCache = {
      expiresAt: Date.now() + MERCHANT_PUSH_SUBSCRIPTION_CACHE_TTL_MS,
      value: payload,
    };
  }
  return fallback;
}
