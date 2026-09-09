import {
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG,
  buildPlatformMerchantConfigArchiveBlocks,
  derivePlatformMerchantConfigArchiveEntries,
  mergePlatformMerchantConfigArchivePayloads,
  type PlatformMerchantConfigArchivePayload,
} from "@/lib/platformMerchantConfigArchive";
import {
  PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG,
  buildPlatformMerchantSnapshotBlocks,
  createPlatformMerchantSnapshotRevision,
  mergePlatformMerchantConfigHistoryBySiteId,
  normalizePlatformMerchantSnapshotPayload,
  type PlatformMerchantSnapshotPayload,
} from "@/lib/platformMerchantSnapshot";
import { mergePublishedMerchantSnapshots } from "@/lib/platformPublished";
import {
  assertPlatformAdminBackupMerchantSnapshot,
  readPlatformMerchantConfigArchiveBlocksValidated,
  readPlatformMerchantSnapshotBlocksValidated,
} from "@/lib/platformAdminBackupValidation";
import {
  PlatformSnapshotAtomicError,
  readPlatformSnapshotAtomic,
  commitPlatformSnapshotAtomic,
  parsePlatformSnapshotAtomicView,
  type PlatformSnapshotAtomicClient,
  type PlatformSnapshotAtomicView,
  type PlatformSnapshotAtomicWrite,
  type PlatformSnapshotJson,
} from "@/lib/platformSnapshotAtomic.server";

const snapshotSlugs = [PLATFORM_MERCHANT_SNAPSHOT_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG];
const archiveSlugs = [PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG, PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG];

/** Business copies and the untouched physical CAS vector must never be interchangeable. */
export type PlatformMerchantUserManageAtomicState = {
  view: PlatformSnapshotAtomicView;
  snapshot: PlatformMerchantSnapshotPayload | null;
  primarySnapshot: PlatformMerchantSnapshotPayload | null;
  archive: PlatformMerchantConfigArchivePayload;
};

function mergeHistory(primary: PlatformMerchantSnapshotPayload | null,
  ...fallbacks: Array<PlatformMerchantSnapshotPayload | null>): PlatformMerchantSnapshotPayload | null {
  const base = primary ?? fallbacks.find((item) => item !== null) ?? null;
  if (!base) return null;
  let history = base.merchantConfigHistoryBySiteId;
  for (const fallback of fallbacks) {
    if (fallback) history = mergePlatformMerchantConfigHistoryBySiteId(history, fallback.merchantConfigHistoryBySiteId);
  }
  return normalizePlatformMerchantSnapshotPayload({ ...base, merchantConfigHistoryBySiteId: history });
}

export function readPlatformMerchantUserManageAtomicView(input: PlatformSnapshotAtomicView): PlatformMerchantUserManageAtomicState {
  try {
    const view = parsePlatformSnapshotAtomicView("user_manage", input);
    const bySlug = new Map(view.rows.map((entry) => [entry.slug, entry.row]));
    const blocks = (slug: string) => {
      const row = bySlug.get(slug);
      if (row === undefined || (row !== null && !Array.isArray(row.blocks))) throw new Error("invalid_row");
      // Normalize business copies only. Keep raw id/blocks/timestamps intact for CAS.
      return row === null ? null : structuredClone(row.blocks as PlatformSnapshotJson[]);
    };
    const snapshots = snapshotSlugs.map((slug) => readPlatformMerchantSnapshotBlocksValidated(blocks(slug)));
    const archive = mergePlatformMerchantConfigArchivePayloads(
      ...archiveSlugs.map((slug) => readPlatformMerchantConfigArchiveBlocksValidated(blocks(slug))),
    );
    return { view, snapshot: mergeHistory(snapshots[0], ...snapshots.slice(1)), primarySnapshot: snapshots[0], archive };
  } catch { throw new PlatformSnapshotAtomicError("platform_snapshot_atomic_store_corrupt"); }
}

export async function readPlatformMerchantUserManageAtomic(
  client: PlatformSnapshotAtomicClient,
): Promise<PlatformMerchantUserManageAtomicState> {
  return readPlatformMerchantUserManageAtomicView(await readPlatformSnapshotAtomic(client, "user_manage"));
}

/** Builders intentionally contain optional object fields; mirror their JSON transport representation. */
function transportBlocks(blocks: unknown): PlatformSnapshotJson {
  return JSON.parse(JSON.stringify(blocks)) as PlatformSnapshotJson;
}

export type PlatformMerchantUserManageAtomicSaveResult =
  | { error: "platform_merchant_snapshot_conflict"; code: "conflict"; payload: PlatformMerchantSnapshotPayload | undefined }
  | { error: null; payload: PlatformMerchantSnapshotPayload; archive: PlatformMerchantConfigArchivePayload };

export async function savePlatformMerchantUserManageAtomic(
  client: PlatformSnapshotAtomicClient,
  payload: PlatformMerchantSnapshotPayload,
  expectedRevision: string | null | undefined,
): Promise<PlatformMerchantUserManageAtomicSaveResult> {
  if (expectedRevision === undefined || (expectedRevision !== null && typeof expectedRevision !== "string")) {
    throw new PlatformSnapshotAtomicError("platform_snapshot_atomic_invalid_request");
  }
  let incoming: PlatformMerchantSnapshotPayload;
  try {
    assertPlatformAdminBackupMerchantSnapshot(payload);
    // Capture caller input before awaiting the read: no delayed caller mutation can change this plan.
    incoming = normalizePlatformMerchantSnapshotPayload(structuredClone(payload));
  } catch { throw new PlatformSnapshotAtomicError("platform_snapshot_atomic_invalid_request"); }
  const state = await readPlatformMerchantUserManageAtomic(client);
  const existing = state.snapshot;
  if (String(expectedRevision ?? "").trim() !== String(existing?.revision ?? "").trim()) {
    return { error: "platform_merchant_snapshot_conflict", code: "conflict", payload: existing ?? undefined };
  }
  const current = existing ? mergePublishedMerchantSnapshots(incoming.snapshot, existing.snapshot) : incoming.snapshot;
  const ids = new Set(current.map((site) => site.id));
  const next = normalizePlatformMerchantSnapshotPayload({
    ...incoming,
    revision: createPlatformMerchantSnapshotRevision(),
    snapshot: [...current, ...(existing?.snapshot.filter((site) => !ids.has(site.id)) ?? [])],
    defaultSortRule: incoming.defaultSortRule || existing?.defaultSortRule,
    merchantConfigHistoryBySiteId: mergePlatformMerchantConfigHistoryBySiteId(
      incoming.merchantConfigHistoryBySiteId, existing?.merchantConfigHistoryBySiteId,
    ),
  });
  const delta = derivePlatformMerchantConfigArchiveEntries({ previousHistoryBySiteId: existing?.merchantConfigHistoryBySiteId,
    nextHistoryBySiteId: next.merchantConfigHistoryBySiteId, nextSnapshot: next.snapshot });
  const hasDelta = delta.audits.length > 0 || delta.backups.length > 0;
  const nextArchive = hasDelta ? mergePlatformMerchantConfigArchivePayloads(state.archive, delta) : state.archive;
  const currentBlocks = transportBlocks(buildPlatformMerchantSnapshotBlocks(next, { includeHistory: false }));
  const historyBlocks = transportBlocks(buildPlatformMerchantSnapshotBlocks(next));
  const archiveBlocks = transportBlocks(buildPlatformMerchantConfigArchiveBlocks(nextArchive));
  const emptyArchiveBlocks = transportBlocks(buildPlatformMerchantConfigArchiveBlocks({ audits: [], backups: [] }));
  const writes: PlatformSnapshotAtomicWrite[] = state.view.rows.map(({ slug, row }) => ({
    slug,
    blocks: archiveSlugs.includes(slug)
      // No new audit: preserve each existing copy byte-for-byte (including its original physical version).
      // The full-scope primitive creates a valid empty envelope for an absent archive row.
      ? !hasDelta ? row?.blocks ?? emptyArchiveBlocks : archiveBlocks
      : slug === PLATFORM_MERCHANT_SNAPSHOT_SLUG || slug === PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG
        ? currentBlocks : historyBlocks,
  }));
  const actual = readPlatformMerchantUserManageAtomicView(await commitPlatformSnapshotAtomic(client, "user_manage", state.view.rows, writes));
  if (!actual.snapshot) throw new PlatformSnapshotAtomicError("platform_snapshot_atomic_write_unconfirmed");
  return { error: null, payload: actual.snapshot, archive: actual.archive };
}

/** Store return values expose only fixed codes, never transport/SQL details. */
export function platformMerchantUserManageAtomicError(error: unknown): string {
  return error instanceof PlatformSnapshotAtomicError ? error.message : "platform_snapshot_atomic_write_unconfirmed";
}
