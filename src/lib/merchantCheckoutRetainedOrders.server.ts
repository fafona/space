import { checkoutReportingNeedsReview, parseCheckoutReportingSnapshot } from "./merchantCheckoutReporting";
import { MerchantCheckoutError } from "./merchantCheckoutQuote.server";
import type { MemberCheckoutResultRpc } from "./merchantMemberCheckoutResult.server";

export type CheckoutOrderSourceRows = Array<{ slug: string; blocks: unknown }>;
type Cue = { operationKey: string; record: Record<string, unknown> };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
function unavailable(): never { throw new MerchantCheckoutError("checkout_unavailable", 503); }

/** Trusted read-time CAS rows ONLY, never HTTP/normalized next records. A raw
 * marker is a reason to consult the ledger, not financial or owner authority.
 * Chunks supersede the obsolete aggregate root just as in the existing store. */
export function retainedCheckoutOrderCues(siteId: string, sourceRows: CheckoutOrderSourceRows): Map<string, Cue> {
  // Checkout identities use eight digits. Historical stores can have other
  // legacy IDs; do not impose the new identity grammar on an unmarked store.
  if (!/^\d{8}$/.test(siteId)) return new Map();
  const chunks = sourceRows.filter(r => new RegExp(`^__merchant_orders__:${siteId}:chunk:[0-9]+$`).test(r.slug));
  const rows = chunks.length ? chunks : sourceRows.filter(r => r.slug === `__merchant_orders__:${siteId}`);
  const records = rows.flatMap(r => Array.isArray(r.blocks) ? r.blocks : []);
  const cues = new Map<string, Cue>(), counts = new Map<unknown, number>();
  for (const record of records) if (object(record)) counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  for (const record of records) {
    if (!object(record) || !Object.hasOwn(record, "checkoutOperationKey")) continue;
    if (!id(record.id) || record.siteId !== siteId || typeof record.checkoutOperationKey !== "string" || !/^[a-f0-9]{64}$/.test(record.checkoutOperationKey)
      || counts.get(record.id) !== 1) unavailable();
    cues.set(record.id, { operationKey: record.checkoutOperationKey, record: structuredClone(record) });
  }
  if (cues.size && (new Set(rows.map(r => r.slug)).size !== rows.length || rows.some(r => !Array.isArray(r.blocks)))) unavailable();
  return cues;
}

/** Closing purchase gates must not erase existing financial boundaries.
 * Read-only v3 covers all existing receipt types; never retry an older report,
 * accept a missing receipt, or infer an ordinary/unpaid order on failure.
 * One 12-second budget spans every batch, including a transport that ignores
 * abort. The RPC factory is lazy; unmarked ordinary stores perform no IO. */
export async function verifyRetainedCheckoutOrders(siteId: string, cues: Map<string, Cue>, rpc: (signal?: AbortSignal) => MemberCheckoutResultRpc,
  externalSignal?: AbortSignal): Promise<Set<string>> {
  if (!cues.size) return new Set();
  const deadline = Date.now() + 12_000, signal = externalSignal ? AbortSignal.any([externalSignal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
  const guard = () => { if (signal.aborted || Date.now() >= deadline) unavailable(); };
  const linked = new Set<string>(), ids = [...cues.keys()];
  try {
    guard(); const call = rpc(signal); guard();
    for (let offset = 0; offset < ids.length; offset += 50) {
      guard();
      const scope = { siteId, resources: ids.slice(offset, offset + 50).map(id => ({ kind: "order" as const, id })) };
      let abort: () => void = () => {};
      const response = await Promise.race([Promise.resolve().then(() => { guard(); return call("faolla_member_checkout_reporting_v3", { p_site_id: siteId, p_resources: scope.resources }); }),
        new Promise<never>((_, reject) => { abort = () => reject(new Error("aborted")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); }),
      ]).finally(() => signal.removeEventListener("abort", abort));
      guard(); if (response.error) unavailable();
      const snapshot = parseCheckoutReportingSnapshot(response.data, scope);
      if (snapshot.version !== 3) unavailable();
      for (const row of snapshot.rows) {
        const cue = cues.get(row.id)!, result = row.cart ?? row.onSite ?? row.result;
        if (!result || result.operationKey !== cue.operationKey || checkoutReportingNeedsReview(row) || !result.resource
          || result.resource.status !== cue.record.status || result.resource.updatedAt !== cue.record.updatedAt) unavailable();
        linked.add(row.id);
      }
    }
    guard(); return linked;
  } catch { return unavailable(); }
}
