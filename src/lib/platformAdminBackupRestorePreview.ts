import type { PlatformAdminDataBackupRestoreScope } from "./platformAdminDataBackup";

/** Public, count-only preview. A content token is not an authentication credential or a database lock. */
export type PlatformAdminBackupRestorePreview = {
  version: 1;
  backupId: string;
  backupAt: string;
  scope: PlatformAdminDataBackupRestoreScope;
  confirmationToken: string;
  /** Present only when the server uses the identity-bound durable receipt protocol. */
  receiptProtocol?: 1;
  counts: Array<{
    key: string;
    label: string;
    current: number | null;
    target: number;
    source: "server" | "browser";
  }>;
  requiresEmptyConfirmation: boolean;
  emptyKeys: string[];
  excluded: string[];
  warning: string;
};
