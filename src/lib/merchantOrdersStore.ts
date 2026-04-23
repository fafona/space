import { normalizeMerchantOrderRecords, type MerchantOrderRecord } from "@/lib/merchantOrders";

const MERCHANT_ORDER_SLUG_PREFIX = "__merchant_orders__:";
const MERCHANT_ORDER_CHUNK_SIZE = 100;

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

function buildOrdersChunkSlug(siteId: string, index: number) {
  return `${buildOrdersSlug(siteId)}:chunk:${index}`;
}

function parseOrdersChunkIndex(siteId: string, slug: string) {
  const normalizedSlug = normalizeText(slug);
  if (!normalizedSlug) return null;
  if (normalizedSlug === buildOrdersSlug(siteId)) return -1;
  const match = normalizedSlug.match(new RegExp(`^${buildOrdersSlug(siteId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:chunk:(\\d+)$`));
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

type StoredMerchantOrdersRow = {
  id?: string | number | null;
  slug?: unknown;
  blocks?: unknown;
  updated_at?: unknown;
};

type MerchantOrderCustomerLookup = {
  accountId?: string | null;
  userId?: string | null;
  email?: string | null;
};

export function chunkMerchantOrderRecords(orders: MerchantOrderRecord[], chunkSize = MERCHANT_ORDER_CHUNK_SIZE) {
  const normalizedChunkSize = Math.max(1, Math.round(chunkSize));
  const chunks: MerchantOrderRecord[][] = [];
  for (let index = 0; index < orders.length; index += normalizedChunkSize) {
    chunks.push(orders.slice(index, index + normalizedChunkSize));
  }
  return chunks;
}

export function mergeStoredMerchantOrdersRows(
  siteId: string,
  rows: StoredMerchantOrdersRow[],
): StoredMerchantOrders | null {
  const normalizedSiteId = normalizeSiteId(siteId);
  if (!normalizedSiteId) return null;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const withSlug = rows
    .map((row) => ({
      ...row,
      normalizedSlug: normalizeText(row.slug),
      chunkIndex: parseOrdersChunkIndex(normalizedSiteId, normalizeText(row.slug)),
    }))
    .filter((row) => row.chunkIndex !== null);

  if (withSlug.length === 0) return null;

  const preferredRows = withSlug.some((row) => (row.chunkIndex ?? -1) >= 0)
    ? withSlug
        .filter((row) => (row.chunkIndex ?? -1) >= 0)
        .sort((left, right) => (left.chunkIndex ?? 0) - (right.chunkIndex ?? 0))
    : withSlug.filter((row) => row.chunkIndex === -1);

  const orderMap = new Map<string, MerchantOrderRecord>();
  for (const row of preferredRows) {
    for (const order of normalizeMerchantOrderRecords(row.blocks)) {
      if (!orderMap.has(order.id)) {
        orderMap.set(order.id, order);
      }
    }
  }

  const updatedAt = preferredRows.reduce<string | null>((latest, row) => {
    const current = typeof row.updated_at === "string" ? row.updated_at.trim() : "";
    if (!current) return latest;
    if (!latest) return current;
    return Date.parse(current) > Date.parse(latest) ? current : latest;
  }, null);

  return {
    siteId: normalizedSiteId,
    orders: normalizeMerchantOrderRecords(Array.from(orderMap.values())),
    updatedAt,
  };
}

async function listStoredMerchantOrdersRows(supabase: MerchantOrdersStoreClient, siteId: string) {
  const normalizedSiteId = normalizeSiteId(siteId);
  if (!normalizedSiteId) return [] as StoredMerchantOrdersRow[];
  const slugPrefix = `${buildOrdersSlug(normalizedSiteId)}%`;

  const initialQuery = await supabase
    .from("pages")
    .select("id,slug,blocks,updated_at")
    .eq("merchant_id", normalizedSiteId)
    .like("slug", slugPrefix);

  let data = (initialQuery.data ?? []) as StoredMerchantOrdersRow[];
  let error = initialQuery.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const bySlug = await supabase.from("pages").select("id,slug,blocks,updated_at").like("slug", slugPrefix);
      data = (bySlug.data ?? []) as StoredMerchantOrdersRow[];
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return [];
    } else {
      return [];
    }
  }

  if (error) return [];
  return Array.isArray(data) ? data : [];
}

async function listStoredMerchantOrdersRowsBySlugPrefix(supabase: MerchantOrdersStoreClient) {
  const pageSize = 1000;
  const rows: StoredMerchantOrdersRow[] = [];

  for (let offset = 0; offset < 10000; offset += pageSize) {
    const query = await supabase
      .from("pages")
      .select("id,slug,blocks,updated_at")
      .like("slug", `${MERCHANT_ORDER_SLUG_PREFIX}%`)
      .range(offset, offset + pageSize - 1);

    let data = (query.data ?? []) as StoredMerchantOrdersRow[];
    let error = query.error;

    if (error) {
      const message = toErrorMessage(error);
      if (isMissingSlugColumn(message)) return [] as StoredMerchantOrdersRow[];
      if (isMissingUpdatedAtColumn(message)) {
        const retry = await supabase
          .from("pages")
          .select("id,slug,blocks")
          .like("slug", `${MERCHANT_ORDER_SLUG_PREFIX}%`)
          .range(offset, offset + pageSize - 1);
        data = (retry.data ?? []) as StoredMerchantOrdersRow[];
        error = retry.error;
      }
    }

    if (error) return rows;
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  return rows;
}

function matchesStoredMerchantOrderCustomer(order: MerchantOrderRecord, lookup: Required<MerchantOrderCustomerLookup>) {
  if (lookup.accountId && normalizeText(order.customerAccountId) === lookup.accountId) return true;
  if (lookup.userId && normalizeText(order.customerUserId) === lookup.userId) return true;
  if (!lookup.email) return false;
  return (
    normalizeText(order.customerLoginEmail).toLowerCase() === lookup.email ||
    normalizeText(order.customer.email).toLowerCase() === lookup.email
  );
}

export async function listStoredMerchantOrdersByCustomer(
  supabase: MerchantOrdersStoreClient,
  input: MerchantOrderCustomerLookup,
) {
  const lookup = {
    accountId: normalizeText(input.accountId),
    userId: normalizeText(input.userId),
    email: normalizeText(input.email).toLowerCase(),
  };
  if (!lookup.accountId && !lookup.userId && !lookup.email) return [];

  const rows = await listStoredMerchantOrdersRowsBySlugPrefix(supabase);
  const orderMap = new Map<string, MerchantOrderRecord>();
  for (const row of rows) {
    for (const order of normalizeMerchantOrderRecords(row.blocks)) {
      if (!matchesStoredMerchantOrderCustomer(order, lookup)) continue;
      orderMap.set(order.id, order);
    }
  }

  return normalizeMerchantOrderRecords(Array.from(orderMap.values()));
}

export async function loadStoredMerchantOrders(
  supabase: MerchantOrdersStoreClient,
  siteId: string,
): Promise<StoredMerchantOrders | null> {
  const normalizedSiteId = normalizeSiteId(siteId);
  if (!normalizedSiteId) return null;
  const rows = await listStoredMerchantOrdersRows(supabase, normalizedSiteId);
  return mergeStoredMerchantOrdersRows(normalizedSiteId, rows);
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
  const normalizedOrders = normalizeMerchantOrderRecords(input.orders);
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const existingRows = await listStoredMerchantOrdersRows(supabase, normalizedSiteId);
  const existingBySlug = new Map(
    existingRows
      .map((row) => [normalizeText(row.slug), row] as const)
      .filter(([slug]) => Boolean(slug)),
  );
  const desiredChunks = chunkMerchantOrderRecords(normalizedOrders);
  const desiredSlugs = desiredChunks.map((_, index) => buildOrdersChunkSlug(normalizedSiteId, index));

  const upsertChunk = async (slug: string, orders: MerchantOrderRecord[]) => {
    const existing = existingBySlug.get(slug);
    const basePayload = {
      blocks: orders,
      updated_at: updatedAt,
    };

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
      if (!error || !isMissingMerchantIdColumn(error)) {
        return { error };
      }
      const retry = await supabase.from("pages").insert({
        ...body,
        slug,
      });
      return retry.error ? { error: toErrorMessage(retry.error) } : { error: null };
    };

    const first = existing ? await updateExisting(basePayload) : await insertNew(basePayload);
    if (!first.error) return first;
    if (!isMissingUpdatedAtColumn(first.error)) return first;
    return existing ? updateExisting({ blocks: orders }) : insertNew({ blocks: orders });
  };

  for (let index = 0; index < desiredChunks.length; index += 1) {
    const chunkOrders = desiredChunks[index] ?? [];
    const slug = desiredSlugs[index] ?? buildOrdersChunkSlug(normalizedSiteId, index);
    const result = await upsertChunk(slug, chunkOrders);
    if (result.error) return result;
  }

  const staleRows = existingRows.filter((row) => {
    const slug = normalizeText(row.slug);
    return slug && !desiredSlugs.includes(slug);
  });

  for (const row of staleRows) {
    if (row.id === undefined || row.id === null) continue;
    const deleted = await supabase.from("pages").delete().eq("id", row.id);
    if (deleted.error) {
      return { error: toErrorMessage(deleted.error) };
    }
  }

  return { error: null };
}
