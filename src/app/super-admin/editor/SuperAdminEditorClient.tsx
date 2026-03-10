"use client";

import { useEffect } from "react";
import AdminClient from "../../admin/AdminClient";
import { PLATFORM_EDITOR_SCOPE } from "@/lib/siteRouting";
import { buildSuperAdminLoginHref, isSuperAdminAuthenticated } from "@/lib/superAdminAuth";
import { useHydrated } from "@/lib/useHydrated";

export default function SuperAdminEditorClient() {
  const hydrated = useHydrated();
  const ready = hydrated && isSuperAdminAuthenticated();

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
    <AdminClient
      editorMode="platform"
      forceDesktopEditorSidebar
      forcedScope={PLATFORM_EDITOR_SCOPE}
      editorTitle="Portal Visual Editor"
      frontendHref="/portal"
    />
  );
}
