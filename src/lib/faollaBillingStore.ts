import {
  normalizeFaollaBillingEventRecord,
  normalizeFaollaMerchantSubscription,
  type FaollaBillingEventRecord,
  type FaollaMerchantSubscription,
} from "@/lib/faollaBilling";

const FAOLLA_MERCHANT_SUBSCRIPTION_SLUG_PREFIX = "__faolla_merchant_subscription__:";
const FAOLLA_BILLING_EVENTS_SLUG = "__faolla_billing_events__";
const MAX_BILLING_EVENTS = 2000;

export type FaollaBillingStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type StoredRow = {
  id?: string | number | null;
  slug?: unknown;
  blocks?: unknown;
  updated_at?: unknown;
};

function normalizeText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

function buildSubscriptionSlug(merchantId: string) {
  return `${FAOLLA_MERCHANT_SUBSCRIPTION_SLUG_PREFIX}${merchantId}`;
}

async function queryRowsBySlug(supabase: FaollaBillingStoreClient, slug: string, merchantId?: string) {
  if (!slug) return [] as StoredRow[];
  const initial = merchantId
    ? await supabase.from("pages").select("id,slug,blocks,updated_at").eq("merchant_id", merchantId).eq("slug", slug)
    : await supabase.from("pages").select("id,slug,blocks,updated_at").eq("slug", slug);

  let data = (initial.data ?? []) as StoredRow[];
  let error = initial.error;

  if (error) {
    const message = toErrorMessage(error);
    if (merchantId && isMissingMerchantIdColumn(message)) {
      const retry = await supabase.from("pages").select("id,slug,blocks,updated_at").eq("slug", slug);
      data = (retry.data ?? []) as StoredRow[];
      error = retry.error;
    } else if (isMissingUpdatedAtColumn(message)) {
      const retry = merchantId
        ? await supabase.from("pages").select("id,slug,blocks").eq("merchant_id", merchantId).eq("slug", slug)
        : await supabase.from("pages").select("id,slug,blocks").eq("slug", slug);
      data = (retry.data ?? []) as StoredRow[];
      error = retry.error;
    } else if (isMissingSlugColumn(message)) {
      return [];
    }
  }

  if (error) return [];
  return Array.isArray(data) ? data : [];
}

async function saveInternalRow(
  supabase: FaollaBillingStoreClient,
  input: {
    slug: string;
    blocks: unknown;
    updatedAt?: string | null;
    existingRowId?: string | number | null;
    merchantId?: string | null;
  },
) {
  const slug = normalizeText(input.slug, 180);
  if (!slug) return { error: "invalid_slug" };
  const merchantId = normalizeText(input.merchantId, 40);
  const updatedAt = normalizeText(input.updatedAt, 80) || new Date().toISOString();
  const existing =
    input.existingRowId !== undefined && input.existingRowId !== null
      ? ({ id: input.existingRowId } as StoredRow)
      : (await queryRowsBySlug(supabase, slug, merchantId))[0];

  const updateExisting = async (body: Record<string, unknown>) => {
    if (existing?.id === undefined || existing?.id === null) return { error: "missing_existing_id" };
    const updated = await supabase.from("pages").update(body).eq("id", existing.id);
    return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
  };

  const insertNew = async (body: Record<string, unknown>) => {
    const base = merchantId ? { ...body, slug, merchant_id: merchantId } : { ...body, slug };
    const inserted = await supabase.from("pages").insert(base);
    const error = inserted.error ? toErrorMessage(inserted.error) : null;
    if (!error || !merchantId || !isMissingMerchantIdColumn(error)) return { error };
    const retry = await supabase.from("pages").insert({ ...body, slug });
    return retry.error ? { error: toErrorMessage(retry.error) } : { error: null };
  };

  const basePayload = {
    blocks: input.blocks,
    updated_at: updatedAt,
  };
  const first = existing ? await updateExisting(basePayload) : await insertNew(basePayload);
  if (!first.error) return first;
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return existing ? updateExisting({ blocks: input.blocks }) : insertNew({ blocks: input.blocks });
}

export async function loadStoredFaollaMerchantSubscription(
  supabase: FaollaBillingStoreClient,
  merchantId: string,
): Promise<FaollaMerchantSubscription | null> {
  const normalizedMerchantId = normalizeText(merchantId, 40);
  if (!/^\d{8}$/.test(normalizedMerchantId)) return null;
  const rows = await queryRowsBySlug(supabase, buildSubscriptionSlug(normalizedMerchantId), normalizedMerchantId);
  for (const row of rows) {
    const subscription = normalizeFaollaMerchantSubscription(row.blocks);
    if (subscription?.merchantId === normalizedMerchantId) return subscription;
  }
  return null;
}

export async function saveStoredFaollaMerchantSubscription(
  supabase: FaollaBillingStoreClient,
  subscription: FaollaMerchantSubscription,
): Promise<{ error: string | null }> {
  const normalized = normalizeFaollaMerchantSubscription(subscription);
  if (!normalized) return { error: "invalid_subscription" };
  return saveInternalRow(supabase, {
    slug: buildSubscriptionSlug(normalized.merchantId),
    blocks: normalized,
    updatedAt: normalized.updatedAt,
    merchantId: normalized.merchantId,
  });
}

export async function listStoredFaollaMerchantSubscriptions(
  supabase: FaollaBillingStoreClient,
): Promise<FaollaMerchantSubscription[]> {
  const initial = await supabase
    .from("pages")
    .select("id,slug,blocks,updated_at")
    .like("slug", `${FAOLLA_MERCHANT_SUBSCRIPTION_SLUG_PREFIX}%`);
  if (initial.error) return [];
  const rows = Array.isArray(initial.data) ? (initial.data as StoredRow[]) : [];
  return rows
    .map((row) => normalizeFaollaMerchantSubscription(row.blocks))
    .filter((item): item is FaollaMerchantSubscription => Boolean(item));
}

export async function findStoredFaollaMerchantSubscriptionByStripeIds(
  supabase: FaollaBillingStoreClient,
  input: { customerId?: unknown; subscriptionId?: unknown; checkoutSessionId?: unknown },
) {
  const customerId = normalizeText(input.customerId, 200);
  const subscriptionId = normalizeText(input.subscriptionId, 200);
  const checkoutSessionId = normalizeText(input.checkoutSessionId, 200);
  if (!customerId && !subscriptionId && !checkoutSessionId) return null;
  const subscriptions = await listStoredFaollaMerchantSubscriptions(supabase);
  return (
    subscriptions.find(
      (subscription) =>
        (customerId && subscription.stripeCustomerId === customerId) ||
        (subscriptionId && subscription.stripeSubscriptionId === subscriptionId) ||
        (checkoutSessionId && subscription.stripeCheckoutSessionId === checkoutSessionId),
    ) ?? null
  );
}

export async function loadStoredFaollaBillingEvents(
  supabase: FaollaBillingStoreClient,
): Promise<FaollaBillingEventRecord[]> {
  const rows = await queryRowsBySlug(supabase, FAOLLA_BILLING_EVENTS_SLUG);
  const row = rows[0] ?? null;
  const events = Array.isArray(row?.blocks) ? row?.blocks : [];
  return events
    .map((item) => normalizeFaollaBillingEventRecord(item))
    .filter((item): item is FaollaBillingEventRecord => Boolean(item));
}

export async function hasProcessedFaollaBillingEvent(supabase: FaollaBillingStoreClient, eventId: string) {
  const normalizedEventId = normalizeText(eventId, 200);
  if (!normalizedEventId) return false;
  const events = await loadStoredFaollaBillingEvents(supabase);
  return events.some((event) => event.id === normalizedEventId);
}

export async function appendStoredFaollaBillingEvent(
  supabase: FaollaBillingStoreClient,
  event: FaollaBillingEventRecord,
): Promise<{ error: string | null }> {
  const normalized = normalizeFaollaBillingEventRecord(event);
  if (!normalized) return { error: "invalid_event" };
  const rows = await queryRowsBySlug(supabase, FAOLLA_BILLING_EVENTS_SLUG);
  const existingRow = rows[0] ?? null;
  const current = await loadStoredFaollaBillingEvents(supabase);
  const next = [
    normalized,
    ...current.filter((item) => item.id !== normalized.id),
  ].slice(0, MAX_BILLING_EVENTS);
  return saveInternalRow(supabase, {
    slug: FAOLLA_BILLING_EVENTS_SLUG,
    blocks: next,
    updatedAt: normalized.processedAt,
    existingRowId: existingRow?.id ?? null,
  });
}
