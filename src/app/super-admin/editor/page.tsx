import SuperAdminEditorClient from "./SuperAdminEditorClient";
import { SUPER_ADMIN_EDITOR_BUILD_TOKEN } from "./buildToken";

export const dynamic = "force-dynamic";

export default function SuperAdminEditorPage() {
  return (
    <>
      <div className="pointer-events-none fixed left-4 top-14 z-[21001] rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
        SUPER-ADMIN-EDITOR-SSR-{SUPER_ADMIN_EDITOR_BUILD_TOKEN}
      </div>
      <SuperAdminEditorClient />
    </>
  );
}
