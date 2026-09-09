import { createPlatformAdminBackupRestoreInspectionGET } from "@/lib/platformAdminBackupRestoreInspectionRoute";
import { readSuperAdminAuthorizedSession } from "@/lib/superAdminRequestAuth";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const GET = createPlatformAdminBackupRestoreInspectionGET({
  readAuthorizedSession: readSuperAdminAuthorizedSession,
  createClient: createServerSupabaseServiceClient,
});
