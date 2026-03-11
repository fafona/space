"use client";

import { useEffect } from "react";
import AdminClient from "../../admin/AdminClient";
import { buildPlatformHomeHref, PLATFORM_EDITOR_SCOPE } from "@/lib/siteRouting";
import { buildSuperAdminLoginHref, isSuperAdminAuthenticated, syncSuperAdminAuthenticatedCookie } from "@/lib/superAdminAuth";
import { useHydrated } from "@/lib/useHydrated";
import { SUPER_ADMIN_EDITOR_BUILD_TOKEN } from "./buildToken";

export default function SuperAdminEditorClient() {
  const hydrated = useHydrated();
  useEffect(() => {
    if (!hydrated) return;
    syncSuperAdminAuthenticatedCookie();
  }, [hydrated]);
  const ready = hydrated && isSuperAdminAuthenticated();
  const editorBuildLabel = `SUPER-ADMIN-EDITOR-${SUPER_ADMIN_EDITOR_BUILD_TOKEN}`;

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
          正在验证超级后台编辑权限...
        </div>
      </main>
    );
  }

  return (
    <>
      <span className="sr-only" data-super-admin-editor-client-build={editorBuildLabel}>
        {editorBuildLabel}
      </span>
      <AdminClient
        editorMode="platform"
        forceDesktopEditorSidebar
        forcedScope={PLATFORM_EDITOR_SCOPE}
        editorTitle={`Portal Visual Editor · ${SUPER_ADMIN_EDITOR_BUILD_TOKEN}`}
        frontendHref={buildPlatformHomeHref()}
      />
    </>
  );
}
