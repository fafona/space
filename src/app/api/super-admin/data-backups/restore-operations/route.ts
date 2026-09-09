import { createPlatformAdminBackupRestoreReceiptGET } from "@/lib/platformAdminBackupRestoreReceiptRoute";
import { readSuperAdminAuthorizedSession } from "@/lib/superAdminRequestAuth";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const GET = createPlatformAdminBackupRestoreReceiptGET({
  readAuthorizedSession: readSuperAdminAuthorizedSession,
  createClient: createServerSupabaseServiceClient,
});
