"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
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
import { cloneBlocks, getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { PUBLISH_SYNC_STORAGE_KEY, subscribePublishSync } from "@/lib/publishSync";
import { buildMerchantBackendHref, buildPlatformHomeHref, buildSiteStoreScope } from "@/lib/siteRouting";
import { isSupabaseEnabled, resolvedSupabaseAnonKey, resolvedSupabaseUrl, supabase } from "@/lib/supabase";
import { useHydrated } from "@/lib/useHydrated";

const MOBILE_BREAKPOINT = 768;
const EMPTY_BLOCKS: Block[] = [];
const MIN_INITIAL_LOADING_MS = 0;
const SITE_REMOTE_FETCH_TIMEOUT_MS = 35000;
const SITE_REMOTE_SETTLE_TIMEOUT_MS = 38000;

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
  const base = (resolvedSupabaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base || !siteId) return null;
  const query = new URLSearchParams({
    select: "blocks",
    merchant_id: `eq.${siteId}`,
    slug: "eq.home",
    limit: "1",
  });
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
    return sanitizeBlocksForRuntime(first.blocks as Block[]).blocks;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type SitePageClientProps = {
  forcedSiteId?: string;
};

export function SitePageClient({ forcedSiteId }: SitePageClientProps = {}) {
  const params = useParams<{ siteId?: string }>();
  const routeSiteId = typeof params?.siteId === "string" ? params.siteId : "";
  const siteId = (forcedSiteId ?? routeSiteId).trim();
  const siteScope = siteId ? buildSiteStoreScope(siteId) : "default";

  const hydrated = useHydrated();
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [platformState, setPlatformState] = useState(() => loadPlatformState());
  const [dbBlocks, setDbBlocks] = useState<Block[] | null>(null);
  const [scopedPublishedBlocksLocal, setScopedPublishedBlocksLocal] = useState<Block[] | null>(null);
  const [remoteResolved, setRemoteResolved] = useState(false);

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

  useEffect(
    () =>
      subscribePlatformState(() => {
        setPlatformState(loadPlatformState());
      }),
    [],
  );

  const site = useMemo(
    () => platformState.sites.find((item) => item.id === siteId) ?? null,
    [platformState.sites, siteId],
  );
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
    const scoped = loadPublishedWithFallback(siteId, siteScope);
    setScopedPublishedBlocksLocal(scoped);
  }, [hydrated, siteId, siteScope]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
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
  }, [hydrated, siteId, siteScope]);

  useEffect(() => {
    if (!hydrated || !siteId || !isSupabaseEnabled) {
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
        const accessTokenTask = getAccessTokenQuickly(900);
        const anonRestTask = withTimeout(fetchPublishedSiteBlocksViaRest(siteId), SITE_REMOTE_FETCH_TIMEOUT_MS);
        const sdkTask = withTimeout(
          (async () => {
            let result = await supabase
              .from("pages")
              .select("blocks")
              .eq("merchant_id", siteId)
              .eq("slug", "home")
              .limit(1)
              .maybeSingle();
            if (result.error && isMissingSlugColumn(result.error.message)) {
              result = await supabase.from("pages").select("blocks").eq("merchant_id", siteId).limit(1).maybeSingle();
            }
            if (!result.error && Array.isArray(result.data?.blocks)) {
              return sanitizeBlocksForRuntime(result.data.blocks as Block[]).blocks;
            }
            return null;
          })(),
          SITE_REMOTE_FETCH_TIMEOUT_MS,
        );

        let nextBlocks = await anonRestTask;
        if (!nextBlocks) {
          nextBlocks = await sdkTask;
        }
        if (!nextBlocks) {
          const accessToken = await accessTokenTask;
          if (accessToken) {
            nextBlocks = await withTimeout(fetchPublishedSiteBlocksViaRest(siteId, accessToken), SITE_REMOTE_FETCH_TIMEOUT_MS);
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

  const waitingForPublishedSync = !!site && !dbBlocks && !hasScopedLocalBlocks && !remoteResolved;
  if (!hydrated || isInitialLoading || waitingForPublishedSync) {
    return <LoadingProgressScreen message="正在加载站点..." />;
  }

  if (!site) {
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
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-lg border bg-white p-6">
          <h1 className="text-xl font-bold text-slate-900">该站点暂无已发布内容</h1>
          <p className="mt-2 text-sm text-slate-600">请先在后台发布该商户的专属页面。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={buildMerchantBackendHref(site.id)} className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
              去后台发布专属页面
            </Link>
            <Link href={buildPlatformHomeHref()} className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
              返回总站首页
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const activePage =
    activePlan?.pages?.find((page) => page.id === resolvedPageId) ??
    activePlan?.pages?.find((page) => page.id === activePlan.activePageId) ??
    activePlan?.pages?.[0];
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
      className="min-h-screen bg-gray-50 py-8"
      style={{ ...pageBackgroundStyle, paddingBottom: `calc(2rem + ${backgroundExtendPadding}px)` }}
    >
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

export default SitePageClient;
