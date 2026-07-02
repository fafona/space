"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import FaollaPullRefreshIndicator from "@/components/FaollaPullRefreshIndicator";
import FrontendAuthEntry from "@/components/FrontendAuthEntry";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import MerchantMembershipEntry from "@/components/MerchantMembershipEntry";
import ServiceMaintenancePage from "@/components/ServiceMaintenancePage";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import {
  loadPublishedBlocksFromStorage,
  savePublishedBlocksToStorage,
} from "@/data/blockStore";
import { type Block } from "@/data/homeBlocks";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { MOBILE_BREAKPOINT } from "@/lib/deviceViewport";
import { cloneBlocks, getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { PUBLISH_SYNC_STORAGE_KEY, subscribePublishSync } from "@/lib/publishSync";
import { buildPlatformHomeHref, buildSiteStoreScope } from "@/lib/siteRouting";
import {
  getResolvedSupabaseUrl,
  isSupabaseEnabled,
  resolvedSupabaseAnonKey,
  supabase,
} from "@/lib/supabase";
import { useHydrated } from "@/lib/useHydrated";
import { useMobileHorizontalScrollLock } from "@/lib/useMobileHorizontalScrollLock";
import usePullToRefresh from "@/lib/usePullToRefresh";

const EMPTY_BLOCKS: Block[] = [];
const MIN_INITIAL_LOADING_MS = 0;
const SITE_REMOTE_FETCH_TIMEOUT_MS = 25000;
const SITE_REMOTE_SETTLE_TIMEOUT_MS = 26000;
const SITE_REMOTE_FALLBACK_DELAY_MS = 650;

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

function isFaollaAppShell() {
  if (typeof window === "undefined") return false;
  try {
    return (new URLSearchParams(window.location.search || "").get("appShell") ?? "").trim().toLowerCase() === "faolla";
  } catch {
    return false;
  }
}

function getDocumentScrollElement() {
  if (typeof document === "undefined") return null;
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
}

function reloadCurrentDocumentAfterPull() {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      window.location.reload();
      resolve();
    }, 160);
  });
}

function getPublishedScopeCandidates(siteId: string, siteScope: string) {
  const normalizedSiteId = (siteId ?? "").trim();
  const normalizedScope = (siteScope ?? "").trim() || "default";
  const candidates: string[] = [normalizedScope];

  if (normalizedSiteId) {
    const directScope = normalizedSiteId;
    const prefixedScope = `site-${normalizedSiteId}`;
    if (!candidates.includes(directScope)) candidates.push(directScope);
    if (!candidates.includes(prefixedScope)) candidates.push(prefixedScope);
    if (normalizedSiteId.startsWith("site-")) {
      const unprefixed = normalizedSiteId.slice("site-".length).trim();
      if (unprefixed && !candidates.includes(unprefixed)) candidates.push(unprefixed);
    }
  }
  if (normalizedSiteId === "site-main" && !candidates.includes("default")) {
    candidates.push("default");
  }
  return candidates;
}

function loadPublishedWithFallback(siteId: string, siteScope: string) {
  const candidates = getPublishedScopeCandidates(siteId, siteScope);
  for (const scope of candidates) {
    const scoped = loadPublishedBlocksFromStorage([], scope);
    if (scoped.length > 0) {
      if (scope !== siteScope) {
        savePublishedBlocksToStorage(scoped, siteScope);
      }
      return scoped;
    }
  }
  return [] as Block[];
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(300, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delayNull(timeoutMs: number) {
  return new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), Math.max(0, timeoutMs));
  });
}

type PublishedSiteBlocksFetchResult = {
  blocks: Block[];
  orderManagementEnabled?: boolean;
};

function toPublishedSiteBlocksFetchResult(
  blocks: Block[] | null,
  orderManagementEnabled?: boolean,
): PublishedSiteBlocksFetchResult | null {
  if (!blocks || blocks.length === 0) return null;
  return typeof orderManagementEnabled === "boolean" ? { blocks, orderManagementEnabled } : { blocks };
}

async function firstNonNullPublishedSiteResult(tasks: Promise<PublishedSiteBlocksFetchResult | null>[]) {
  if (tasks.length === 0) return null;
  return new Promise<PublishedSiteBlocksFetchResult | null>((resolve) => {
    let pending = tasks.length;
    let settled = false;
    const settleNull = () => {
      pending -= 1;
      if (!settled && pending <= 0) {
        settled = true;
        resolve(null);
      }
    };
    tasks.forEach((task) => {
      task
        .then((value) => {
          if (settled) return;
          if (value?.blocks?.length) {
            settled = true;
            resolve(value);
            return;
          }
          settleNull();
        })
        .catch(() => {
          settleNull();
        });
    });
  });
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

function getInitialVisiblePageId(
  plan:
    | {
        activePageId?: string;
        pages?: Array<{ id: string }>;
      }
    | null
    | undefined,
) {
  const pages = Array.isArray(plan?.pages) ? plan.pages : [];
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const requestedPageId = (params.get("couponPageId") || params.get("pageId") || params.get("page") || "").trim();
      if (requestedPageId && pages.some((page) => page.id === requestedPageId)) return requestedPageId;
    } catch {
      // Fall back to the first public page when the URL cannot be parsed.
    }
  }
  const firstPage = pages.find((page) => page.id === "page-1") ?? pages[0];
  return firstPage?.id ?? "page-1";
}

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

async function fetchPublishedSiteBlocksViaRest(siteId: string) {
  const base = getResolvedSupabaseUrl().trim().replace(/\/+$/, "");
  if (!base || !siteId) return null;
  const queryOne = async (slug?: string) => {
    const query = new URLSearchParams({
      select: "blocks",
      merchant_id: `eq.${siteId}`,
      limit: "1",
    });
    if (slug) query.set("slug", `eq.${slug}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SITE_REMOTE_FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        apikey: resolvedSupabaseAnonKey,
        Authorization: `Bearer ${resolvedSupabaseAnonKey}`,
      };
      const response = await fetch(`${base}/rest/v1/pages?${query.toString()}`, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const json = (await response.json()) as unknown;
      if (!Array.isArray(json) || json.length === 0) return null;
      const first = json[0] as { blocks?: unknown };
      if (!Array.isArray(first?.blocks)) return null;
      const sanitized = sanitizeBlocksForRuntime(first.blocks as Block[]).blocks;
      return sanitized.length > 0 ? sanitized : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const byHome = await queryOne("home");
  if (byHome) return byHome;
  return queryOne();
}

async function fetchPublishedSiteBlocksViaApi(siteId: string): Promise<PublishedSiteBlocksFetchResult | null> {
  if (!siteId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITE_REMOTE_FETCH_TIMEOUT_MS);
  try {
    const query = new URLSearchParams({
      siteId,
      t: String(Date.now()),
    });
    const response = await fetch(`/api/site-published?${query.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const json = (await response.json().catch(() => null)) as { blocks?: unknown; orderManagementEnabled?: unknown } | null;
    if (!Array.isArray(json?.blocks)) return null;
    const sanitized = sanitizeBlocksForRuntime(json.blocks as Block[]).blocks;
    return toPublishedSiteBlocksFetchResult(
      sanitized,
      typeof json.orderManagementEnabled === "boolean" ? json.orderManagementEnabled : undefined,
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPublishedSiteBlocksViaSdk(siteId: string) {
  let result = await supabase.from("pages").select("blocks").eq("merchant_id", siteId).eq("slug", "home").limit(1).maybeSingle();
  if (result.error && isMissingSlugColumn(result.error.message)) {
    result = await supabase.from("pages").select("blocks").eq("merchant_id", siteId).limit(1).maybeSingle();
  } else if (!result.error && !Array.isArray(result.data?.blocks)) {
    result = await supabase.from("pages").select("blocks").eq("merchant_id", siteId).limit(1).maybeSingle();
  }
  if (!result.error && Array.isArray(result.data?.blocks)) {
    const sanitized = sanitizeBlocksForRuntime(result.data.blocks as Block[]).blocks;
    if (sanitized.length > 0) return sanitized;
  }
  return null;
}

async function fetchPublishedSiteBlocksFast(siteId: string): Promise<PublishedSiteBlocksFetchResult | null> {
  const apiTask = withTimeout(fetchPublishedSiteBlocksViaApi(siteId), SITE_REMOTE_FETCH_TIMEOUT_MS);
  if (!isSupabaseEnabled) return apiTask;

  const fastApiBlocks = await Promise.race([apiTask, delayNull(SITE_REMOTE_FALLBACK_DELAY_MS)]);
  if (fastApiBlocks) return fastApiBlocks;

  const restTask = withTimeout(fetchPublishedSiteBlocksViaRest(siteId), SITE_REMOTE_FETCH_TIMEOUT_MS).then((blocks) =>
    toPublishedSiteBlocksFetchResult(blocks),
  );
  const firstBlocks = await firstNonNullPublishedSiteResult([apiTask, restTask]);
  if (firstBlocks) return firstBlocks;

  return withTimeout(fetchPublishedSiteBlocksViaSdk(siteId), SITE_REMOTE_FETCH_TIMEOUT_MS).then((blocks) =>
    toPublishedSiteBlocksFetchResult(blocks),
  );
}

type SitePageClientProps = {
  forcedSiteId?: string;
  initialIsMobileViewport?: boolean;
  initialPublishedBlocks?: Block[];
  initialMerchantName?: string;
  initialOrderManagementEnabled?: boolean;
};

export function SitePageClient({
  forcedSiteId,
  initialIsMobileViewport = false,
  initialPublishedBlocks = EMPTY_BLOCKS,
  initialMerchantName = "",
  initialOrderManagementEnabled,
}: SitePageClientProps = {}) {
  const params = useParams<{ siteId?: string }>();
  const routeSiteId = typeof params?.siteId === "string" ? params.siteId : "";
  const siteId = (forcedSiteId ?? routeSiteId).trim();
  const siteScope = siteId ? buildSiteStoreScope(siteId) : "default";

  const hydrated = useHydrated();
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(initialIsMobileViewport);
  const [platformState, setPlatformState] = useState(() => loadPlatformState());
  const hasInitialPublishedBlocks = initialPublishedBlocks.length > 0;
  const [dbBlocks, setDbBlocks] = useState<Block[] | null>(() => (hasInitialPublishedBlocks ? initialPublishedBlocks : null));
  const [scopedPublishedBlocksLocal, setScopedPublishedBlocksLocal] = useState<Block[] | null>(() =>
    hasInitialPublishedBlocks ? initialPublishedBlocks : null,
  );
  const [remoteOrderManagementEnabled, setRemoteOrderManagementEnabled] = useState<boolean | null>(() =>
    typeof initialOrderManagementEnabled === "boolean" ? initialOrderManagementEnabled : null,
  );
  const [remoteResolved, setRemoteResolved] = useState(hasInitialPublishedBlocks);
  const faollaAppShell = hydrated ? isFaollaAppShell() : false;

  const effectiveScopedPublishedBlocks = scopedPublishedBlocksLocal ?? EMPTY_BLOCKS;
  const hasScopedLocalBlocks = effectiveScopedPublishedBlocks.length > 0;
  const sourceBlocks = dbBlocks ?? (hasScopedLocalBlocks ? effectiveScopedPublishedBlocks : EMPTY_BLOCKS);
  const hasRenderableBlocks = sourceBlocks.length > 0;

  const desktopPlanConfig = getPagePlanConfigFromBlocks(sourceBlocks);
  const mobilePlanConfig = getEmbeddedMobilePlanConfig(sourceBlocks);
  const planConfig = isMobileViewport && mobilePlanConfig ? mobilePlanConfig : desktopPlanConfig;
  const activePlan = planConfig.plans.find((plan) => plan.id === planConfig.activePlanId) ?? planConfig.plans[0];
  const [currentPageId, setCurrentPageId] = useState<string>(getInitialVisiblePageId(activePlan));
  const resolvedPageId =
    activePlan?.pages?.some((page) => page.id === currentPageId) ? currentPageId : getInitialVisiblePageId(activePlan);
  const activePage =
    activePlan?.pages?.find((page) => page.id === resolvedPageId) ??
    activePlan?.pages?.find((page) => page.id === activePlan.activePageId) ??
    activePlan?.pages?.[0];
  const activePageIndex = Math.max(0, activePlan?.pages?.findIndex((page) => page.id === activePage?.id) ?? 0);

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

  useEffect(
    () =>
      subscribePlatformState(() => {
        setPlatformState(loadPlatformState());
      }),
    [],
  );

  const site = useMemo(() => platformState.sites.find((item) => item.id === siteId) ?? null, [platformState.sites, siteId]);
  const effectiveMerchantName = (site?.merchantName ?? site?.name ?? initialMerchantName).trim();
  const hasResolvedOrderManagementPermission = typeof site?.permissionConfig?.allowOrderManagement === "boolean";
  const localOrderManagementEnabled = hasResolvedOrderManagementPermission
    ? Boolean(site?.permissionConfig?.allowProductBlock && site?.permissionConfig?.allowOrderManagement)
    : false;
  const orderManagementEnabled = Boolean(remoteOrderManagementEnabled || localOrderManagementEnabled);
  useEffect(() => {
    if (!hydrated || !site || !resolvedPageId) return;
    void import("@/lib/analytics").then(({ trackPageView }) => {
      trackPageView(`site:${site.id}:${resolvedPageId}`);
    });
  }, [hydrated, site, resolvedPageId]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      setIsInitialLoading(false);
    }, MIN_INITIAL_LOADING_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [hydrated, siteId]);

  useEffect(() => {
    if (!hydrated) return;
    if (hasInitialPublishedBlocks) return;
    const scoped = loadPublishedWithFallback(siteId, siteScope);
    setScopedPublishedBlocksLocal(scoped);
  }, [hasInitialPublishedBlocks, hydrated, siteId, siteScope]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    if (hasInitialPublishedBlocks) return;
    const refreshLocalPublished = () => {
      const scoped = loadPublishedWithFallback(siteId, siteScope);
      setScopedPublishedBlocksLocal(scoped);
    };
    const onStorage = (event: StorageEvent) => {
      if (
        event.key &&
        !event.key.includes("merchant-space:homeBlocks:published:v1") &&
        event.key !== PUBLISH_SYNC_STORAGE_KEY
      ) {
        return;
      }
      refreshLocalPublished();
    };
    const onFocus = () => {
      refreshLocalPublished();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshLocalPublished();
      }
    };
    const unsubscribePublishSync = subscribePublishSync((message) => {
      if (!message.siteIds.includes(siteId)) return;
      refreshLocalPublished();
    });
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      unsubscribePublishSync();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasInitialPublishedBlocks, hydrated, siteId, siteScope]);

  useEffect(() => {
    if (!hydrated || !siteId) {
      setRemoteResolved(true);
      return;
    }
    let mounted = true;
    setRemoteResolved(false);
    const settleTimer = setTimeout(() => {
      if (mounted) setRemoteResolved(true);
    }, SITE_REMOTE_SETTLE_TIMEOUT_MS);

    (async () => {
      try {
        const nextPublished = await fetchPublishedSiteBlocksFast(siteId);
        if (!mounted || !nextPublished) return;

        setDbBlocks(nextPublished.blocks);
        if (nextPublished.orderManagementEnabled === true) {
          setRemoteOrderManagementEnabled(true);
        }
        savePublishedBlocksToStorage(nextPublished.blocks, siteScope);
      } catch {
        // Keep local rendered content when backend is unavailable.
      } finally {
        clearTimeout(settleTimer);
        if (mounted) setRemoteResolved(true);
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(settleTimer);
    };
  }, [hydrated, siteId, siteScope]);

  const faollaPullRefreshEnabled = hydrated && isMobileViewport && faollaAppShell;
  const {
    pullDistance: faollaPullDistance,
    readyToRefresh: faollaReadyToRefresh,
    refreshing: faollaRefreshing,
    bind: faollaPullRefreshBind,
  } = usePullToRefresh({
    disabled: !faollaPullRefreshEnabled,
    getScrollElement: getDocumentScrollElement,
    onRefresh: reloadCurrentDocumentAfterPull,
    threshold: 64,
    maxPull: 104,
    resistance: 0.5,
  });
  const faollaPullOffset = faollaPullRefreshEnabled ? (faollaRefreshing ? 64 : faollaPullDistance) : 0;
  const faollaPullContentStyle =
    faollaPullRefreshEnabled
      ? {
          transform: `translateY(${Math.round(faollaPullOffset)}px)`,
          transition: faollaPullDistance > 0 && !faollaRefreshing ? "none" : "transform 180ms ease-out",
          willChange: faollaPullOffset > 0 ? "transform" : undefined,
        }
      : undefined;

  const waitingForPublishedSync = Boolean(siteId) && !dbBlocks && !hasScopedLocalBlocks && !remoteResolved;
  const shouldHoldForHydration = (!hydrated || isInitialLoading) && !hasInitialPublishedBlocks;
  if (shouldHoldForHydration || waitingForPublishedSync) {
    return <LoadingProgressScreen message="正在加载站点..." />;
  }

  if (!site && !hasRenderableBlocks && !forcedSiteId) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-lg border bg-white p-6">
          <h1 className="text-xl font-bold text-slate-900">站点不存在</h1>
          <p className="mt-2 text-sm text-slate-600">该商家站点可能已被删除，或站点 ID 无效。</p>
          <div className="mt-4">
            <Link href={buildPlatformHomeHref()} className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
              返回总站首页
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!hasRenderableBlocks) {
    return (
      <ServiceMaintenancePage
        title="站点准备中"
        merchantName={effectiveMerchantName || siteId}
        description="该商户站点暂未完成首次发布，当前入口暂不可用，请稍后再访问。"
      />
    );
  }

  const activeBlocks = cloneBlocks(activePage?.blocks ?? activePlan?.blocks ?? sourceBlocks);
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
    if (!block) return max;
    const value =
      typeof block.props.blockOffsetY === "number" && Number.isFinite(block.props.blockOffsetY)
        ? Math.round(block.props.blockOffsetY)
        : 0;
    return Math.max(max, value);
  }, 0);
  const backgroundExtendPadding = Math.max(0, maxBlockOffsetY) + 160;
  const showMerchantLoginButton = Boolean(siteId && siteId !== "site-main" && !faollaAppShell);
  const showMembershipEntry = Boolean(siteId && siteId !== "site-main");
  const authEntryClassName = faollaAppShell
    ? "fixed right-16 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[2147483000] md:right-16 md:top-5"
    : "fixed right-16 top-3 z-[20000] md:right-20 md:top-5";

  return (
    <main
      {...faollaPullRefreshBind}
      className="faolla-public-site-shell min-h-screen w-full overflow-x-hidden bg-gray-50 py-8"
      style={{ ...pageBackgroundStyle, paddingBottom: `calc(2rem + ${backgroundExtendPadding}px)` }}
    >
      <FaollaPullRefreshIndicator
        pullDistance={faollaPullDistance}
        readyToRefresh={faollaReadyToRefresh}
        refreshing={faollaRefreshing}
      />
      <div style={faollaPullContentStyle}>
        {showMembershipEntry || showMerchantLoginButton ? (
          <div className={`${authEntryClassName} flex items-start gap-2`}>
            {showMembershipEntry ? (
              <MerchantMembershipEntry
                siteId={site?.id ?? siteId}
                siteName={effectiveMerchantName}
              />
            ) : null}
            {showMerchantLoginButton ? (
              <FrontendAuthEntry
                currentMerchantId={site?.id ?? siteId}
                merchantName={effectiveMerchantName}
                merchantAvatarUrl={site?.chatAvatarImageUrl ?? site?.merchantCardImageUrl ?? ""}
              />
            ) : null}
          </div>
        ) : null}
        <BlockRenderer
          blocks={activeBlocks}
          currentPageId={activePage?.id}
          currentPageIndex={activePageIndex}
          availablePages={activePlan?.pages?.map((page) => ({ id: page.id, name: page.name })) ?? []}
          bookingSiteId={site?.id ?? siteId}
          bookingSiteName={effectiveMerchantName}
          productCartEnabled={orderManagementEnabled}
          bookingInteractive
          bookingViewport={isMobileViewport ? "mobile" : "desktop"}
          onNavigatePage={(pageId) => {
            if (activePlan?.pages?.some((page) => page.id === pageId)) setCurrentPageId(pageId);
          }}
        />
      </div>
    </main>
  );
}

export default SitePageClient;
