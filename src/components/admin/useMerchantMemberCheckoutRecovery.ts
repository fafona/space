"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import { createMemberCheckoutRecoveryController } from "@/lib/merchantMemberCheckoutRecovery";

export function useMerchantMemberCheckoutRecovery(options: {
  siteId: string; enabled: boolean; requestApi: MerchantBusinessApiClient; scope: object;
}) {
  const { siteId, enabled, requestApi, scope } = options;
  const controller = useMemo(() => createMemberCheckoutRecoveryController({ siteId, enabled, requestApi, scope }),
    [siteId, enabled, requestApi, scope]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    void controller.activate();
    const refresh = () => {
      if (document.visibilityState !== "hidden") void controller.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.deactivate();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [controller]);
  return { controller, snapshot };
}
