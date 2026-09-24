import { parseMerchantOrderAttentionSummary, type MerchantOrderAttentionSummary } from "@/lib/merchantOrderAttention";
import { buildMerchantOrderAttentionProjection } from "@/lib/merchantOrderAttentionProjection";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

const PILOT_SITE = "10000000";
const EPOCH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERATION = /^(0|[1-9][0-9]{0,18})$/;

export type OrderAttentionRpcClient = {
  rpc: (name: string, parameters: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function hasRevision(value: Record<string, unknown>) {
  return typeof value.epoch === "string" && EPOCH.test(value.epoch)
    && typeof value.generation === "string" && GENERATION.test(value.generation)
    && BigInt(value.generation) <= BigInt("9223372036854775807");
}

/** Caller must authorize the current merchant OWNER before invoking this. */
export async function readMerchantOrderAttentionSummary(
  client: OrderAttentionRpcClient,
  siteId: string,
  signal?: AbortSignal,
): Promise<MerchantOrderAttentionSummary | null> {
  if (siteId !== PILOT_SITE || signal?.aborted) return null;
  try {
    const read = await client.rpc("faolla_read_order_attention_v1", { p_site_id: siteId, p_source: false });
    if (signal?.aborted || read.error) return null;
    const snapshot = object(read.data);
    if (!snapshot || !hasRevision(snapshot)) return null;
    if (snapshot.state === "ready") return parseMerchantOrderAttentionSummary(snapshot.payload, siteId);
    if (snapshot.state !== "source" || snapshot.enabled !== true) return null;
    const projection = buildMerchantOrderAttentionProjection(snapshot.rows, siteId);
    if (!projection.supported || signal?.aborted) return null;
    const published = await client.rpc("faolla_publish_order_attention_v1", {
      p_site_id: siteId,
      p_epoch: snapshot.epoch,
      p_generation: snapshot.generation,
      p_payload: projection.attention,
    });
    if (signal?.aborted || published.error) return null;
    const result = object(published.data);
    // No speculative success after an ambiguous transport result and no blind
    // replay of a stale projection. The caller retains its legacy read path.
    if (result?.state !== "published" || result.epoch !== snapshot.epoch
      || result.generation !== snapshot.generation) return null;
    return projection.attention;
  } catch {
    // Never log raw source, customer details, RPC arguments or SQL errors.
    // Missing/dirty/unsupported is unavailable, never a synthetic zero badge.
    return null;
  }
}

export async function loadMerchantOrderAttentionSummary(
  siteId: string,
  signal?: AbortSignal,
): Promise<MerchantOrderAttentionSummary | null> {
  if (siteId !== PILOT_SITE || process.env.FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID !== PILOT_SITE || signal?.aborted) {
    return null;
  }
  const budget = AbortSignal.timeout(6000);
  const boundedSignal = signal ? AbortSignal.any([signal, budget]) : budget;
  const client = createServerSupabaseServiceClient({
    fetch: (input, init) => fetch(input, { ...init, signal: boundedSignal }),
  });
  return client ? readMerchantOrderAttentionSummary(client, siteId, boundedSignal) : null;
}
