"use client";

import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { toJpeg } from "html-to-image";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import type { Block } from "@/data/homeBlocks";
import { getPagePlanConfigFromBlocks } from "@/lib/pagePlans";

const TEMPLATE_PREVIEW_WIDTH = 1200;
const TEMPLATE_PREVIEW_QUALITY = 0.68;
const PAGE_PREVIEW_MIN_HEIGHT = 720;
export const PLAN_TEMPLATE_PREVIEW_VARIANT = "plan-pages-v1";

type PreviewPlanPage = {
  id: string;
  name: string;
  blocks: Block[];
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function resolvePageBackgroundStyle(blocks: Block[]) {
  const source = blocks[0]?.props;
  return getBackgroundStyle({
    imageUrl: source?.pageBgImageUrl,
    fillMode: source?.pageBgFillMode,
    position: source?.pageBgPosition,
    color: source?.pageBgColor,
    opacity: source?.pageBgOpacity,
    imageOpacity: source?.pageBgImageOpacity,
    colorOpacity: source?.pageBgColorOpacity,
  });
}

function resolvePageBackgroundPadding(blocks: Block[]) {
  const maxBlockOffsetY = blocks.reduce((max, block) => {
    const value =
      typeof block.props.blockOffsetY === "number" && Number.isFinite(block.props.blockOffsetY)
        ? Math.round(block.props.blockOffsetY)
        : 0;
    return Math.max(max, value);
  }, 0);
  return Math.max(0, maxBlockOffsetY) + 160;
}

function PlanPagePreviewSurface({ pageName, blocks }: { pageName: string; blocks: Block[] }) {
  const backgroundStyle = resolvePageBackgroundStyle(blocks);
  const backgroundExtendPadding = resolvePageBackgroundPadding(blocks);
  return (
    <section
      style={{
        borderRadius: "28px",
        border: "1px solid rgba(15, 23, 42, 0.12)",
        background: "#ffffff",
        boxShadow: "0 24px 80px rgba(15, 23, 42, 0.14)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "18px 24px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
          background: "rgba(248, 250, 252, 0.96)",
        }}
      >
        <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", letterSpacing: "0.04em" }}>{pageName}</div>
      </div>
      <div
        style={{
          minHeight: `${PAGE_PREVIEW_MIN_HEIGHT}px`,
          paddingBottom: `${backgroundExtendPadding}px`,
          ...backgroundStyle,
        }}
      >
        <BlockRenderer blocks={blocks} />
      </div>
    </section>
  );
}

function HiddenPlanPreviewSurface({ planName, pages }: { planName: string; pages: PreviewPlanPage[] }) {
  return (
    <div
      style={{
        width: `${TEMPLATE_PREVIEW_WIDTH}px`,
        padding: "32px",
        background: "linear-gradient(180deg, #e2e8f0 0%, #f8fafc 100%)",
        overflow: "hidden",
      }}
    >
      <div style={{ marginBottom: "24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "13px", color: "#475569", letterSpacing: "0.08em", textTransform: "uppercase" }}>方案预览</div>
          <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 800, color: "#0f172a" }}>{planName}</div>
        </div>
        <div
          style={{
            borderRadius: "999px",
            background: "rgba(15, 23, 42, 0.08)",
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 600,
            color: "#334155",
          }}
        >
          页面 {pages.length}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
        {pages.map((page) => (
          <PlanPagePreviewSurface key={page.id} pageName={page.name} blocks={page.blocks} />
        ))}
      </div>
    </div>
  );
}

async function waitForImages(node: HTMLElement) {
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
          window.setTimeout(done, 2200);
        }),
    ),
  );
}

async function renderPreviewNode(element: ReactElement) {
  if (typeof document === "undefined") return "";
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-20000px";
  host.style.top = "0";
  host.style.width = `${TEMPLATE_PREVIEW_WIDTH}px`;
  host.style.pointerEvents = "none";
  host.style.opacity = "1";
  host.style.zIndex = "-1";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(element);
    });
    const target = host.firstElementChild as HTMLElement | null;
    if (!target) return "";
    await waitForImages(target);
    if (typeof document.fonts?.ready?.then === "function") {
      await document.fonts.ready.catch(() => undefined);
    }
    await wait(120);
    return await toJpeg(target, {
      quality: TEMPLATE_PREVIEW_QUALITY,
      pixelRatio: 1,
      cacheBust: true,
      backgroundColor: "#ffffff",
    });
  } catch {
    return "";
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function capturePlanTemplatePreviewAssets(rawBlocks: Block[]) {
  const planPreviewImageUrls: Record<string, string> = {};
  const config = getPagePlanConfigFromBlocks(rawBlocks);

  for (const plan of config.plans) {
    const planPages = (plan.pages ?? [])
      .filter((page) => Array.isArray(page.blocks) && page.blocks.length > 0)
      .map((page) => ({
        id: page.id,
        name: page.name,
        blocks: page.blocks,
      }));
    if (planPages.length === 0) continue;
    const previewUrl = await renderPreviewNode(<HiddenPlanPreviewSurface planName={plan.name} pages={planPages} />);
    if (previewUrl) {
      planPreviewImageUrls[plan.id] = previewUrl;
    }
  }

  return {
    previewVariant: PLAN_TEMPLATE_PREVIEW_VARIANT,
    previewImageUrl: planPreviewImageUrls["plan-1"] ?? Object.values(planPreviewImageUrls)[0] ?? "",
    planPreviewImageUrls,
  };
}
