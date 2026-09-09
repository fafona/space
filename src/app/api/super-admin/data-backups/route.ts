import { createPlatformAdminDataBackupHandlers } from "@/lib/platformAdminDataBackupRoute";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { isSuperAdminRequestAuthorized, readSuperAdminAuthorizedSession } from "@/lib/superAdminRequestAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const handlers = createPlatformAdminDataBackupHandlers({
  authorize: isSuperAdminRequestAuthorized,
  readAuthorizedSession: readSuperAdminAuthorizedSession,
  createClient: createServerSupabaseServiceClient,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
