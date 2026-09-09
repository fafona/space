import {
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG,
  buildPlatformMerchantConfigArchiveBlocks,
  normalizePlatformMerchantConfigArchivePayload,
  type PlatformMerchantConfigArchivePayload,
} from "@/lib/platformMerchantConfigArchive";
import {
  PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
  buildPlatformMerchantSnapshotBlocks,
  createPlatformMerchantSnapshotRevision,
  mergePlatformMerchantConfigHistoryBySiteId,
  normalizePlatformMerchantSnapshotPayload,
  type PlatformMerchantSnapshotPayload,
} from "@/lib/platformMerchantSnapshot";
import { mergePublishedMerchantSnapshots } from "@/lib/platformPublished";
import { assertPlatformAdminBackupMerchantSnapshot, assertPlatformAdminBackupMerchantConfigArchive } from "@/lib/platformAdminBackupValidation";
import { readPlatformMerchantUserManageAtomicView } from "@/lib/platformMerchantUserManageAtomic.server";
import { PlatformSnapshotAtomicError, type PlatformSnapshotAtomicView,
  type PlatformSnapshotAtomicWrite, type PlatformSnapshotJson } from "@/lib/platformSnapshotAtomic.server";

export type PlatformMerchantUserManageRestoreAtomicPlan = {
  writes: PlatformSnapshotAtomicWrite[];
  snapshot: PlatformMerchantSnapshotPayload;
  archive: PlatformMerchantConfigArchivePayload;
};

/** Pure target planner only: the restore protocol separately binds the selected
 * backup catalog and these target rows in one transaction. This function neither
 * authorizes a restore nor reads, commits, caches, or retries anything.
 */
export function preparePlatformMerchantUserManageRestoreAtomic(
  view: PlatformSnapshotAtomicView,
  backupSnapshot: PlatformMerchantSnapshotPayload | null,
  archiveOverride: PlatformMerchantConfigArchivePayload,
): PlatformMerchantUserManageRestoreAtomicPlan {
  // Validate all physical and business copies, including apparently unused backups.
  const current = readPlatformMerchantUserManageAtomicView(view);
  let incoming: PlatformMerchantSnapshotPayload;
  let archive: PlatformMerchantConfigArchivePayload;
  try {
    if (backupSnapshot !== null) assertPlatformAdminBackupMerchantSnapshot(backupSnapshot);
    assertPlatformAdminBackupMerchantConfigArchive(archiveOverride);
    incoming = normalizePlatformMerchantSnapshotPayload(structuredClone(backupSnapshot ?? {
      revision: "", snapshot: [], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {},
    }));
    archive = normalizePlatformMerchantConfigArchivePayload(structuredClone(archiveOverride));
  } catch { throw new PlatformSnapshotAtomicError("platform_snapshot_atomic_invalid_request"); }

  // Preserve the old restore's directory/history MERGE: absent merchants and
  // blank field fallbacks are retained; this is not a directory replacement.
  const existing = current.snapshot;
  const merged = existing ? mergePublishedMerchantSnapshots(incoming.snapshot, existing.snapshot) : incoming.snapshot;
  const ids = new Set(merged.map((site) => site.id));
  const snapshot = normalizePlatformMerchantSnapshotPayload({
    ...incoming,
    revision: createPlatformMerchantSnapshotRevision(),
    snapshot: [...merged, ...(existing?.snapshot.filter((site) => !ids.has(site.id)) ?? [])],
    defaultSortRule: incoming.defaultSortRule || existing?.defaultSortRule,
    merchantConfigHistoryBySiteId: mergePlatformMerchantConfigHistoryBySiteId(
      incoming.merchantConfigHistoryBySiteId, existing?.merchantConfigHistoryBySiteId,
    ),
  });
  const transport = (blocks: unknown): PlatformSnapshotJson => JSON.parse(JSON.stringify(blocks));
  const currentBlocks = transport(buildPlatformMerchantSnapshotBlocks(snapshot, { includeHistory: false }));
  const historyBlocks = transport(buildPlatformMerchantSnapshotBlocks(snapshot));
  // Legacy restore saved the derived archive and then REPLACED it with this
  // supplied archive. Build that exact final state without the intermediate writes.
  const archiveBlocks = transport(buildPlatformMerchantConfigArchiveBlocks(archive));
  const writes = current.view.rows.map(({ slug }) => ({ slug, blocks: structuredClone(
    slug === PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG || slug === PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG
      ? archiveBlocks
      : slug === PLATFORM_MERCHANT_SNAPSHOT_SLUG || slug === PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG
        ? currentBlocks : historyBlocks,
  ) }));
  return { writes, snapshot, archive };
}
