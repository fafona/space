"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import ServiceMaintenancePage from "@/components/ServiceMaintenancePage";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import {
  loadPublishedBlocksFromStorage,
  savePublishedBlocksToStorage,
} from "@/data/blockStore";
import { type Block } from "@/data/homeBlocks";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import { trackPageView } from "@/lib/analytics";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { MOBILE_BREAKPOINT } from "@/lib/deviceViewport";
import { cloneBlocks, getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { PUBLISH_SYNC_STORAGE_KEY, subscribePublishSync } from "@/lib/publishSync";
import { buildPlatformHomeHref, buildSiteStoreScope } from "@/lib/siteRouting";
import {
  canReachSupabaseGateway,
  getResolvedSupabaseUrl,
  isSupabaseEnabled,
  resolvedSupabaseAnonKey,
  supabase,
} from "@/lib/supabase";
import { useHydrated } from "@/lib/useHydrated";
import { useMobileHorizontalScrollLock } from "@/lib/useMobileHorizontalScrollLock";

const EMPTY_BLOCKS: Block[] = [];
const MIN_INITIAL_LOADING_MS = 0;
const SITE_REMOTE_FETCH_TIMEOUT_MS = 8000;
const SITE_REMOTE_SETTLE_TIMEOUT_MS = 9000;

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

async function getAccessTokenQuickly(timeoutMs = 1200) {
  try {
    const sessionTask = supabase.auth.getSession();
    const timeoutTask = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), Math.max(200, timeoutMs));
    });
    const result = (await Promise.race([sessionTask, timeoutTask])) as Awaited<typeof sessionTask> | null;
    const token = result?.data?.session?.access_token ?? "";
    return token.trim() || "";
  } catch {
    return "";
  }
}

async function fetchPublishedSiteBlocksViaRest(siteId: string, bearerToken?: string) {
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
      };
      if ((bearerToken ?? "").trim()) {
        headers.Authorization = `Bearer ${bearerToken}`;
      }
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

async function fetchPublishedSiteBlocksViaApi(siteId: string) {
  if (!siteId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITE_REMOTE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/site-published?siteId=${encodeURIComponent(siteId)}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = (await response.json().catch(() => null)) as { blocks?: unknown } | null;
    if (!Array.isArray(json?.blocks)) return null;
    const sanitized = sanitizeBlocksForRuntime(json.blocks as Block[]).blocks;
    return sanitized.length > 0 ? sanitized : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type SitePageClientProps = {
  forcedSiteId?: string;
  initialIsMobileViewport?: boolean;
  initialPublishedBlocks?: Block[];
  initialMerchantName?: string;
};

export function SitePageClient({
  forcedSiteId,
  initialIsMobileViewport = false,
  initialPublishedBlocks = EMPTY_BLOCKS,
  initialMerchantName = "",
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
  const [remoteResolved, setRemoteResolved] = useState(hasInitialPublishedBlocks);

  const effectiveScopedPublishedBlocks = scopedPublishedBlocksLocal ?? EMPTY_BLOCKS;
  const hasScopedLocalBlocks = effectiveScopedPublishedBlocks.length > 0;
  const sourceBlocks = dbBlocks ?? (hasScopedLocalBlocks ? effectiveScopedPublishedBlocks : EMPTY_BLOCKS);
  const hasRenderableBlocks = sourceBlocks.length > 0;

  const desktopPlanConfig = getPagePlanConfigFromBlocks(sourceBlocks);
  const mobilePlanConfig = getEmbeddedMobilePlanConfig(sourceBlocks);
  const planConfig = isMobileViewport && mobilePlanConfig ? mobilePlanConfig : desktopPlanConfig;
  const activePlan = planConfig.plans.find((plan) => plan.id === planConfig.activePlanId) ?? planConfig.plans[0];
  const [currentPageId, setCurrentPageId] = useState<string>(activePlan?.activePageId ?? "page-1");
  const resolvedPageId =
    activePlan?.pages?.some((page) => page.id === currentPageId) ? currentPageId : activePlan?.activePageId ?? "page-1";
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
  useEffect(() => {
    if (!hydrated || !site || !resolvedPageId) return;
    trackPageView(`site:${site.id}:${resolvedPageId}`);
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
        let nextBlocks = await withTimeout(fetchPublishedSiteBlocksViaApi(siteId), SITE_REMOTE_FETCH_TIMEOUT_MS);

        if (!nextBlocks && isSupabaseEnabled) {
          const gatewayReady = await canReachSupabaseGateway(3000);
          if (!mounted) return;
          if (gatewayReady) {
            const accessTokenTask = getAccessTokenQuickly(900);
            const anonRestTask = withTimeout(fetchPublishedSiteBlocksViaRest(siteId), SITE_REMOTE_FETCH_TIMEOUT_MS);
            const sdkTask = withTimeout(
              (async () => {
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
              })(),
              SITE_REMOTE_FETCH_TIMEOUT_MS,
            );

            nextBlocks = await anonRestTask;
            if (!nextBlocks) {
              nextBlocks = await sdkTask;
            }
            if (!nextBlocks) {
              const accessToken = await accessTokenTask;
              if (accessToken) {
                nextBlocks = await withTimeout(fetchPublishedSiteBlocksViaRest(siteId, accessToken), SITE_REMOTE_FETCH_TIMEOUT_MS);
              }
            }
          }
        }
        if (!mounted || !nextBlocks) return;

        setDbBlocks(nextBlocks);
        savePublishedBlocksToStorage(nextBlocks, siteScope);
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
    const value =
      typeof block.props.blockOffsetY === "number" && Number.isFinite(block.props.blockOffsetY)
        ? Math.round(block.props.blockOffsetY)
        : 0;
    return Math.max(max, value);
  }, 0);
  const backgroundExtendPadding = Math.max(0, maxBlockOffsetY) + 160;

  return (
    <main
      className="min-h-screen w-full overflow-x-hidden bg-gray-50 py-8"
      style={{ ...pageBackgroundStyle, paddingBottom: `calc(2rem + ${backgroundExtendPadding}px)` }}
    >
      <BlockRenderer
        blocks={activeBlocks}
        currentPageId={activePage?.id}
        currentPageIndex={activePageIndex}
        availablePages={activePlan?.pages?.map((page) => ({ id: page.id, name: page.name })) ?? []}
        bookingSiteId={site?.id ?? siteId}
        bookingSiteName={effectiveMerchantName}
        bookingInteractive
        bookingViewport={isMobileViewport ? "mobile" : "desktop"}
        onNavigatePage={(pageId) => {
          if (activePlan?.pages?.some((page) => page.id === pageId)) setCurrentPageId(pageId);
        }}
      />
    </main>
  );
}

export default SitePageClient;
