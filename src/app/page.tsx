"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import SitePageClient from "@/app/site/[siteId]/SitePageClient";
import {
  loadPublishedBlocksFromStorage,
} from "@/data/blockStore";
import { homeBlocks, type Block } from "@/data/homeBlocks";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import { trackPageView } from "@/lib/analytics";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { cloneBlocks, getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { extractMerchantPrefixFromHost } from "@/lib/siteRouting";
import {
  canReachSupabaseGateway,
  isSupabaseEnabled,
  supabase,
} from "@/lib/supabase";
import { useHydrated } from "@/lib/useHydrated";
import { useI18n } from "@/components/I18nProvider";

const MOBILE_BREAKPOINT = 768;
const MIN_INITIAL_LOADING_MS = 0;

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

export default function HomePage() {
  const { t } = useI18n();
  const hydrated = useHydrated();
  const [platformState, setPlatformState] = useState(() => loadPlatformState());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [dbBlocks, setDbBlocks] = useState<Block[] | null>(null);
  const [localBlocks, setLocalBlocks] = useState<Block[] | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const sourceBlocks = dbBlocks ?? localBlocks ?? homeBlocks;
  const desktopPlanConfig = getPagePlanConfigFromBlocks(sourceBlocks);
  const mobilePlanConfig = getEmbeddedMobilePlanConfig(sourceBlocks);
  const planConfig = isMobileViewport && mobilePlanConfig ? mobilePlanConfig : desktopPlanConfig;
  const activePlan = planConfig.plans.find((plan) => plan.id === planConfig.activePlanId) ?? planConfig.plans[0];
  const [currentPageId, setCurrentPageId] = useState<string>(activePlan?.activePageId ?? "page-1");
  const resolvedPageId =
    activePlan?.pages?.some((page) => page.id === currentPageId) ? currentPageId : activePlan?.activePageId ?? "page-1";

  useEffect(() => {
    return subscribePlatformState(() => {
      setPlatformState(loadPlatformState());
    });
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

  useEffect(() => {
    if (!resolvedPageId) return;
    trackPageView(`home:${resolvedPageId}`);
  }, [resolvedPageId]);

  useEffect(() => {
    let mounted = true;
    const loadingTimer = setTimeout(() => {
      if (mounted) setIsInitialLoading(false);
    }, MIN_INITIAL_LOADING_MS);
    if (!isSupabaseEnabled) {
      return () => {
        mounted = false;
        clearTimeout(loadingTimer);
      };
    }

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
          setDbBlocks(next);
          return;
        }

        if (!bySlug.error || !isMissingSlugColumn(bySlug.error.message)) {
          return;
        }
      } catch {
        // Keep local rendered content when backend is unavailable.
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(loadingTimer);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      const loaded = loadPublishedBlocksFromStorage(homeBlocks);
      setLocalBlocks(loaded);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [hydrated]);

  const activePage =
    activePlan?.pages?.find((page) => page.id === resolvedPageId) ??
    activePlan?.pages?.find((page) => page.id === activePlan.activePageId) ??
    activePlan?.pages?.[0];
  const activeBlocks = cloneBlocks(activePage?.blocks ?? activePlan?.blocks ?? sourceBlocks);
  const hostMatchedSite = useMemo(() => {
    if (typeof window === "undefined") return null;
    const mainSite = platformState.sites.find((site) => site.id === "site-main") ?? platformState.sites[0] ?? null;
    const hostPrefix = extractMerchantPrefixFromHost(
      window.location.host,
      process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? mainSite?.domain ?? "",
    );
    if (!hostPrefix) return null;
    return (
      platformState.sites.find(
        (site) =>
          site.id !== "site-main" &&
          normalizeDomainPrefix(site.domainPrefix ?? site.domainSuffix) === hostPrefix,
      ) ?? null
    );
  }, [platformState]);
  const pageBackgroundSource = activeBlocks[0]?.props;
  const pageBackgroundStyle = getBackgroundStyle({
    imageUrl: pageBackgroundSource?.pageBgImageUrl,
    fillMode: pageBackgroundSource?.pageBgFillMode,
    position: pageBackgroundSource?.pageBgPosition,
    color: pageBackgroundSource?.pageBgColor,
    opacity: pageBackgroundSource?.pageBgOpacity,
    imageOpacity: pageBackgroundSource?.pageBgImageOpacity,
    colorOpacity: pageBackgroundSource?.pageBgColorOpacity,
  });
  const maxBlockOffsetY = activeBlocks.reduce((max, block) => {
    const value =
      typeof block.props.blockOffsetY === "number" && Number.isFinite(block.props.blockOffsetY)
        ? Math.round(block.props.blockOffsetY)
        : 0;
    return Math.max(max, value);
  }, 0);
  const backgroundExtendPadding = Math.max(0, maxBlockOffsetY) + 160;

  if (!hydrated || isInitialLoading) {
    return <LoadingProgressScreen message={t("common.loadingPage")} />;
  }

  if (hostMatchedSite) {
    return <SitePageClient forcedSiteId={hostMatchedSite.id} />;
  }

  return (
    <main
      className="min-h-screen bg-gray-50 py-8"
      style={{ ...pageBackgroundStyle, paddingBottom: `calc(2rem + ${backgroundExtendPadding}px)` }}
    >
      <div className="max-w-6xl mx-auto px-6 mb-4 flex items-center justify-end gap-2">
        <Link
          href="/login"
          className="inline-flex items-center rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100"
        >
          {t("common.adminLogin")}
        </Link>
      </div>
      <BlockRenderer
        blocks={activeBlocks}
        currentPageId={activePage?.id}
        onNavigatePage={(pageId) => {
          if (activePlan?.pages?.some((page) => page.id === pageId)) setCurrentPageId(pageId);
        }}
      />
    </main>
  );
}

