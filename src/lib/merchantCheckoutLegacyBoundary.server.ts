import { createServerSupabaseServiceClient } from "./superAdminServer";
import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { resolveMerchantBusinessActor, type MerchantBusinessActor } from "./merchantBusinessActor.server";
import { checkoutPrincipalKey } from "./merchantCheckoutQuote.server";
import { parseMemberCheckoutCancellation, parseMemberCheckoutResult, type MemberCheckoutResult } from "./merchantMemberCheckoutResult";
import { cancelMemberCheckout, type MemberCheckoutResultRpc } from "./merchantMemberCheckoutResult.server";
import { parseCheckoutReportingSnapshot } from "./merchantCheckoutReporting";
import { normalizeMerchantOrderRecord, normalizeMerchantOrderRecords, type MerchantOrderRecord } from "./merchantOrders";
import { saveStoredMerchantOrders } from "./merchantOrdersStore";
import { commitMerchantOrderMembershipTransaction } from "./merchantOrderMembershipTransaction.server";
import { sanitizeMerchantBookingEditableInput, type MerchantBookingRecord } from "./merchantBookings";

const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const safeCodes = new Set(["checkout_not_found", "checkout_conflict", "checkout_cancellation_review_required", "checkout_cancellation_not_allowed", "checkout_cancellation_deadline",
  "checkout_resource_locked", "checkout_change_requires_review", "checkout_original_cancellation_required", "checkout_batch_requires_single", "checkout_unauthorized", "checkout_owner_required", "checkout_unconfirmed", "checkout_unavailable"]);
export class CheckoutLegacyBoundaryError extends Error {
  constructor(readonly code: string, readonly status: number = 409) { super(code); }
}
export function checkoutLegacyErrorDetails(error: unknown) {
  const code = error instanceof CheckoutLegacyBoundaryError ? error.code : error instanceof Error ? error.message : "";
  if (!safeCodes.has(code)) return null;
  const message = code === "checkout_batch_requires_single" ? "包含新结算记录，请逐笔取消并按原单规则退还。"
    : code === "checkout_change_requires_review" ? "本单已关联积分或券结算，暂不支持直接改价、换项目或改期，请先核对原单。"
      : code === "checkout_original_cancellation_required" ? "请从已登录账号取消原结算，不能直接取消或恢复这笔记录。"
        : code === "checkout_owner_required" ? "新结算记录的取消暂需商户负责人处理。"
          : code === "checkout_unauthorized" ? "请重新登录并核验原单所属账号。"
            : code === "checkout_cancellation_deadline" ? "已超过原单允许取消的时间，请联系商户核对。"
              : code === "checkout_unconfirmed" ? "取消结果尚未确认，请重新读取原单，不要另开一笔或重复扣减。"
                : code === "checkout_unavailable" ? "暂时无法核对原结算，请稍后重新读取，不要重复扣减。"
                  : "原结算或业务记录已变化，请重新读取并核对原单。";
  return { error: code, message, status: error instanceof CheckoutLegacyBoundaryError ? error.status : code === "checkout_unconfirmed" || code === "checkout_unavailable" ? 503 : 409 };
}
function rpc(): MemberCheckoutResultRpc {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new CheckoutLegacyBoundaryError("checkout_unavailable", 503);
  return (name, args) => client.rpc(name, args).abortSignal(AbortSignal.timeout(12_000));
}
function anyEnabled() {
  const sites = (process.env.MERCHANT_MEMBER_CHECKOUT_PILOT_SITES ?? "").split(",").map(v => v.trim());
  return sites.some(siteId => isMemberCheckoutPilotEnabled(siteId));
}
const defaults = { enabled: isMemberCheckoutPilotEnabled, anyEnabled, session: resolvePersonalAccountSessionFromRequest, actor: resolveMerchantBusinessActor, rpc };
export type CheckoutLegacyBoundaryDependencies = typeof defaults;
type Link = { siteId: string; kind: "booking" | "order"; id: string; operationKey: string; record: Record<string, unknown>; result: MemberCheckoutResult };
async function call(callRpc: MemberCheckoutResultRpc, name: string, args: Record<string, unknown>, writing = false) {
  try {
    const r = await callRpc(name, args);
    if (r.error) {
      const code = safeCodes.has(r.error.message ?? "") ? r.error.message! : writing ? "checkout_unconfirmed" : "checkout_unavailable";
      throw new CheckoutLegacyBoundaryError(code, code === "checkout_not_found" ? 404 : code === "checkout_unauthorized" ? 401 : code === "checkout_unconfirmed" || code === "checkout_unavailable" ? 503 : 409);
    }
    return r.data;
  } catch (error) {
    if (error instanceof CheckoutLegacyBoundaryError) throw error;
    throw new CheckoutLegacyBoundaryError(writing ? "checkout_unconfirmed" : "checkout_unavailable", 503);
  }
}
async function readLink(callRpc: MemberCheckoutResultRpc, scope: { siteId: string | null; kind: "booking" | "order"; id: string; principal: string | null }): Promise<Link | null> {
  const raw = await call(callRpc, "faolla_checkout_resource_link_v1", { p_site_id: scope.siteId, p_kind: scope.kind, p_id: scope.id, p_principal_key: scope.principal });
  if (raw === null) return null;
  try {
    if (!object(raw) || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId) || scope.siteId !== null && raw.siteId !== scope.siteId
      || raw.kind !== scope.kind || raw.id !== scope.id || typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey)
      || !object(raw.record) || raw.record.siteId !== raw.siteId || raw.record.id !== raw.id) throw new Error("invalid");
    const result = parseMemberCheckoutResult(raw.result, { siteId: raw.siteId, operationKey: raw.operationKey });
    if (result.resourceKind !== raw.kind || result.resourceId !== raw.id || !result.resource || raw.record.status !== result.resource.status || raw.record.updatedAt !== result.resource.updatedAt) throw new Error("invalid");
    if (scope.principal && (raw.record.customerAccountId !== scope.principal.split(":")[1] || raw.record.customerUserId !== scope.principal.split(":")[2])) throw new Error("invalid");
    return { siteId: raw.siteId, kind: scope.kind, id: scope.id, operationKey: raw.operationKey, record: raw.record, result };
  } catch { throw new CheckoutLegacyBoundaryError("checkout_unavailable", 503); }
}
function personalPrincipal(session: Awaited<ReturnType<typeof defaults.session>>) {
  const stamp = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
  return session && !session.servicePaused && typeof stamp === "string" && Number.isFinite(Date.parse(stamp)) ? checkoutPrincipalKey(session) : null;
}
function publicRecord(link: Link): MerchantBookingRecord | MerchantOrderRecord {
  if (link.kind === "order") {
    const order = normalizeMerchantOrderRecord(link.record as Partial<MerchantOrderRecord>);
    if (!order) throw new CheckoutLegacyBoundaryError("checkout_unconfirmed", 503);
    return order;
  }
  // Explicit public-field projection, not {...raw} minus known secrets.
  const record = link.record, editable = sanitizeMerchantBookingEditableInput(record);
  return { ...editable, id: link.id, siteId: link.siteId, siteName: typeof record.siteName === "string" ? record.siteName : "",
    status: link.result.resource!.status as MerchantBookingRecord["status"], createdAt: String(record.createdAt ?? ""), updatedAt: link.result.resource!.updatedAt,
    ...Object.fromEntries(["appointmentTimeZone", "bookingBlockId", "bookingViewport", "customerAccountId", "customerUserId", "customerLoginEmail", "merchantTouchedAt",
      "confirmedAt", "completedAt", "cancelledAt", "noShowMarkedAt", "customerEmailLogs", "timeline"].filter(k => Object.hasOwn(record, k)).map(k => [k, record[k]])) };
}
type BoundaryInput = {
  request: Request; mode: "personal" | "merchant"; siteId?: string; kind: "booking" | "order"; ids: string[];
  batch?: boolean;
  action?: string; status?: string; updates?: unknown; items?: unknown; bookingBlockId?: unknown; bookingViewport?: unknown; expectedUpdatedAt?: unknown;
  actor?: MerchantBusinessActor; assertAuthorizationCurrent?: () => Promise<void>;
};
function assertNoUnsupportedChange(link: Link, input: BoundaryInput) {
  const updates = object(input.updates) ? input.updates : {};
  const cancelling = input.action === "cancel" || input.status === "cancelled";
  if (input.items !== undefined || ["appointmentAt", "store", "item"].some(k => Object.hasOwn(updates, k) && updates[k] !== link.record[k])
    || input.bookingBlockId !== undefined && input.bookingBlockId !== link.record.bookingBlockId
    || input.bookingViewport !== undefined && input.bookingViewport !== link.record.bookingViewport
    || input.action !== undefined && input.status !== undefined && (input.action !== "cancel" || input.status !== "cancelled")
    || cancelling && Object.entries(updates).some(([key, value]) => value !== link.record[key])) throw new CheckoutLegacyBoundaryError("checkout_change_requires_review");
  if (link.result.closed && link.result.resource?.status !== "cancelled") throw new CheckoutLegacyBoundaryError("checkout_resource_locked");
  const status = input.status ?? (input.action === "restore" ? "active" : input.action === "uncomplete" || input.action === "confirm" ? "confirmed" : input.action === "complete" ? "completed" : undefined);
  if (link.result.closed && (status !== undefined && status !== "cancelled" || input.action === "update" || input.action === "restore")) throw new CheckoutLegacyBoundaryError("checkout_original_cancellation_required");
}

/** Compatibility bridge: null means use the UNCHANGED legacy path. Only an
 * original-ledger cancellation is intercepted. Never impersonate a customer
 * for merchant actions; the private SQL command audits the actual owner. */
export async function bridgeLegacyCheckoutMutation(input: BoundaryInput, overrides: Partial<CheckoutLegacyBoundaryDependencies> = {}): Promise<{ kind: "booking" | "order"; record: MerchantBookingRecord | MerchantOrderRecord } | null> {
  const deps = { ...defaults, ...overrides };
  if (input.siteId ? !deps.enabled(input.siteId) : !deps.anyEnabled()) return null;
  const scope = { ...input, ids: [...new Set(input.ids)], updates: input.updates === undefined ? undefined : structuredClone(input.updates), items: input.items === undefined ? undefined : structuredClone(input.items) };
  const ownerIdentity = scope.actor ? JSON.stringify([scope.actor.type, scope.actor.siteId, scope.actor.principalKey, scope.actor.authUserId, scope.actor.authorizationVersion]) : null;
  // New resource IDs always obey this grammar; old IDs need not. Do not
  // impose the new grammar on an unlinked legacy record or history batch.
  const eligibleIds = scope.ids.filter(id);
  if (!eligibleIds.length) return null;
  const callRpc = deps.rpc(), initialSession = scope.mode === "personal" ? await deps.session(scope.request) : null;
  let principal: string | null = null;
  if (scope.mode === "personal") {
    if (!initialSession) throw new CheckoutLegacyBoundaryError("checkout_unauthorized", 401);
    try { principal = checkoutPrincipalKey(initialSession); } catch { return null; } // cannot own a new checkout identity; preserve legacy behavior
  }
  const reauthorize = async () => {
    await scope.assertAuthorizationCurrent?.();
    if (scope.mode === "personal") {
      if (personalPrincipal(await deps.session(scope.request)) !== principal) throw new CheckoutLegacyBoundaryError("checkout_unauthorized", 401);
    } else {
      const current = await deps.actor(scope.request, { siteId: scope.siteId! });
      if (current.type !== "owner" || current.siteId !== scope.siteId
        || JSON.stringify([current.type, current.siteId, current.principalKey, current.authUserId, current.authorizationVersion]) !== ownerIdentity) throw new CheckoutLegacyBoundaryError("checkout_owner_required", 403);
    }
  };
  if (scope.batch || scope.ids.length > 1) {
    const linked = await linkedCheckoutOrderOrBookingIds(scope.siteId!, scope.kind, eligibleIds, callRpc);
    if (linked.size && (scope.action === "cancel" || scope.status === "cancelled" || scope.action === "restore" || scope.action === "uncomplete" || scope.items !== undefined || scope.updates !== undefined)) throw new CheckoutLegacyBoundaryError("checkout_batch_requires_single");
    return null; // final-state constraint still checks all original writers.
  }
  const lookup = { siteId: scope.siteId ?? null, kind: scope.kind, id: scope.ids[0], principal };
  const link = await readLink(callRpc, lookup);
  if (!link) return null;
  if (scope.mode === "personal" && personalPrincipal(initialSession) !== principal) throw new CheckoutLegacyBoundaryError("checkout_unauthorized", 401);
  if (!deps.enabled(link.siteId)) throw new CheckoutLegacyBoundaryError("checkout_resource_locked");
  assertNoUnsupportedChange(link, scope);
  const cancelling = scope.action === "cancel" || scope.status === "cancelled";
  if (!cancelling) return null;
  await reauthorize();
  if (scope.expectedUpdatedAt !== undefined && scope.expectedUpdatedAt !== link.result.resource!.updatedAt && !link.result.closed) throw new CheckoutLegacyBoundaryError("checkout_conflict");
  if (!link.result.closed) {
    try {
      if (scope.mode === "personal") await cancelMemberCheckout({ siteId: link.siteId, operationKey: link.operationKey, principalKey: principal!, expectedUpdatedAt: link.result.resource!.updatedAt }, callRpc);
      else {
        const raw = await call(callRpc, "faolla_checkout_merchant_cancel_v1", { p_site_id: link.siteId, p_operation_key: link.operationKey,
          p_actor_key: JSON.parse(ownerIdentity!)[2], p_expected_updated_at: link.result.resource!.updatedAt }, true);
        if (!object(raw) || typeof raw.replayed !== "boolean" || !object(raw.receipt) || raw.receipt.siteId !== link.siteId || raw.receipt.operationKey !== link.operationKey || raw.receipt.closed !== true) throw new Error("invalid");
        const c = parseMemberCheckoutCancellation(raw.receipt);
        if (c.pointsReturned > link.result.totalPoints || c.couponsReturned > link.result.couponCount) throw new Error("invalid");
      }
      await reauthorize();
      const final = await readLink(callRpc, lookup);
      if (!final || final.operationKey !== link.operationKey || !final.result.closed || final.result.resource?.status !== "cancelled") throw new Error("unconfirmed");
      await reauthorize();
      return { kind: final.kind, record: publicRecord(final) };
    } catch (error) {
      if (error instanceof CheckoutLegacyBoundaryError && error.status === 409) throw error;
      if (error instanceof Error && safeCodes.has(error.message) && ["checkout_conflict", "checkout_cancellation_review_required", "checkout_cancellation_not_allowed", "checkout_cancellation_deadline"].includes(error.message)) throw new CheckoutLegacyBoundaryError(error.message);
      throw new CheckoutLegacyBoundaryError("checkout_unconfirmed", 503);
    }
  }
  // A confirmed cancelled original is a read-only replay, not a new write.
  await reauthorize(); return { kind: link.kind, record: publicRecord(link) };
}

async function linkedCheckoutOrderOrBookingIds(siteId: string, kind: "booking" | "order", ids: string[], callRpc: MemberCheckoutResultRpc) {
  const linked = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const scope = { siteId, resources: ids.slice(offset, offset + 50).map(id => ({ kind, id })) };
    const raw = await call(callRpc, "faolla_member_checkout_reporting_v1", { p_site_id: siteId, p_resources: scope.resources });
    let snapshot;
    try { snapshot = parseCheckoutReportingSnapshot(raw, scope); } catch { throw new CheckoutLegacyBoundaryError("checkout_unavailable", 503); }
    for (const row of snapshot.rows) if (row.result) linked.add(row.id);
  }
  return linked;
}
/** New points/coupon orders have already applied their own growth/point plan.
 * Completing them must not normalize/save the legacy membership store again. */
export async function legacyCheckoutPointTransitions<T extends { previous: MerchantOrderRecord; next: MerchantOrderRecord }>(transitions: T[], overrides: Partial<Pick<CheckoutLegacyBoundaryDependencies, "enabled" | "rpc">> = {}): Promise<T[]> {
  if (!transitions.some(t => (t.previous.status === "completed") !== (t.next.status === "completed"))) return transitions;
  const sites = new Set(transitions.map(t => t.next.siteId));
  const deps = { enabled: isMemberCheckoutPilotEnabled, rpc, ...overrides };
  if (sites.size !== 1 || !deps.enabled(transitions[0].next.siteId)) return transitions;
  const linked = await linkedCheckoutOrderOrBookingIds(transitions[0].next.siteId, "order", [...new Set(transitions.map(t => t.next.id))], deps.rpc());
  return transitions.filter(t => !linked.has(t.next.id));
}

/** An old save normalizes the WHOLE store. For linked records, preserve the
 * original immutable cart and unknown fields from the CAS source rows when
 * only operational metadata changed. Never silently discard a requested item
 * change, invent a replacement cart, or use a browser-provided receipt. The
 * final SQL constraint still validates the authoritative ledger in the commit. */
export async function preserveCheckoutOrderStorage(siteId: string, next: MerchantOrderRecord[], expectedRows: Array<{ slug: string; blocks: unknown }>,
  overrides: Partial<Pick<CheckoutLegacyBoundaryDependencies, "enabled" | "rpc">> = {}): Promise<MerchantOrderRecord[]> {
  const deps = { enabled: isMemberCheckoutPilotEnabled, rpc, ...overrides };
  if (!deps.enabled(siteId)) return next;
  const ids = next.map(r => r.id).filter(id);
  if (!ids.length) return next;
  const linked = await linkedCheckoutOrderOrBookingIds(siteId, "order", [...new Set(ids)], deps.rpc());
  if (!linked.size) return next;
  const chunks = expectedRows.filter(row => new RegExp(`^__merchant_orders__:${siteId}:chunk:[0-9]+$`).test(row.slug));
  const rows = chunks.length ? chunks : expectedRows.filter(row => row.slug === `__merchant_orders__:${siteId}`);
  const originals = rows.flatMap(row => { if (!Array.isArray(row.blocks)) throw new CheckoutLegacyBoundaryError("checkout_unavailable", 503); return row.blocks; });
  return next.map(record => {
    if (!linked.has(record.id)) return record;
    const matches = originals.filter(r => object(r) && r.id === record.id && r.siteId === siteId);
    if (matches.length !== 1) throw new CheckoutLegacyBoundaryError("checkout_resource_locked");
    const original = matches[0] as Record<string, unknown>, baseline = normalizeMerchantOrderRecord(original as Partial<MerchantOrderRecord>);
    if (!baseline || JSON.stringify(record.items) !== JSON.stringify(baseline.items) || record.totalQuantity !== baseline.totalQuantity
      || record.totalAmount !== baseline.totalAmount || record.pricePrefix !== baseline.pricePrefix) throw new CheckoutLegacyBoundaryError("checkout_change_requires_review");
    // Existing records not involved in this action must not gain normalized
    // defaults, lose unknown fields or be silently repaired as a side effect.
    if (JSON.stringify(record) === JSON.stringify(baseline)) return structuredClone(original) as MerchantOrderRecord;
    return { ...original, ...record, items: original.items, totalQuantity: original.totalQuantity, totalAmount: original.totalAmount } as MerchantOrderRecord;
  });
}

/** Keep the proven legacy storage module intact. Only server-side mutations
 * of an enabled pilot use the snapshot-aware adapter; it commits through the
 * SAME CAS transaction, never direct page writes or a second financial call. */
export async function saveCheckoutAwareMerchantOrders(client: Parameters<typeof saveStoredMerchantOrders>[0], input: Parameters<typeof saveStoredMerchantOrders>[1],
  overrides: Partial<Pick<CheckoutLegacyBoundaryDependencies, "enabled" | "rpc">> = {}): Promise<{ error: string | null }> {
  const deps = { enabled: isMemberCheckoutPilotEnabled, rpc, ...overrides }, siteId = input.siteId.trim();
  if (!deps.enabled(siteId)) return saveStoredMerchantOrders(client, input);
  if (!Array.isArray(input.expectedRows)) return { error: "order_update_conflict" };
  const next = await preserveCheckoutOrderStorage(siteId, normalizeMerchantOrderRecords(input.orders), input.expectedRows, deps);
  return commitMerchantOrderMembershipTransaction(client, siteId, {
    orders: { expectedRows: input.expectedRows, next },
    ...(input.memberships ? { memberships: input.memberships } : {}),
  });
}
