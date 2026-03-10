import SuperAdminEditorClient from "./SuperAdminEditorClient";
import { SUPER_ADMIN_EDITOR_BUILD_TOKEN } from "./buildToken";

export const dynamic = "force-dynamic";

export default function SuperAdminEditorPage() {
  return (
    <>
      <span
        className="sr-only"
        data-super-admin-editor-ssr-build={SUPER_ADMIN_EDITOR_BUILD_TOKEN}
      >
        SUPER-ADMIN-EDITOR-SSR-{SUPER_ADMIN_EDITOR_BUILD_TOKEN}
      </span>
      <SuperAdminEditorClient />
    </>
  );
}
