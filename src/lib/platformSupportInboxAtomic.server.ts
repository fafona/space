import { randomUUID } from "node:crypto";
import { readPlatformSupportInboxBlocksValidated } from "@/lib/platformAdminBackupValidation";
import { resolveMerchantConversationDualWriteConfig } from "@/lib/merchantConversationDualWrite.server";
import { buildPlatformSupportInboxBlocks, mergePlatformSupportInboxPayloads,
  type PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";
import { commitPlatformSnapshotAtomic, readPlatformSnapshotAtomic, parsePlatformSnapshotAtomicView, PLATFORM_SNAPSHOT_ATOMIC_SCOPES,
  type PlatformSnapshotAtomicClient, type PlatformSnapshotAtomicView, type PlatformSnapshotAtomicWrite,
  type PlatformSnapshotJson } from "@/lib/platformSnapshotAtomic.server";
import type { MerchantSnapshotHistoryEntry, MerchantSnapshotHistoryPayload } from "@/lib/merchantSnapshotHistoryStore";

const scope = "support_messages";
const historySite = "platform-support-inbox";
const corrupt = "platform_snapshot_atomic_store_corrupt";
const safeErrors = new Set([corrupt, "platform_snapshot_atomic_invalid_request", "platform_snapshot_atomic_conflict",
  "platform_snapshot_atomic_write_unconfirmed", "platform_snapshot_atomic_configuration_invalid",
  "platform_snapshot_atomic_restore_unavailable", "platform_snapshot_atomic_shadow_unsupported"]);
export type PlatformSupportInboxAtomicOptions = { replace?: boolean; requireAllWrites?: boolean };
type PlatformSupportInboxAtomicHistoryOptions = { at?: string; historyId?: string };
export function platformSupportInboxAtomicErrorCode(error: unknown): string {
  return error instanceof Error && safeErrors.has(error.message) ? error.message : "platform_snapshot_atomic_write_unconfirmed";
}
function fail(code = corrupt): never { throw new Error(code); }
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))) fail();
  return value as Record<string, unknown>;
}
function json(value: unknown, depth = 0): string {
  if (depth > 64) fail();
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail();
    return `[${Array.from(value, (item) => json(item, depth + 1)).join(",")}]`;
  }
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, item]) => `${JSON.stringify(key)}:${json(item, depth + 1)}`).join(",")}}`;
}
function date(value: unknown): value is string { return typeof value === "string" && !!value.trim() && Number.isFinite(Date.parse(value)); }
function text(value: unknown): value is string { return typeof value === "string" && !!value.trim(); }
function history(value: unknown): MerchantSnapshotHistoryPayload {
  if (value === null) return { siteId: historySite, updatedAt: null, entries: [] };
  const raw = exact(value, ["siteId", "updatedAt", "entries"]);
  if (raw.siteId !== historySite || (raw.updatedAt !== null && !date(raw.updatedAt)) || !Array.isArray(raw.entries)) fail();
  const ids = new Set<string>();
  const entries = (raw.entries as unknown[]).map((item) => {
    const row = exact(item, ["id", "siteId", "at", "source", "before", "after"]);
    if (!text(row.id) || ids.has(row.id.trim()) || row.siteId !== historySite || !date(row.at) || !text(row.source)) fail();
    ids.add(row.id.trim()); json(row.before); json(row.after);
    return { id: row.id.trim(), siteId: historySite, at: row.at.trim(), source: row.source.trim(),
      before: structuredClone(row.before), after: structuredClone(row.after) };
  });
  return { siteId: historySite, updatedAt: raw.updatedAt as string | null, entries };
}
function support(value: unknown): PlatformSupportInboxPayload {
  try { return readPlatformSupportInboxBlocksValidated(value as unknown[] | null); } catch { return fail(); }
}
function inputPayload(value: unknown): PlatformSupportInboxPayload {
  return support([{ type: "common", props: { isPlatformSupportInbox: true, payload: value } }]);
}
function parse(view: PlatformSnapshotAtomicView) {
  const physical = parsePlatformSnapshotAtomicView(scope, view);
  const before = support(physical.rows[0].row?.blocks ?? null);
  const primary = history(physical.rows[1].row?.blocks ?? null);
  const backup = history(physical.rows[2].row?.blocks ?? null);
  const ids = new Map(primary.entries.map((entry) => [entry.id, entry]));
  for (const entry of backup.entries) {
    const current = ids.get(entry.id); if (current && json(current) !== json(entry)) fail();
  }
  return { before, primary, backup };
}
function makeHistory(current: MerchantSnapshotHistoryPayload, additions: MerchantSnapshotHistoryEntry[], now: number): MerchantSnapshotHistoryPayload {
  const entries = new Map<string, MerchantSnapshotHistoryEntry>();
  for (const entry of [...additions, ...current.entries]) entries.set(entry.id, entry);
  const sorted = [...entries.values()].sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || right.id.localeCompare(left.id, "en"));
  const stamp = Math.max(now, Date.parse(current.updatedAt ?? "") + 1 || 0, ...additions.map((entry) => Date.parse(entry.at)));
  return { siteId: historySite, updatedAt: new Date(stamp).toISOString(), entries: sorted.slice(0, 20) };
}

/** Validate all three physical copies without normalizing or mutating the CAS vector. */
export function readPlatformSupportInboxAtomicView(view: PlatformSnapshotAtomicView): PlatformSupportInboxPayload {
  return parse(view).before;
}

/** V1 shadow rows cannot join the application-snapshot restore transaction. */
export function assertPlatformSupportInboxAtomicRestoreAvailable(): void {
  const shadow = resolveMerchantConversationDualWriteConfig();
  if (shadow.mode === "shadow" && shadow.siteIds.length) fail("platform_snapshot_atomic_shadow_unsupported");
}

function preparePlan(
  view: PlatformSnapshotAtomicView, value: PlatformSupportInboxPayload,
  options: PlatformSupportInboxAtomicOptions & PlatformSupportInboxAtomicHistoryOptions,
): { payload: PlatformSupportInboxPayload; writes: PlatformSnapshotAtomicWrite[] } {
  const { before, primary, backup } = parse(view);
  const incoming = inputPayload(value);
  const target = options.replace ? incoming : mergePlatformSupportInboxPayloads(before, incoming);
  const at = options.at ?? new Date().toISOString(); if (!date(at)) fail("platform_snapshot_atomic_invalid_request");
  const entry: MerchantSnapshotHistoryEntry = { id: options.historyId ?? `${historySite}:${at}:platform-support-inbox:${randomUUID()}`,
    siteId: historySite, at, source: "platform-support-inbox", before: structuredClone(before), after: structuredClone(target) };
  if (!text(entry.id) || [...primary.entries, ...backup.entries].some((item) => item.id === entry.id)) fail("platform_snapshot_atomic_invalid_request");
  const now = Math.max(Date.now(), Date.parse(at));
  let nextPrimary: MerchantSnapshotHistoryPayload; let nextBackup: MerchantSnapshotHistoryPayload;
  if (options.requireAllWrites) {
    // Existing strict semantics: reconcile both histories, then save one shared tail.
    nextPrimary = makeHistory({ ...primary, updatedAt: new Date(Math.max(Date.parse(primary.updatedAt ?? "") || 0,
      Date.parse(backup.updatedAt ?? "") || 0)).toISOString() }, [entry, ...backup.entries], now);
    nextBackup = structuredClone(nextPrimary);
  } else {
    // Existing ordinary semantics: primary's own tail, then backup plus new primary.
    nextPrimary = makeHistory(primary, [entry], now);
    nextBackup = makeHistory(backup, nextPrimary.entries, now);
  }
  const physical = [buildPlatformSupportInboxBlocks(target), nextPrimary, nextBackup];
  const writes = PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope].map((slug, index) => ({ slug, blocks: physical[index] as unknown as PlatformSnapshotJson }));
  return { payload: target, writes };
}

/** Prepare business copies only. The view.rows physical CAS vector is never normalized or mutated. */
export function preparePlatformSupportInboxAtomic(
  view: PlatformSnapshotAtomicView, value: PlatformSupportInboxPayload,
  options: PlatformSupportInboxAtomicOptions & PlatformSupportInboxAtomicHistoryOptions = {},
): { payload: PlatformSupportInboxPayload; writes: PlatformSnapshotAtomicWrite[] } {
  if (options.replace) fail("platform_snapshot_atomic_restore_unavailable");
  return preparePlan(view, value, options);
}

/**
 * Construct the restore's three target rows only; this neither reads nor commits.
 * The authorized restore coordinator must bind the source catalog and physical
 * target vector in one transaction. It must not send this plan via normal save.
 */
export function preparePlatformSupportInboxRestoreAtomic(
  view: PlatformSnapshotAtomicView, backupInbox: PlatformSupportInboxPayload,
  options: PlatformSupportInboxAtomicHistoryOptions = {},
): { payload: PlatformSupportInboxPayload; writes: PlatformSnapshotAtomicWrite[] } {
  assertPlatformSupportInboxAtomicRestoreAvailable();
  return preparePlan(view, backupInbox, { at: options.at, historyId: options.historyId, replace: true, requireAllWrites: true });
}

export async function loadPlatformSupportInboxAtomic(client: PlatformSnapshotAtomicClient): Promise<PlatformSupportInboxPayload> {
  try { return parse(await readPlatformSnapshotAtomic(client, scope)).before; }
  catch (error) { throw new Error(platformSupportInboxAtomicErrorCode(error)); }
}

export async function savePlatformSupportInboxAtomic(
  client: PlatformSnapshotAtomicClient, value: PlatformSupportInboxPayload, options: PlatformSupportInboxAtomicOptions = {},
): Promise<{ error: string | null; payload: PlatformSupportInboxPayload | null }> {
  try {
    const requestOptions = { replace: options.replace, requireAllWrites: options.requireAllWrites };
    if (requestOptions.replace) fail("platform_snapshot_atomic_restore_unavailable");
    // V1 mirroring cannot join this three-page transaction. Do not commit pages
    // first or start a separate shadow RPC and call the combined result atomic.
    const shadow = resolveMerchantConversationDualWriteConfig();
    if (shadow.mode === "shadow" && shadow.siteIds.length) fail("platform_snapshot_atomic_shadow_unsupported");
    const incoming = inputPayload(value); // Capture before the first await.
    const view = await readPlatformSnapshotAtomic(client, scope);
    const plan = preparePlatformSupportInboxAtomic(view, incoming, requestOptions);
    const committed = await commitPlatformSnapshotAtomic(client, scope, view.rows, plan.writes);
    return { error: null, payload: parse(committed).before };
  } catch (error) { return { error: platformSupportInboxAtomicErrorCode(error), payload: null }; }
}
