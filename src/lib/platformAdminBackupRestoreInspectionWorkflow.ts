import { capturePlatformAdminBackupRestoreReceiptBinding } from "./platformAdminBackupRestoreReceiptClient";
import { readRestoreJournal, type RestoreJournalStorage } from "./platformAdminBackupRestoreJournal";
import { readPlatformAdminBackupRestoreIdentityOnce, type PlatformAdminBackupRestoreReceiptAttempt } from "./platformAdminBackupRestoreReceiptWorkflow";
import { inspectPlatformAdminBackupRestoreOnce } from "./platformAdminBackupRestoreInspectionClient";

/** Explicit inspection of a retained operation, no lock release or application.
 * A journal change or identity change at either side invalidates the whole report.
 */
export async function inspectPlatformAdminBackupRestoreForAttempt(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  input: PlatformAdminBackupRestoreReceiptAttempt,
  storage: RestoreJournalStorage | null,
  signal?: AbortSignal,
) {
  const binding = capturePlatformAdminBackupRestoreReceiptBinding(input.binding);
  const deviceId = input.deviceId;
  const attempt = { binding, deviceId };
  const matches = () => {
    const journal = readRestoreJournal(storage);
    if (signal?.aborted || journal.status !== "pending" || JSON.stringify(journal.attempt) !== JSON.stringify(attempt)) {
      throw new Error("super_admin_backup_restore_inspection_continuity_unconfirmed");
    }
  };
  matches();
  await readPlatformAdminBackupRestoreIdentityOnce(fetcher, { expected: deviceId, signal });
  matches();
  const result = await inspectPlatformAdminBackupRestoreOnce(fetcher, binding, { signal });
  await readPlatformAdminBackupRestoreIdentityOnce(fetcher, { expected: deviceId, signal });
  matches();
  return result;
}
