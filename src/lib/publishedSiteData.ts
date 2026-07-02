import { createClient } from "@supabase/supabase-js";
import type { Block, MerchantListPublishedSite } from "@/data/homeBlocks";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import type { PublishedMerchantServiceState } from "@/lib/publishedMerchantService";
import {
  loadPublishedMerchantServiceStateBySiteId,
  loadPublishedMerchantSnapshotSiteBySiteId,
} from "@/lib/publishedMerchantService";

export type PublishedPageRow = {
  blocks?: unknown;
  slug?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type MerchantProfileRow = {
  name?: string | null;
};

export type PublishedSitePayload = {
  siteId: string;
  slug: string;
  merchantName: string;
  blocks: Block[];
  merchantProfile: MerchantListPublishedSite | null;
  serviceState: PublishedMerchantServiceState | null;
  orderManagementEnabled: boolean;
};

export type PublishedSiteBlocksPayload = {
  siteId: string;
  slug: string;
  blocks: Block[];
  orderManagementEnabled: boolean;
};

const PUBLISHED_SITE_PAYLOAD_CACHE_TTL_MS = 1_500;
const PUBLISHED_SITE_PAYLOAD_EMPTY_CACHE_TTL_MS = 1_000;
const PUBLISHED_SITE_BLOCKS_CACHE_TTL_MS = 15_000;
const PUBLISHED_SITE_BLOCKS_EMPTY_CACHE_TTL_MS = 2_000;
const ORDER_MANAGEMENT_PERMISSION_TIMEOUT_MS = 1_500;

const publishedSitePayloadCache = new Map<
  string,
  {
    expiresAt: number;
    pending?: Promise<PublishedSitePayload | null>;
    value?: PublishedSitePayload | null;
  }
>();
const publishedSiteBlocksCache = new Map<
  string,
  {
    expiresAt: number;
    pending?: Promise<PublishedSiteBlocksPayload | null>;
    value?: PublishedSiteBlocksPayload | null;
  }
>();

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

async function withFallbackTimeout<T>(task: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), Math.max(100, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toTimestamp(value: string | null | undefined) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeSlug(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function isInternalPagesSlug(value: string | null | undefined) {
  const normalized = normalizeSlug(value);
  return normalized.startsWith("__");
}

function isPublishedBlockRecord(value: unknown): value is Block {
  if (!value || typeof value !== "object") return false;
  const record = value as { id?: unknown; type?: unknown; props?: unknown };
  return (
    typeof record.id === "string" &&
    record.id.trim().length > 0 &&
    typeof record.type === "string" &&
    record.type.trim().length > 0 &&
    !!record.props &&
    typeof record.props === "object"
  );
}

export function isPublishedBlocksPayload(value: unknown): value is Block[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isPublishedBlockRecord(item));
}

function blocksContainProductBlock(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => blocksContainProductBlock(item));
  if (!value || typeof value !== "object") return false;
  const record = value as { type?: unknown; props?: unknown; blocks?: unknown; pages?: unknown; plans?: unknown };
  if (record.type === "product") return true;
  return (
    blocksContainProductBlock(record.blocks) ||
    blocksContainProductBlock(record.pages) ||
    blocksContainProductBlock(record.plans) ||
    blocksContainProductBlock(record.props)
  );
}

export function isMissingPublishedSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

export function choosePreferredPublishedPageRow(current: PublishedPageRow | null, candidate: PublishedPageRow) {
  if (!current) return candidate;
  const currentUpdatedAt = Math.max(toTimestamp(current.updated_at), toTimestamp(current.created_at));
  const candidateUpdatedAt = Math.max(toTimestamp(candidate.updated_at), toTimestamp(candidate.created_at));
  return candidateUpdatedAt >= currentUpdatedAt ? candidate : current;
}

export function pickPublishedPageRow(rows: PublishedPageRow[]) {
  return rows
    .filter((item) => !isInternalPagesSlug(item.slug))
    .filter((item) => isPublishedBlocksPayload(item.blocks))
    .reduce<PublishedPageRow | null>((best, item) => choosePreferredPublishedPageRow(best, item), null);
}

function createPublishedSiteDataClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

type PublishedSiteDataClient = NonNullable<ReturnType<typeof createPublishedSiteDataClient>>;

type PublishedPageMetaRow = Omit<PublishedPageRow, "blocks">;

function sortPublishedPageMetaRows(rows: PublishedPageMetaRow[]) {
  return [...rows].sort((left, right) => {
    const delta =
      Math.max(toTimestamp(right.updated_at), toTimestamp(right.created_at)) -
      Math.max(toTimestamp(left.updated_at), toTimestamp(left.created_at));
    if (delta !== 0) return delta;
    return normalizeSlug(left.slug).localeCompare(normalizeSlug(right.slug), "zh-CN");
  });
}

async function queryPublishedPageRows(supabase: PublishedSiteDataClient, normalizedSiteId: string) {
  const metadataQuery = await supabase
    .from("pages")
    .select("slug,updated_at,created_at")
    .eq("merchant_id", normalizedSiteId)
    .limit(20);

  if (!metadataQuery.error) {
    const candidates = sortPublishedPageMetaRows(
      ((metadataQuery.data ?? []) as PublishedPageMetaRow[]).filter((item) => !isInternalPagesSlug(item.slug)),
    );

    for (const candidate of candidates) {
      const slug = normalizeSlug(candidate.slug);
      let rowQuery = supabase
        .from("pages")
        .select("blocks,slug,updated_at,created_at")
        .eq("merchant_id", normalizedSiteId)
        .limit(1);
      rowQuery = slug ? rowQuery.eq("slug", slug) : rowQuery.is("slug", null);
      const rowResult = await rowQuery.maybeSingle();
      if (rowResult.error) continue;
      const row = rowResult.data as PublishedPageRow | null;
      if (row && isPublishedBlocksPayload(row.blocks)) {
        return {
          data: [row],
          error: null,
        };
      }
    }
  }

  if (!metadataQuery.error || !isMissingPublishedSlugColumn(metadataQuery.error.message)) {
    const fallbackQuery = await supabase
      .from("pages")
      .select("blocks,slug,updated_at,created_at")
      .eq("merchant_id", normalizedSiteId)
      .limit(20);
    return {
      data: fallbackQuery.data as PublishedPageRow[] | null,
      error: fallbackQuery.error,
    };
  }

  const fallbackQuery = await supabase
    .from("pages")
    .select("blocks,updated_at,created_at")
    .eq("merchant_id", normalizedSiteId)
    .limit(20);
  return {
    data: fallbackQuery.data as PublishedPageRow[] | null,
    error: fallbackQuery.error,
  };
}

async function fetchPublishedSiteBlocksFromSupabaseUncached(siteId: string): Promise<PublishedSiteBlocksPayload | null> {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!isMerchantNumericId(normalizedSiteId)) return null;

  const supabase = createPublishedSiteDataClient();
  if (!supabase) return null;

  const orderManagementTask = loadPublishedMerchantSnapshotSiteBySiteId(normalizedSiteId)
    .then((site) => Boolean(site?.permissionConfig?.allowProductBlock && site?.permissionConfig?.allowOrderManagement))
    .catch(() => false);
  const { data, error } = await queryPublishedPageRows(supabase, normalizedSiteId);
  if (error) {
    throw error;
  }

  const chosen = pickPublishedPageRow((data ?? []) as PublishedPageRow[]);
  if (!chosen || !isPublishedBlocksPayload(chosen.blocks)) {
    return null;
  }

  return {
    siteId: normalizedSiteId,
    slug: String(chosen.slug ?? "").trim(),
    blocks: chosen.blocks,
    orderManagementEnabled: await withFallbackTimeout(
      orderManagementTask,
      ORDER_MANAGEMENT_PERMISSION_TIMEOUT_MS,
      blocksContainProductBlock(chosen.blocks),
    ),
  };
}

export async function fetchPublishedSiteBlocksFromSupabase(siteId: string): Promise<PublishedSiteBlocksPayload | null> {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!isMerchantNumericId(normalizedSiteId)) return null;

  const cached = publishedSiteBlocksCache.get(normalizedSiteId);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.pending) return cached.pending;
    if ("value" in cached) return cached.value ?? null;
  }

  const pending = fetchPublishedSiteBlocksFromSupabaseUncached(normalizedSiteId);
  publishedSiteBlocksCache.set(normalizedSiteId, {
    expiresAt: Date.now() + PUBLISHED_SITE_BLOCKS_CACHE_TTL_MS,
    pending,
  });

  try {
    const value = await pending;
    publishedSiteBlocksCache.set(normalizedSiteId, {
      expiresAt:
        Date.now() + (value ? PUBLISHED_SITE_BLOCKS_CACHE_TTL_MS : PUBLISHED_SITE_BLOCKS_EMPTY_CACHE_TTL_MS),
      value,
    });
    return value;
  } catch (error) {
    publishedSiteBlocksCache.delete(normalizedSiteId);
    throw error;
  }
}

async function fetchPublishedSitePayloadFromSupabaseUncached(siteId: string): Promise<PublishedSitePayload | null> {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!isMerchantNumericId(normalizedSiteId)) return null;

  const supabase = createPublishedSiteDataClient();
  if (!supabase) return null;

  const publishedPagesTask = queryPublishedPageRows(supabase, normalizedSiteId);
  const merchantProfileTask = supabase
    .from("merchants")
    .select("name")
    .eq("id", normalizedSiteId)
    .limit(1)
    .maybeSingle();
  const serviceStateTask = loadPublishedMerchantServiceStateBySiteId(normalizedSiteId).catch(() => null);
  const snapshotSiteTask = loadPublishedMerchantSnapshotSiteBySiteId(normalizedSiteId).catch(() => null);

  const { data, error } = await publishedPagesTask;

  if (error) {
    throw error;
  }

  const chosen = pickPublishedPageRow((data ?? []) as PublishedPageRow[]);
  if (!chosen || !isPublishedBlocksPayload(chosen.blocks)) {
    return null;
  }

  const [merchantProfileResult, serviceState, snapshotSite] = await Promise.all([
    merchantProfileTask,
    serviceStateTask,
    snapshotSiteTask,
  ]);
  const merchantProfile = merchantProfileResult.data;
  const merchantName =
    String(snapshotSite?.merchantName ?? "").trim() ||
    String(snapshotSite?.name ?? "").trim() ||
    String((merchantProfile as MerchantProfileRow | null)?.name ?? "").trim();
  const orderManagementEnabled = Boolean(
    snapshotSite?.permissionConfig?.allowProductBlock && snapshotSite?.permissionConfig?.allowOrderManagement,
  );

  return {
    siteId: normalizedSiteId,
    slug: String(chosen.slug ?? "").trim(),
    merchantName,
    blocks: chosen.blocks,
    merchantProfile: snapshotSite,
    serviceState,
    orderManagementEnabled,
  };
}

export async function fetchPublishedSitePayloadFromSupabase(siteId: string): Promise<PublishedSitePayload | null> {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!isMerchantNumericId(normalizedSiteId)) return null;

  const cached = publishedSitePayloadCache.get(normalizedSiteId);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.pending) return cached.pending;
    if ("value" in cached) return cached.value ?? null;
  }

  const pending = fetchPublishedSitePayloadFromSupabaseUncached(normalizedSiteId);
  publishedSitePayloadCache.set(normalizedSiteId, {
    expiresAt: Date.now() + PUBLISHED_SITE_PAYLOAD_CACHE_TTL_MS,
    pending,
  });

  try {
    const value = await pending;
    publishedSitePayloadCache.set(normalizedSiteId, {
      expiresAt:
        Date.now() + (value ? PUBLISHED_SITE_PAYLOAD_CACHE_TTL_MS : PUBLISHED_SITE_PAYLOAD_EMPTY_CACHE_TTL_MS),
      value,
    });
    return value;
  } catch (error) {
    publishedSitePayloadCache.delete(normalizedSiteId);
    throw error;
  }
}
