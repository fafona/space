import SuperAdminEditorClient from "../SuperAdminEditorClient";
import { SUPER_ADMIN_EDITOR_BUILD_TOKEN } from "../buildToken";
import { loadPublishedPlatformHomeBlocks } from "@/lib/platformPublished";
import type { Block } from "@/data/homeBlocks";

export const dynamic = "force-dynamic";

export default async function LatestSuperAdminEditorPage() {
  const { blocks } = await loadPublishedPlatformHomeBlocks();
  const initialPublishedBlocks: Block[] = Array.isArray(blocks) ? blocks : [];
  return (
    <>
      <span className="sr-only" data-super-admin-editor-latest-ssr-build={SUPER_ADMIN_EDITOR_BUILD_TOKEN}>
        SUPER-ADMIN-EDITOR-LATEST-SSR-{SUPER_ADMIN_EDITOR_BUILD_TOKEN}
      </span>
      <SuperAdminEditorClient initialPublishedBlocks={initialPublishedBlocks} />
    </>
  );
}
