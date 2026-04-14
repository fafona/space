"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SitePageClient from "@/app/site/[siteId]/SitePageClient";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import { useI18n } from "@/components/I18nProvider";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import { homeBlocks, type Block } from "@/data/homeBlocks";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import { trackPageView } from "@/lib/analytics";
import { readMerchantSessionMerchantIds, readMerchantSessionPayload } from "@/lib/authSessionRecovery";
import { MOBILE_BREAKPOINT } from "@/lib/deviceViewport";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { readRecentMerchantLaunchMerchantId } from "@/lib/merchantLaunchState";
import { cloneBlocks, getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { resolvePublishedSiteByPrefix } from "@/lib/publishedSiteLookup";
import { buildMerchantBackendHref, extractMerchantPrefixFromHost, resolveRuntimePortalBaseDomain } from "@/lib/siteRouting";
import { useMobileHorizontalScrollLock } from "@/lib/useMobileHorizontalScrollLock";

function readViewportWidth() {
  if (typeof window === "undefined") return 0;
  const visualViewportWidth = window.visualViewport?.width;
  if (typeof visualViewportWidth === "number" && Number.isFinite(visualViewportWidth) && visualViewportWidth > 0) {
    return visualViewportWidth;
  }
  const documentWidth = document.documentElement?.clientWidth;
  if (typeof documentWidth === "number" && Number.isFinite(documentWidth) && documentWidth > 0) {
    return documentWidth;
  }
  return window.innerWidth;
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function shouldSuppressStandaloneLaunchRedirect() {
  if (typeof window === "undefined") return false;
  try {
    return (new URLSearchParams(window.location.search || "").get("appShell") ?? "").trim().toLowerCase() === "faolla";
  } catch {
    return false;
  }
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

type HomePageClientProps = {
  initialBlocks: Block[];
  initialIsMobileViewport?: boolean;
};

export default function HomePageClient({
  initialBlocks,
  initialIsMobileViewport = false,
}: HomePageClientProps) {
  const { locale, t } = useI18n();
  const [platformState, setPlatformState] = useState(() => loadPlatformState());
  const [isMobileViewport, setIsMobileViewport] = useState(initialIsMobileViewport);
  const [suppressStandaloneLaunchRedirect] = useState(() =>
    typeof window !== "undefined" ? shouldSuppressStandaloneLaunchRedirect() : false,
  );
  const [standaloneSessionBooting] = useState(() =>
    typeof window !== "undefined" ? isStandaloneDisplayMode() && !shouldSuppressStandaloneLaunchRedirect() : false,
  );
  const [remoteHostLookup, setRemoteHostLookup] = useState<{ prefix: string; siteId: string }>({
    prefix: "",
    siteId: "",
  });
  const sourceBlocks = initialBlocks.length > 0 ? initialBlocks : homeBlocks;
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
      setIsMobileViewport(readViewportWidth() <= MOBILE_BREAKPOINT);
    };
    syncViewport();
    window.addEventListener("resize", syncViewport);
    window.visualViewport?.addEventListener("resize", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
      window.visualViewport?.removeEventListener("resize", syncViewport);
    };
  }, []);

  useMobileHorizontalScrollLock(isMobileViewport);

  useEffect(() => {
    if (!resolvedPageId) return;
    trackPageView(`home:${resolvedPageId}`);
  }, [resolvedPageId]);

  const activePage =
    activePlan?.pages?.find((page) => page.id === resolvedPageId) ??
    activePlan?.pages?.find((page) => page.id === activePlan.activePageId) ??
    activePlan?.pages?.[0];
  const activePageIndex = Math.max(0, activePlan?.pages?.findIndex((page) => page.id === activePage?.id) ?? 0);
  const activeBlocks = cloneBlocks(activePage?.blocks ?? activePlan?.blocks ?? sourceBlocks);
  const hostMatchedSite = useMemo(() => {
    if (typeof window === "undefined") return null;
    const mainSite = platformState.sites.find((site) => site.id === "site-main") ?? platformState.sites[0] ?? null;
    const portalBaseDomain = resolveRuntimePortalBaseDomain(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? mainSite?.domain ?? "");
    const hostPrefix = extractMerchantPrefixFromHost(window.location.host, portalBaseDomain);
    if (!hostPrefix) return null;
    return (
      platformState.sites.find(
        (site) =>
          site.id !== "site-main" &&
          normalizeDomainPrefix(site.domainPrefix ?? site.domainSuffix) === hostPrefix,
      ) ?? null
    );
  }, [platformState]);
  const hostPrefix = useMemo(() => {
    if (typeof window === "undefined") return "";
    const mainSite = platformState.sites.find((site) => site.id === "site-main") ?? platformState.sites[0] ?? null;
    const portalBaseDomain = resolveRuntimePortalBaseDomain(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? mainSite?.domain ?? "");
    return extractMerchantPrefixFromHost(window.location.host, portalBaseDomain);
  }, [platformState]);

  useEffect(() => {
    if (typeof window === "undefined" || hostMatchedSite || !hostPrefix) return;

    let mounted = true;
    void resolvePublishedSiteByPrefix(hostPrefix).then((resolved) => {
      if (!mounted) return;
      setRemoteHostLookup({
        prefix: hostPrefix,
        siteId: resolved?.siteId ?? "",
      });
    });
    return () => {
      mounted = false;
    };
  }, [hostMatchedSite, hostPrefix]);

  const resolvedHostSiteId = !hostMatchedSite && hostPrefix && remoteHostLookup.prefix === hostPrefix ? remoteHostLookup.siteId : "";
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (suppressStandaloneLaunchRedirect) return;
    if (!isStandaloneDisplayMode()) return;

    let mounted = true;
    void (async () => {
      try {
        const recentMerchantId = readRecentMerchantLaunchMerchantId();
        if (isMerchantNumericId(recentMerchantId)) {
          window.location.replace("/launch");
          return;
        }
        const payload = await readMerchantSessionPayload(2600).catch(() => null);
        if (!mounted) return;
        if (payload?.authenticated === true) {
          const merchantIds = readMerchantSessionMerchantIds(payload);
          const merchantId =
            merchantIds.find((value) => isMerchantNumericId(value)) ??
            merchantIds[0] ??
            (typeof payload.merchantId === "string" ? payload.merchantId.trim() : "");
          if (isMerchantNumericId(merchantId)) {
            window.location.replace(buildMerchantBackendHref(merchantId));
            return;
          }
        }
        window.location.replace("/login");
      } catch {
        if (!mounted) return;
        window.location.replace("/login");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [suppressStandaloneLaunchRedirect]);

  if (hostMatchedSite) {
    return <SitePageClient forcedSiteId={hostMatchedSite.id} initialIsMobileViewport={isMobileViewport} />;
  }

  if (resolvedHostSiteId) {
    return <SitePageClient forcedSiteId={resolvedHostSiteId} initialIsMobileViewport={isMobileViewport} />;
  }

  if (standaloneSessionBooting) {
    return (
      <LoadingProgressScreen
        locale={locale}
        statusTitle={
          locale.startsWith("zh")
            ? "欢迎使用 FAOLLA 愿您生意兴隆！"
            : "Welcome to FAOLLA. Wishing you a thriving business!"
        }
        statusDescription=""
      />
    );
  }

  return (
    <main
      className="min-h-screen w-full overflow-x-hidden bg-gray-50 py-8"
      style={{ ...pageBackgroundStyle, paddingBottom: `calc(2rem + ${backgroundExtendPadding}px)` }}
    >
      <div className="max-w-6xl mx-auto mb-4 flex items-center justify-end gap-2 px-6">
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
        currentPageIndex={activePageIndex}
        availablePages={activePlan?.pages?.map((page) => ({ id: page.id, name: page.name })) ?? []}
        bookingSiteId=""
        bookingSiteName={platformState.sites.find((site) => site.id === "site-main")?.merchantName ?? "总站首页"}
        bookingInteractive={false}
        onNavigatePage={(pageId) => {
          if (activePlan?.pages?.some((page) => page.id === pageId)) setCurrentPageId(pageId);
        }}
      />
    </main>
  );
}
