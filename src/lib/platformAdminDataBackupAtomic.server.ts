import {
  buildPlatformAdminDataBackupBlocks, mergePlatformAdminDataBackupPayloads,
  normalizePlatformAdminDataBackupPayload, type PlatformAdminDataBackupPayload,
} from "./platformAdminDataBackup";
import {
  assertPlatformAdminBackupCopiesConsistent, assertPlatformAdminBackupSavePayload,
  readPlatformAdminDataBackupBlocksValidated,
} from "./platformAdminBackupValidation";
import {
  readPlatformSnapshotAtomic, commitPlatformSnapshotAtomic, PlatformSnapshotAtomicError,
  type PlatformSnapshotAtomicClient, type PlatformSnapshotAtomicView, type PlatformSnapshotJson,
} from "./platformSnapshotAtomic.server";

export function readPlatformAdminDataBackupAtomicView(view: PlatformSnapshotAtomicView): PlatformAdminDataBackupPayload {
  if (view.scope !== "backup_catalog") throw new PlatformSnapshotAtomicError("platform_snapshot_atomic_invalid_request");
  const copies = view.rows.map(({ row }) => row ? row.blocks as unknown[] : null);
  assertPlatformAdminBackupCopiesConsistent(copies);
  return mergePlatformAdminDataBackupPayloads(...copies.map(readPlatformAdminDataBackupBlocksValidated));
}

export async function loadPlatformAdminDataBackupsAtomic(client: PlatformSnapshotAtomicClient): Promise<PlatformAdminDataBackupPayload> {
  return readPlatformAdminDataBackupAtomicView(await readPlatformSnapshotAtomic(client, "backup_catalog"));
}

function canonicalJson(value: unknown): string {
  const order = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(order)
    : entry !== null && typeof entry === "object" ? Object.fromEntries(Object.entries(entry)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, order(item)])) : entry;
  return JSON.stringify(order(value));
}

/** The caller supplies the business baseline it actually used to append/retain
 * backups; a fresh physical read alone cannot protect an already-stale plan.
 * This is catalog atomicity, NOT a multi-store consistent snapshot operation.
 */
export async function savePlatformAdminDataBackupsAtomic(
  client: PlatformSnapshotAtomicClient, payload: PlatformAdminDataBackupPayload,
  expectedPayload: PlatformAdminDataBackupPayload | undefined,
): Promise<PlatformAdminDataBackupPayload> {
  if (expectedPayload === undefined) throw new PlatformSnapshotAtomicError("platform_snapshot_atomic_baseline_required");
  assertPlatformAdminBackupSavePayload(payload); assertPlatformAdminBackupSavePayload(expectedPayload);
  // Freeze caller business values before any asynchronous read.
  const next = normalizePlatformAdminDataBackupPayload(JSON.parse(JSON.stringify(payload)));
  const baseline = canonicalJson(normalizePlatformAdminDataBackupPayload(expectedPayload));
  const view = await readPlatformSnapshotAtomic(client, "backup_catalog");
  const current = readPlatformAdminDataBackupAtomicView(view);
  if (canonicalJson(current) !== baseline) throw new PlatformSnapshotAtomicError("platform_snapshot_atomic_conflict");
  const nextBlocks = buildPlatformAdminDataBackupBlocks(next);
  // Existing backup IDs remain immutable, including copies omitted by retention.
  assertPlatformAdminBackupCopiesConsistent([
    ...view.rows.map(({ row }) => row ? row.blocks as unknown[] : null), nextBlocks,
  ]);
  const result = await commitPlatformSnapshotAtomic(client, "backup_catalog", view.rows,
    view.rows.map(({ slug }) => ({ slug, blocks: JSON.parse(JSON.stringify(nextBlocks)) as PlatformSnapshotJson })));
  return readPlatformAdminDataBackupAtomicView(result);
}
