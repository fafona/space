"use client";

import { useEffect } from "react";
import AdminClient from "../../admin/AdminClient";
import { buildPlatformHomeHref, PLATFORM_EDITOR_SCOPE } from "@/lib/siteRouting";
import { buildSuperAdminLoginHref, refreshSuperAdminAuthenticatedState } from "@/lib/superAdminAuth";
import { useHydrated } from "@/lib/useHydrated";
import { SUPER_ADMIN_EDITOR_BUILD_TOKEN } from "./buildToken";
import type { Block } from "@/data/homeBlocks";
import { useState } from "react";

type SuperAdminEditorClientProps = {
  initialPublishedBlocks?: Block[];
};

export default function SuperAdminEditorClient({ initialPublishedBlocks }: SuperAdminEditorClientProps) {
  const hydrated = useHydrated();
  const [ready, setReady] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      const authenticated = await refreshSuperAdminAuthenticatedState();
      if (cancelled) return;
      setReady(authenticated);
      setAuthChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);
  const editorBuildLabel = `SUPER-ADMIN-EDITOR-${SUPER_ADMIN_EDITOR_BUILD_TOKEN}`;

  useEffect(() => {
    if (!hydrated || !authChecked) return;
    if (!ready) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = buildSuperAdminLoginHref(next);
    }
  }, [authChecked, hydrated, ready]);

  if (!hydrated || !authChecked || !ready) {
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
        showPublishActions
        forcedScope={PLATFORM_EDITOR_SCOPE}
        editorTitle={`Portal Visual Editor · ${SUPER_ADMIN_EDITOR_BUILD_TOKEN}`}
        frontendHref={buildPlatformHomeHref()}
        initialPublishedBlocks={initialPublishedBlocks}
      />
    </>
  );
}
