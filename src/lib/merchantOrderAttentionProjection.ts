import {
  normalizeMerchantOrderAttentionCandidate,
  parseMerchantOrderAttentionSummary,
  summarizeMerchantOrderAttentionRecords,
  type MerchantOrderAttentionSummary,
} from "@/lib/merchantOrderAttention";
import { mergeStoredMerchantOrdersRows } from "@/lib/merchantOrdersStore";

export const MERCHANT_ORDER_ATTENTION_MAX_SOURCE_ROWS = 512;
export const MERCHANT_ORDER_ATTENTION_MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export type MerchantOrderAttentionProjectionResult =
  | { supported: true; attention: MerchantOrderAttentionSummary }
  | {
      supported: false;
      reason: "invalid_source" | "source_limit" | "site_mismatch" | "invalid_record" | "unsupported_timestamp" | "unsupported_preview";
    };

/**
 * Pure, bounded projection of a read-time pages snapshot. No client, writes,
 * timers or logs. Rows MUST retain the existing query's slug ASC, id ASC order:
 * mergeStoredMerchantOrdersRows uses stable order when chunk indexes tie.
 * Never deduplicate after filtering pending orders: first-ID-wins comes first.
 */
export function buildMerchantOrderAttentionProjection(
  input: unknown,
  siteId: string,
): MerchantOrderAttentionProjectionResult {
  if (!/^\d+$/.test(siteId) || !Array.isArray(input)) return { supported: false, reason: "invalid_source" };
  if (input.length > MERCHANT_ORDER_ATTENTION_MAX_SOURCE_ROWS) return { supported: false, reason: "source_limit" };
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MERCHANT_ORDER_ATTENTION_MAX_SOURCE_BYTES) {
      return { supported: false, reason: "source_limit" };
    }
  } catch {
    return { supported: false, reason: "invalid_source" };
  }
  const rootSlug = `__merchant_orders__:${siteId}`;
  const chunkSlug = new RegExp(`^${rootSlug}:chunk:(\\d+)$`);
  const rows: { id: string | number; slug: string; blocks: unknown[]; updated_at: unknown }[] = [];
  let hasChunks = false;
  for (const inputRow of input) {
    if (!inputRow || typeof inputRow !== "object" || Array.isArray(inputRow)) return { supported: false, reason: "invalid_source" };
    const row = inputRow as Record<string, unknown>;
    if (row.merchant_id !== siteId) return { supported: false, reason: "site_mismatch" };
    if ((typeof row.id !== "string" || !row.id.trim()) &&
        (typeof row.id !== "number" || !Number.isSafeInteger(row.id))) return { supported: false, reason: "invalid_source" };
    if (typeof row.slug !== "string" || !Array.isArray(row.blocks)) return { supported: false, reason: "invalid_source" };
    const match = chunkSlug.exec(row.slug);
    if (row.slug !== rootSlug && (!match || !Number.isSafeInteger(Number(match[1])))) {
      return { supported: false, reason: "invalid_source" };
    }
    hasChunks ||= Boolean(match);
    rows.push({ id: row.id as string | number, slug: row.slug, blocks: row.blocks, updated_at: row.updated_at });
  }
  for (const row of rows) {
    // The original store ignores the legacy root as soon as any chunk exists.
    if (hasChunks && row.slug === rootSlug) continue;
    for (const inputRecord of row.blocks) {
      const candidate = normalizeMerchantOrderAttentionCandidate(inputRecord, siteId);
      if (!candidate.supported) return candidate;
    }
  }
  const merged = mergeStoredMerchantOrdersRows(siteId, rows);
  const attention = summarizeMerchantOrderAttentionRecords(merged?.orders ?? [], siteId);
  const parsed = parseMerchantOrderAttentionSummary(attention, siteId);
  return parsed ? { supported: true, attention: parsed } : { supported: false, reason: "invalid_record" };
}
