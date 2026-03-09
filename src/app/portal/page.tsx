"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import { useI18n } from "@/components/I18nProvider";
import {
  getPublishedBlocksSnapshot,
  savePublishedBlocksToStorage,
  subscribePublishedBlocksStore,
} from "@/data/blockStore";
import { type Block } from "@/data/homeBlocks";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { cloneBlocks, getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { PLATFORM_EDITOR_SCOPE } from "@/lib/siteRouting";
import { canReachSupabaseGateway, isSupabaseEnabled, supabase } from "@/lib/supabase";
import { useHydrated } from "@/lib/useHydrated";

const EMPTY_BLOCKS: Block[] = [];
const MOBILE_BREAKPOINT = 768;
const PORTAL_REMOTE_SETTLE_TIMEOUT_MS = 4000;

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingMerchantIdColumn(message: string) {
  return (
    /column\s+pages\.merchant_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]merchant_id['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function getEmbeddedMobilePlanConfig(sourceBlocks: Block[]) {
  const carrier = sourceBlocks.find(
    (block) => !!(block?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile,
  );
  const rawMobile = (carrier?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile;
  if (!rawMobile) return null;
  const cloned = cloneBlocks(sourceBlocks);
  const carrierIndex = cloned.findIndex(
    (block) => !!(block?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile,
  );
  if (carrierIndex >= 0) {
    cloned[carrierIndex] = {
      ...cloned[carrierIndex],
      props: {
        ...cloned[carrierIndex].props,
        pagePlanConfig: rawMobile as never,
      } as never,
    } as Block;
    delete (cloned[carrierIndex].props as { pagePlanConfigMobile?: unknown }).pagePlanConfigMobile;
  }
  return getPagePlanConfigFromBlocks(cloned);
}

export default function PortalPage() {
  const { t } = useI18n();
  const hydrated = useHydrated();
  const [remoteBlocks, setRemoteBlocks] = useState<Block[] | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [remoteSettled, setRemoteSettled] = useState<boolean>(() => !isSupabaseEnabled);
  const portalPublishedBlocks = useSyncExternalStore(
    (onChange) => subscribePublishedBlocksStore(onChange, PLATFORM_EDITOR_SCOPE),
    () => getPublishedBlocksSnapshot(EMPTY_BLOCKS, PLATFORM_EDITOR_SCOPE),
    () => EMPTY_BLOCKS,
  );
  const portalSourceBlocks = portalPublishedBlocks.length > 0 ? portalPublishedBlocks : (remoteBlocks ?? EMPTY_BLOCKS);
  const hasPortalVisualBlocks = portalSourceBlocks.length > 0;
  const [portalCurrentPageId, setPortalCurrentPageId] = useState("page-1");

  useEffect(() => {
    let mounted = true;
    if (!isSupabaseEnabled) {
      setRemoteSettled(true);
      return () => {
        mounted = false;
      };
    }

    setRemoteSettled(false);
    const settleTimer = setTimeout(() => {
      if (mounted) setRemoteSettled(true);
    }, PORTAL_REMOTE_SETTLE_TIMEOUT_MS);

    (async () => {
      try {
        const gatewayReady = await canReachSupabaseGateway(4000);
        if (!mounted || !gatewayReady) return;

        let bySlug = await supabase
          .from("pages")
          .select("blocks")
          .is("merchant_id", null)
          .eq("slug", "home")
          .limit(1)
          .maybeSingle();
        if (bySlug.error && isMissingMerchantIdColumn(bySlug.error.message)) {
          bySlug = await supabase.from("pages").select("blocks").eq("slug", "home").limit(1).maybeSingle();
        }
        if (!mounted) return;

        if (!bySlug.error && Array.isArray(bySlug.data?.blocks)) {
          const next = sanitizeBlocksForRuntime(bySlug.data.blocks as Block[]).blocks;
          setRemoteBlocks(next);
          savePublishedBlocksToStorage(next, PLATFORM_EDITOR_SCOPE);
          return;
        }

        if (!bySlug.error || !isMissingSlugColumn(bySlug.error.message)) {
          return;
        }
      } catch {
        // Keep local published content when backend is unavailable.
      } finally {
        clearTimeout(settleTimer);
        if (mounted) setRemoteSettled(true);
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(settleTimer);
    };
  }, []);

  useEffect(() => {
    const syncViewport = () => {
      setIsMobileViewport(window.innerWidth <= MOBILE_BREAKPOINT);
    };
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  const portalDesktopPlanConfig = useMemo(
    () => (hasPortalVisualBlocks ? getPagePlanConfigFromBlocks(portalSourceBlocks) : null),
    [hasPortalVisualBlocks, portalSourceBlocks],
  );
  const portalMobilePlanConfig = useMemo(
    () => (hasPortalVisualBlocks ? getEmbeddedMobilePlanConfig(portalSourceBlocks) : null),
    [hasPortalVisualBlocks, portalSourceBlocks],
  );
  const portalPlanConfig = isMobileViewport && portalMobilePlanConfig ? portalMobilePlanConfig : portalDesktopPlanConfig;
  const portalActivePlan =
    portalPlanConfig?.plans.find((plan) => plan.id === portalPlanConfig.activePlanId) ?? portalPlanConfig?.plans[0] ?? null;
  const portalResolvedPageId =
    portalActivePlan?.pages?.some((page) => page.id === portalCurrentPageId)
      ? portalCurrentPageId
      : portalActivePlan?.activePageId ?? "page-1";
  const portalActivePage =
    portalActivePlan?.pages?.find((page) => page.id === portalResolvedPageId) ??
    portalActivePlan?.pages?.find((page) => page.id === portalActivePlan.activePageId) ??
    portalActivePlan?.pages?.[0];
  const portalVisualBlocks: Block[] = portalActivePlan
    ? cloneBlocks(portalActivePage?.blocks ?? portalActivePlan?.blocks ?? portalSourceBlocks)
    : [];

  const portalBackgroundSource = portalVisualBlocks[0]?.props;
  const portalBackgroundStyle = getBackgroundStyle({
    imageUrl: portalBackgroundSource?.pageBgImageUrl,
    fillMode: portalBackgroundSource?.pageBgFillMode,
    position: portalBackgroundSource?.pageBgPosition,
    color: portalBackgroundSource?.pageBgColor,
    opacity: portalBackgroundSource?.pageBgOpacity,
    imageOpacity: portalBackgroundSource?.pageBgImageOpacity,
    colorOpacity: portalBackgroundSource?.pageBgColorOpacity,
  });
  const portalMaxBlockOffsetY = portalVisualBlocks.reduce((max, block) => {
    const value =
      typeof block.props.blockOffsetY === "number" && Number.isFinite(block.props.blockOffsetY)
        ? Math.round(block.props.blockOffsetY)
        : 0;
    return Math.max(max, value);
  }, 0);
  const portalBackgroundExtendPadding = Math.max(0, portalMaxBlockOffsetY) + 120;

  if (!hydrated || !remoteSettled) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-lg border bg-white p-4 text-sm text-slate-600">{t("common.loadingPortal")}</div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen py-8"
      style={
        hasPortalVisualBlocks
          ? { ...portalBackgroundStyle, paddingBottom: `calc(2rem + ${portalBackgroundExtendPadding}px)` }
          : undefined
      }
    >
      {hasPortalVisualBlocks ? (
        <section className="max-w-6xl mx-auto px-6">
          <BlockRenderer
            blocks={portalVisualBlocks}
            currentPageId={portalActivePage?.id}
            onNavigatePage={(pageId) => {
              if (portalActivePlan?.pages?.some((page) => page.id === pageId)) setPortalCurrentPageId(pageId);
            }}
          />
        </section>
      ) : (
        <section className="max-w-6xl mx-auto px-6">
          <div className="rounded-2xl border border-dashed bg-white p-6 text-sm text-slate-600">
            {t("portal.noPublish")}
          </div>
        </section>
      )}
    </main>
  );
}
