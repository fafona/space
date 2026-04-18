import { createClient } from "@supabase/supabase-js";
import type { Block } from "@/data/homeBlocks";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import type { PublishedMerchantServiceState } from "@/lib/publishedMerchantService";
import { loadCurrentMerchantSnapshotSiteBySiteId, loadPublishedMerchantServiceStateBySiteId } from "@/lib/publishedMerchantService";

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
  serviceState: PublishedMerchantServiceState | null;
  orderManagementEnabled: boolean;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
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

export async function fetchPublishedSitePayloadFromSupabase(siteId: string): Promise<PublishedSitePayload | null> {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!isMerchantNumericId(normalizedSiteId)) return null;

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });

  const initialQuery = await supabase
    .from("pages")
    .select("blocks,slug,updated_at,created_at")
    .eq("merchant_id", normalizedSiteId)
    .limit(20);

  let data = initialQuery.data as PublishedPageRow[] | null;
  let error = initialQuery.error;

  if (error && isMissingPublishedSlugColumn(error.message)) {
    const fallbackQuery = await supabase
      .from("pages")
      .select("blocks,updated_at,created_at")
      .eq("merchant_id", normalizedSiteId)
      .limit(20);
    data = fallbackQuery.data as PublishedPageRow[] | null;
    error = fallbackQuery.error;
  }

  if (error) {
    throw error;
  }

  const chosen = pickPublishedPageRow((data ?? []) as PublishedPageRow[]);
  if (!chosen || !isPublishedBlocksPayload(chosen.blocks)) {
    return null;
  }

  const { data: merchantProfile } = await supabase
    .from("merchants")
    .select("name")
    .eq("id", normalizedSiteId)
    .limit(1)
    .maybeSingle();
  const merchantName = String((merchantProfile as MerchantProfileRow | null)?.name ?? "").trim();
  const serviceState = await loadPublishedMerchantServiceStateBySiteId(normalizedSiteId).catch(() => null);
  const snapshotSite = await loadCurrentMerchantSnapshotSiteBySiteId(normalizedSiteId).catch(() => null);
  const orderManagementEnabled = Boolean(
    snapshotSite?.permissionConfig?.allowProductBlock && snapshotSite?.permissionConfig?.allowOrderManagement,
  );

  return {
    siteId: normalizedSiteId,
    slug: String(chosen.slug ?? "").trim(),
    merchantName,
    blocks: chosen.blocks,
    serviceState,
    orderManagementEnabled,
  };
}
