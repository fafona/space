import { normalizeMerchantOrderRecords, type MerchantOrderRecord } from "@/lib/merchantOrders";
import { matchesExactPersonalIdentity } from "@/lib/personalAccountId";
import { saveMerchantSnapshotHistory } from "@/lib/merchantSnapshotHistoryStore";

const MERCHANT_ORDER_SLUG_PREFIX = "__merchant_orders__:";
const MERCHANT_ORDER_HISTORY_SLUG_PREFIX = "__merchant_orders_history_v2__:";
const MERCHANT_ORDER_HISTORY_BACKUP_SLUG_PREFIX = "__merchant_orders_history_backup_v2__:";
const MERCHANT_ORDER_CHUNK_SIZE = 100;
const MERCHANT_ORDER_FULL_READ_PAGE_SIZE = 1000;
const MERCHANT_ORDER_FULL_READ_MAX_ROWS = 10_000;

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

export type StoredMerchantOrdersWindow = StoredMerchantOrders & {
  offset: number;
  limit: number;
  hasMore: boolean;
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

function throwOrdersStoreQueryError(input: unknown): never {
  throw new Error(`merchant_orders_read_failed:${toErrorMessage(input)}`);
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

function buildOrdersHistorySlug(siteId: string) {
  return `${MERCHANT_ORDER_HISTORY_SLUG_PREFIX}${siteId}`;
}

function buildOrdersHistoryBackupSlug(siteId: string) {
  return `${MERCHANT_ORDER_HISTORY_BACKUP_SLUG_PREFIX}${siteId}`;
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

type StoredMerchantOrdersRowWithChunk = StoredMerchantOrdersRow & {
  normalizedSlug: string;
  chunkIndex: number | null;
};

type MerchantOrderCustomerLookup = {
  accountId?: string | null;
  userId?: string | null;
};

export function chunkMerchantOrderRecords(orders: MerchantOrderRecord[], chunkSize = MERCHANT_ORDER_CHUNK_SIZE) {
  const normalizedChunkSize = Math.max(1, Math.round(chunkSize));
  const chunks: MerchantOrderRecord[][] = [];
  for (let index = 0; index < orders.length; index += normalizedChunkSize) {
    chunks.push(orders.slice(index, index + normalizedChunkSize));
  }
  return chunks;
}

export function getChangedMerchantOrderChunkIndexes(
  previousOrders: MerchantOrderRecord[],
  nextOrders: MerchantOrderRecord[],
  chunkSize = MERCHANT_ORDER_CHUNK_SIZE,
) {
  const previousChunks = chunkMerchantOrderRecords(normalizeMerchantOrderRecords(previousOrders), chunkSize);
  const nextChunks = chunkMerchantOrderRecords(normalizeMerchantOrderRecords(nextOrders), chunkSize);
  const changedIndexes: number[] = [];
  const totalChunks = Math.max(previousChunks.length, nextChunks.length);
  for (let index = 0; index < totalChunks; index += 1) {
    if (JSON.stringify(previousChunks[index] ?? []) !== JSON.stringify(nextChunks[index] ?? [])) {
      changedIndexes.push(index);
    }
  }
  return changedIndexes;
}

function buildMerchantOrderChunkHistorySnapshot(
  siteId: string,
  orders: MerchantOrderRecord[],
  chunkIndexes: number[],
) {
  const chunks = chunkMerchantOrderRecords(orders);
  return {
    format: "merchant-order-chunks-v2",
    siteId,
    totalOrders: orders.length,
    chunks: chunkIndexes.map((index) => ({
      index,
      orders: chunks[index] ?? [],
    })),
  };
}

export function getMerchantOrderChunkIndexesForWindow(
  totalChunks: number,
  offset: number,
  limit: number,
  chunkSize = MERCHANT_ORDER_CHUNK_SIZE,
) {
  const normalizedTotalChunks = Math.max(0, Math.round(totalChunks));
  const normalizedChunkSize = Math.max(1, Math.round(chunkSize));
  const normalizedOffset = Math.max(0, Math.floor(offset));
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (normalizedTotalChunks <= 0 || normalizedLimit <= 0) return [];
  const startChunkIndex = Math.floor(normalizedOffset / normalizedChunkSize);
  if (startChunkIndex >= normalizedTotalChunks) return [];
  const endChunkIndex = Math.min(
    normalizedTotalChunks - 1,
    Math.floor((normalizedOffset + normalizedLimit - 1) / normalizedChunkSize),
  );
  const indexes: number[] = [];
  for (let index = startChunkIndex; index <= endChunkIndex; index += 1) {
    indexes.push(index);
  }
  return indexes;
}

function attachMerchantOrderChunkIndex(siteId: string, row: StoredMerchantOrdersRow): StoredMerchantOrdersRowWithChunk {
  const normalizedSlug = normalizeText(row.slug);
  return {
    ...row,
    normalizedSlug,
    chunkIndex: parseOrdersChunkIndex(siteId, normalizedSlug),
  };
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

  const readAllPages = async (includeMerchantId: boolean, includeUpdatedAt: boolean) => {
    const rows: StoredMerchantOrdersRow[] = [];
    const seenRowKeys = new Set<string>();
    let offset = 0;

    while (offset <= MERCHANT_ORDER_FULL_READ_MAX_ROWS) {
      const remainingCapacity = MERCHANT_ORDER_FULL_READ_MAX_ROWS - offset;
      const requestedSize = Math.max(
        1,
        Math.min(MERCHANT_ORDER_FULL_READ_PAGE_SIZE, remainingCapacity || 1),
      );
      let query = supabase
        .from("pages")
        .select(includeUpdatedAt ? "id,slug,blocks,updated_at" : "id,slug,blocks");
      if (includeMerchantId) query = query.eq("merchant_id", normalizedSiteId);
      query = query.like("slug", slugPrefix);
      if (typeof query.order !== "function" || typeof query.range !== "function") {
        throw new Error("merchant_orders_read_failed:pagination_unsupported");
      }
      query = query
        .order("slug", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + requestedSize - 1);

      const result = await query;
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) {
        throw new Error("merchant_orders_read_failed:invalid_response");
      }
      const page = result.data as StoredMerchantOrdersRow[];
      if (page.length > requestedSize) {
        throw new Error("merchant_orders_read_failed:pagination_unsupported");
      }
      if (page.length === 0) return rows;
      if (rows.length + page.length > MERCHANT_ORDER_FULL_READ_MAX_ROWS) {
        throw new Error("merchant_orders_read_failed:row_limit_exceeded");
      }

      for (const row of page) {
        const rowKey = `${normalizeText(row.slug)}\u0000${String(row.id ?? "").trim()}`;
        if (seenRowKeys.has(rowKey)) {
          throw new Error("merchant_orders_read_failed:pagination_unstable");
        }
        seenRowKeys.add(rowKey);
      }
      rows.push(...page);
      offset += page.length;
    }

    throw new Error("merchant_orders_read_failed:row_limit_exceeded");
  };

  let includeMerchantId = true;
  let includeUpdatedAt = true;
  while (true) {
    try {
      return await readAllPages(includeMerchantId, includeUpdatedAt);
    } catch (error) {
      const message = toErrorMessage(error);
      if (isMissingSlugColumn(message)) return [];
      if (includeMerchantId && isMissingMerchantIdColumn(message)) {
        includeMerchantId = false;
        continue;
      }
      if (includeUpdatedAt && isMissingUpdatedAtColumn(message)) {
        includeUpdatedAt = false;
        continue;
      }
      if (message.startsWith("merchant_orders_read_failed:")) throw error;
      throwOrdersStoreQueryError(error);
    }
  }
}

async function listStoredMerchantOrdersRowMetadata(supabase: MerchantOrdersStoreClient, siteId: string) {
  const normalizedSiteId = normalizeSiteId(siteId);
  if (!normalizedSiteId) return [] as StoredMerchantOrdersRow[];
  const slugPrefix = `${buildOrdersSlug(normalizedSiteId)}%`;

  const runQuery = async (selectFields: string, includeMerchantId: boolean) => {
    const query = supabase.from("pages").select(selectFields).like("slug", slugPrefix);
    return includeMerchantId ? query.eq("merchant_id", normalizedSiteId) : query;
  };

  let query = await runQuery("id,slug,updated_at", true);
  let data = (query.data ?? []) as StoredMerchantOrdersRow[];
  let error = query.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      query = await runQuery("id,slug,updated_at", false);
      data = (query.data ?? []) as StoredMerchantOrdersRow[];
      error = query.error;
    } else if (isMissingUpdatedAtColumn(message)) {
      query = await runQuery("id,slug", true);
      data = (query.data ?? []) as StoredMerchantOrdersRow[];
      error = query.error;
    } else if (isMissingSlugColumn(message)) {
      return [];
    }
  }

  if (error && isMissingUpdatedAtColumn(toErrorMessage(error))) {
    const fallback = await runQuery("id,slug", false);
    data = (fallback.data ?? []) as StoredMerchantOrdersRow[];
    error = fallback.error;
  }

  if (error) {
    if (isMissingSlugColumn(toErrorMessage(error))) return [];
    throwOrdersStoreQueryError(error);
  }
  return Array.isArray(data) ? data : [];
}

async function listStoredMerchantOrdersRowsBySlugs(
  supabase: MerchantOrdersStoreClient,
  siteId: string,
  slugs: string[],
) {
  const normalizedSiteId = normalizeSiteId(siteId);
  const normalizedSlugs = [...new Set(slugs.map(normalizeText).filter(Boolean))];
  if (!normalizedSiteId || normalizedSlugs.length === 0) return [] as StoredMerchantOrdersRow[];

  const runQuery = async (selectFields: string, includeMerchantId: boolean) => {
    const query = supabase.from("pages").select(selectFields).in("slug", normalizedSlugs);
    return includeMerchantId ? query.eq("merchant_id", normalizedSiteId) : query;
  };

  let query = await runQuery("id,slug,blocks,updated_at", true);
  let data = (query.data ?? []) as StoredMerchantOrdersRow[];
  let error = query.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      query = await runQuery("id,slug,blocks,updated_at", false);
      data = (query.data ?? []) as StoredMerchantOrdersRow[];
      error = query.error;
    } else if (isMissingUpdatedAtColumn(message)) {
      query = await runQuery("id,slug,blocks", true);
      data = (query.data ?? []) as StoredMerchantOrdersRow[];
      error = query.error;
    } else if (isMissingSlugColumn(message)) {
      return [];
    }
  }

  if (error && isMissingUpdatedAtColumn(toErrorMessage(error))) {
    const fallback = await runQuery("id,slug,blocks", false);
    data = (fallback.data ?? []) as StoredMerchantOrdersRow[];
    error = fallback.error;
  }

  if (error) {
    if (isMissingSlugColumn(toErrorMessage(error))) return [];
    throwOrdersStoreQueryError(error);
  }
  return Array.isArray(data) ? data : [];
}

async function listStoredMerchantOrderRows(
  supabase: MerchantOrdersStoreClient,
  siteId: string,
  orderId: string,
) {
  const normalizedSiteId = normalizeSiteId(siteId);
  const normalizedOrderId = normalizeText(orderId);
  if (!normalizedSiteId || !normalizedOrderId) return [] as StoredMerchantOrdersRow[];
  const slugPrefix = `${buildOrdersSlug(normalizedSiteId)}%`;
  let includeMerchantId = true;
  let includeUpdatedAt = true;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let query = supabase
      .from("pages")
      .select(includeUpdatedAt ? "id,slug,blocks,updated_at" : "id,slug,blocks");
    if (includeMerchantId) query = query.eq("merchant_id", normalizedSiteId);
    const result = await query
      .like("slug", slugPrefix)
      // PostgREST expects a JSON document for jsonb containment. Passing an
      // array directly makes postgrest-js serialize objects as
      // `{[object Object]}`, which PostgreSQL rejects as invalid JSON.
      .contains("blocks", JSON.stringify([{ id: normalizedOrderId }]));
    const data = (result.data ?? []) as StoredMerchantOrdersRow[];
    if (!result.error) return Array.isArray(data) ? data : [];

    const message = toErrorMessage(result.error);
    if (isMissingSlugColumn(message)) return [];
    if (includeMerchantId && isMissingMerchantIdColumn(message)) {
      includeMerchantId = false;
      continue;
    }
    if (includeUpdatedAt && isMissingUpdatedAtColumn(message)) {
      includeUpdatedAt = false;
      continue;
    }
    throwOrdersStoreQueryError(result.error);
  }

  return [];
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

    if (error) throwOrdersStoreQueryError(error);
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  return rows;
}

function matchesStoredMerchantOrderCustomer(
  order: MerchantOrderRecord,
  lookup: Required<MerchantOrderCustomerLookup>,
) {
  return matchesExactPersonalIdentity(
    {
      accountId: order.customerAccountId,
      userId: order.customerUserId,
    },
    lookup,
  );
}

export async function listStoredMerchantOrdersByCustomer(
  supabase: MerchantOrdersStoreClient,
  input: MerchantOrderCustomerLookup,
) {
  const lookup = {
    accountId: normalizeText(input.accountId),
    userId: normalizeText(input.userId),
  };
  if (!lookup.accountId && !lookup.userId) return [];

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

export async function loadStoredMerchantOrder(
  supabase: MerchantOrdersStoreClient,
  siteId: string,
  orderId: string,
): Promise<StoredMerchantOrders> {
  const normalizedSiteId = normalizeSiteId(siteId);
  const normalizedOrderId = normalizeText(orderId);
  if (!normalizedSiteId || !normalizedOrderId) {
    return { siteId: normalizedSiteId, orders: [], updatedAt: null };
  }

  const [metadataRows, rows] = await Promise.all([
    listStoredMerchantOrdersRowMetadata(supabase, normalizedSiteId),
    listStoredMerchantOrderRows(supabase, normalizedSiteId, normalizedOrderId),
  ]);
  const storageHasChunks = metadataRows
    .map((row) => attachMerchantOrderChunkIndex(normalizedSiteId, row))
    .some((row) => (row.chunkIndex ?? -1) >= 0);
  const withSlug = rows
    .map((row) => attachMerchantOrderChunkIndex(normalizedSiteId, row))
    .filter((row) => row.chunkIndex !== null);
  const preferredRows =
    storageHasChunks || withSlug.some((row) => (row.chunkIndex ?? -1) >= 0)
    ? withSlug
        .filter((row) => (row.chunkIndex ?? -1) >= 0)
        .sort((left, right) => (left.chunkIndex ?? 0) - (right.chunkIndex ?? 0))
    : withSlug.filter((row) => row.chunkIndex === -1);

  let matchedOrder: MerchantOrderRecord | null = null;
  let updatedAt: string | null = null;
  for (const row of preferredRows) {
    const order = normalizeMerchantOrderRecords(row.blocks).find(
      (candidate) =>
        candidate.siteId === normalizedSiteId && candidate.id === normalizedOrderId,
    );
    if (!order) continue;
    if (!matchedOrder) matchedOrder = order;
    const rowUpdatedAt = normalizeText(row.updated_at);
    if (
      rowUpdatedAt &&
      (!updatedAt || Date.parse(rowUpdatedAt) > Date.parse(updatedAt))
    ) {
      updatedAt = rowUpdatedAt;
    }
  }

  return {
    siteId: normalizedSiteId,
    orders: matchedOrder ? [matchedOrder] : [],
    updatedAt: matchedOrder ? updatedAt : null,
  };
}

export async function loadStoredMerchantOrdersWindow(
  supabase: MerchantOrdersStoreClient,
  siteId: string,
  input: {
    offset?: number;
    limit?: number;
  },
): Promise<StoredMerchantOrdersWindow | null> {
  const normalizedSiteId = normalizeSiteId(siteId);
  if (!normalizedSiteId) return null;
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const limit = Math.max(1, Math.floor(input.limit ?? MERCHANT_ORDER_CHUNK_SIZE));
  const metadataRows = await listStoredMerchantOrdersRowMetadata(supabase, normalizedSiteId);
  const chunkRows = metadataRows
    .map((row) => attachMerchantOrderChunkIndex(normalizedSiteId, row))
    .filter((row): row is StoredMerchantOrdersRowWithChunk & { chunkIndex: number } => (row.chunkIndex ?? -1) >= 0)
    .sort((left, right) => left.chunkIndex - right.chunkIndex);

  if (chunkRows.length === 0) {
    const fallback = await loadStoredMerchantOrders(supabase, normalizedSiteId);
    if (!fallback) return null;
    const orders = fallback.orders.slice(offset, offset + limit);
    return {
      ...fallback,
      orders,
      offset,
      limit,
      hasMore: offset + orders.length < fallback.orders.length,
    };
  }

  const maxChunkIndex = chunkRows.reduce((max, row) => Math.max(max, row.chunkIndex), 0);
  const chunkIndexes = getMerchantOrderChunkIndexesForWindow(maxChunkIndex + 1, offset, limit);
  if (chunkIndexes.length === 0) {
    return {
      siteId: normalizedSiteId,
      orders: [],
      updatedAt: null,
      offset,
      limit,
      hasMore: false,
    };
  }

  const chunkIndexSet = new Set(chunkIndexes);
  const selectedSlugs = chunkRows
    .filter((row) => chunkIndexSet.has(row.chunkIndex))
    .map((row) => row.normalizedSlug);
  const selectedRows = await listStoredMerchantOrdersRowsBySlugs(supabase, normalizedSiteId, selectedSlugs);
  const merged = mergeStoredMerchantOrdersRows(normalizedSiteId, selectedRows);
  const firstChunkIndex = chunkIndexes[0] ?? 0;
  const offsetInsideSelectedRows = Math.max(0, offset - firstChunkIndex * MERCHANT_ORDER_CHUNK_SIZE);
  const selectedOrders = merged?.orders ?? [];
  const orders = selectedOrders.slice(offsetInsideSelectedRows, offsetInsideSelectedRows + limit);
  const selectedRowsHaveMore = selectedOrders.length > offsetInsideSelectedRows + orders.length;
  const hasMore = selectedRowsHaveMore || (chunkIndexes.at(-1) ?? maxChunkIndex) < maxChunkIndex;

  return {
    siteId: normalizedSiteId,
    orders,
    updatedAt: merged?.updatedAt ?? null,
    offset,
    limit,
    hasMore,
  };
}

export async function saveStoredMerchantOrders(
  supabase: MerchantOrdersStoreClient,
  input: {
    siteId: string;
    orders: MerchantOrderRecord[];
    previousOrders?: MerchantOrderRecord[] | null;
    updatedAt?: string | null;
  },
): Promise<{ error: string | null }> {
  const normalizedSiteId = normalizeSiteId(input.siteId);
  if (!normalizedSiteId) return { error: "invalid_site_id" };
  const normalizedOrders = normalizeMerchantOrderRecords(input.orders);
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const hasPreviousOrders = Object.prototype.hasOwnProperty.call(input, "previousOrders");
  const existingRows = hasPreviousOrders
    ? await listStoredMerchantOrdersRowMetadata(supabase, normalizedSiteId)
    : await listStoredMerchantOrdersRows(supabase, normalizedSiteId);
  const beforeOrders = hasPreviousOrders
    ? normalizeMerchantOrderRecords(input.previousOrders ?? [])
    : mergeStoredMerchantOrdersRows(normalizedSiteId, existingRows)?.orders ?? null;
  const contentChangedChunkIndexes =
    beforeOrders === null
      ? chunkMerchantOrderRecords(normalizedOrders).map((_, index) => index)
      : getChangedMerchantOrderChunkIndexes(beforeOrders, normalizedOrders);
  const desiredChunks = chunkMerchantOrderRecords(normalizedOrders);
  const desiredSlugs = desiredChunks.map((_, index) => buildOrdersChunkSlug(normalizedSiteId, index));
  const existingSlugSet = new Set(existingRows.map((row) => normalizeText(row.slug)).filter(Boolean));
  const missingChunkIndexes = desiredSlugs.flatMap((slug, index) => (existingSlugSet.has(slug) ? [] : [index]));
  const changedChunkIndexes = [...new Set([...contentChangedChunkIndexes, ...missingChunkIndexes])].sort(
    (left, right) => left - right,
  );
  const staleRows = existingRows.filter((row) => {
    const slug = normalizeText(row.slug);
    return slug && !desiredSlugs.includes(slug);
  });

  if (changedChunkIndexes.length === 0 && staleRows.length === 0) {
    return { error: null };
  }

  if (contentChangedChunkIndexes.length > 0) {
    const history = await saveMerchantSnapshotHistory(supabase, {
      siteId: normalizedSiteId,
      slug: buildOrdersHistorySlug(normalizedSiteId),
      backupSlug: buildOrdersHistoryBackupSlug(normalizedSiteId),
      source: "merchant-orders-chunks-v2",
      before:
        beforeOrders === null
          ? null
          : buildMerchantOrderChunkHistorySnapshot(normalizedSiteId, beforeOrders, contentChangedChunkIndexes),
      after: buildMerchantOrderChunkHistorySnapshot(
        normalizedSiteId,
        normalizedOrders,
        contentChangedChunkIndexes,
      ),
      at: updatedAt,
      maxEntries: 20,
    });
    if (history.error) return { error: `merchant_orders_history_save_failed:${history.error}` };
  }
  const existingBySlug = new Map(
    existingRows
      .map((row) => [normalizeText(row.slug), row] as const)
      .filter(([slug]) => Boolean(slug)),
  );

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

  for (const index of changedChunkIndexes) {
    const chunkOrders = desiredChunks[index] ?? [];
    if (chunkOrders.length === 0) continue;
    const slug = desiredSlugs[index] ?? buildOrdersChunkSlug(normalizedSiteId, index);
    const result = await upsertChunk(slug, chunkOrders);
    if (result.error) return result;
  }

  for (const row of staleRows) {
    if (row.id === undefined || row.id === null) continue;
    const deleted = await supabase.from("pages").delete().eq("id", row.id);
    if (deleted.error) {
      return { error: toErrorMessage(deleted.error) };
    }
  }

  return { error: null };
}
