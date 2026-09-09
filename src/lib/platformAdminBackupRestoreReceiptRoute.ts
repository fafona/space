import { getPlatformSnapshotWriteMode } from "./platformSnapshotAtomicMode.server";
import { capturePlatformSnapshotRestoreReceiptBinding, platformSnapshotRestoreReceiptActorKey,
  publicPlatformSnapshotRestoreReceipt, readPlatformSnapshotRestoreReceipt } from "./platformSnapshotRestoreReceipt.server";
import type { PlatformSnapshotAtomicClient } from "./platformSnapshotAtomic.server";

type Dependencies = {
  readAuthorizedSession: (request: Request) => Promise<{ deviceId: string } | null>;
  createClient: () => unknown;
  readMode?: () => "atomic" | "off";
};
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store, max-age=0",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
}
/** Read-only capability. A missing receipt never authorizes a restore or resets
 * the client's unknown-write guard. There is deliberately no POST/PATCH here.
 */
export function createPlatformAdminBackupRestoreReceiptGET(dependencies: Dependencies) {
  return async function GET(request: Request) {
    let session;
    try { session = await dependencies.readAuthorizedSession(request); } catch { session = null; }
    if (!session) return json({ error: "unauthorized" }, 401);
    try {
      if ((dependencies.readMode ?? getPlatformSnapshotWriteMode)() !== "atomic") {
        return json({ error: "super_admin_backup_restore_receipt_unavailable" }, 503);
      }
    } catch { return json({ error: "super_admin_backup_restore_receipt_unavailable" }, 503); }
    let binding;
    try {
      const params = new URL(request.url).searchParams;
      const keys = ["operationId", "scope", "backupId", "confirmationToken"];
      if (params.size !== keys.length || keys.some((key) => params.getAll(key).length !== 1)) throw new Error("invalid");
      binding = capturePlatformSnapshotRestoreReceiptBinding({ ...Object.fromEntries(params),
        actorKey: platformSnapshotRestoreReceiptActorKey(session) });
    } catch { return json({ error: "super_admin_backup_restore_receipt_invalid_request" }, 400); }
    try {
      const client = dependencies.createClient();
      if (!client) return json({ error: "super_admin_backup_restore_receipt_unavailable" }, 503);
      const receipt = await readPlatformSnapshotRestoreReceipt(client as PlatformSnapshotAtomicClient, binding);
      return json({ ok: true, outcome: receipt ? "committed" : "unknown",
        receipt: receipt ? publicPlatformSnapshotRestoreReceipt(receipt) : null });
    } catch { return json({ error: "super_admin_backup_restore_receipt_lookup_unconfirmed" }, 503); }
  };
}
