import { loadPublishedPlatformHomeBlocks } from "@/lib/platformPublished";
import { createPlatformPublishedGetHandler } from "@/lib/platformPublishedRoute.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export { isMissingPlatformMerchantIdColumn, isMissingPlatformSlugColumn } from "@/lib/platformPublished";

export const GET = createPlatformPublishedGetHandler(loadPublishedPlatformHomeBlocks);
