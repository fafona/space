"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { homeBlocks, type Block } from "@/data/homeBlocks";
import {
  getPublishedBlocksSnapshot,
  savePublishedBlocksToStorage,
  subscribePublishedBlocksStore,
} from "@/data/blockStore";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import { cloneBlocks, getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { supabase } from "@/lib/supabase";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { trackPageView } from "@/lib/analytics";

const MOBILE_BREAKPOINT = 768;

function getEmbeddedMobilePlanConfig(sourceBlocks: Block[]) {
  const carrier = sourceBlocks.find((block) => !!(block?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile);
  const rawMobile = (carrier?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile;
  if (!rawMobile) return null;
  const cloned = cloneBlocks(sourceBlocks);
  const carrierIndex = cloned.findIndex((block) => !!(block?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile);
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
    /could not find the ['\"]slug['\"] column of ['\"]pages['\"] in the schema cache/i.test(message)
  );
}

export default function HomePage() {
  const [dbBlocks, setDbBlocks] = useState<Block[] | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const blocks = useSyncExternalStore(
    subscribePublishedBlocksStore,
    () => getPublishedBlocksSnapshot(homeBlocks),
    () => homeBlocks,
  );
  const sourceBlocks = dbBlocks ?? blocks;
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

  useEffect(() => {
    if (!resolvedPageId) return;
    trackPageView(`home:${resolvedPageId}`);
  }, [resolvedPageId]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const bySlug = await supabase.from("pages").select("blocks").eq("slug", "home").single();
      if (!mounted) return;

      if (!bySlug.error && Array.isArray(bySlug.data?.blocks)) {
        const next = sanitizeBlocksForRuntime(bySlug.data.blocks as Block[]).blocks;
        setDbBlocks(next);
        savePublishedBlocksToStorage(next);
        return;
      }

      if (!bySlug.error || !isMissingSlugColumn(bySlug.error.message)) return;
      const byFirstRow = await supabase.from("pages").select("blocks").limit(1).maybeSingle();
      if (!mounted) return;
      if (!byFirstRow.error && Array.isArray(byFirstRow.data?.blocks)) {
        const next = sanitizeBlocksForRuntime(byFirstRow.data.blocks as Block[]).blocks;
        setDbBlocks(next);
        savePublishedBlocksToStorage(next);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

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
      <div className="max-w-6xl mx-auto px-6 mb-4 flex items-center justify-end gap-2">
        <a
          href="/login"
          className="inline-flex items-center rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100"
        >
          后台登录
        </a>
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
