"use client";

import { useEffect } from "react";
import AdminClient from "../../admin/AdminClient";
import { PLATFORM_EDITOR_SCOPE } from "@/lib/siteRouting";
import { buildSuperAdminLoginHref, isSuperAdminAuthenticated } from "@/lib/superAdminAuth";
import { useHydrated } from "@/lib/useHydrated";

export default function SuperAdminEditorClient() {
  const hydrated = useHydrated();
  const ready = hydrated && isSuperAdminAuthenticated();
  const editorBuildLabel = "SUPER-ADMIN-EDITOR-V3";

  useEffect(() => {
    if (!hydrated) return;
    if (!ready) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = buildSuperAdminLoginHref(next);
    }
  }, [hydrated, ready]);

  if (!hydrated || !ready) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-lg border bg-white p-4 text-sm text-slate-600">
          正在验证总后台编辑权限...
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="pointer-events-none fixed left-4 top-4 z-[21000] rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 shadow-sm">
        {editorBuildLabel}
      </div>
      <AdminClient
        editorMode="platform"
        forceDesktopEditorSidebar
        forcedScope={PLATFORM_EDITOR_SCOPE}
        editorTitle="Portal Visual Editor"
        frontendHref="/portal"
      />
    </>
  );
}
