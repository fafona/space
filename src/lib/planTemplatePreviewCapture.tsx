"use client";

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { toJpeg } from "html-to-image";
import type { Block } from "@/data/homeBlocks";
import BlockRenderer from "@/components/blocks/BlockRenderer";
import { getPagePlanConfigFromBlocks } from "@/lib/pagePlans";

const TEMPLATE_PREVIEW_WIDTH = 1200;
const TEMPLATE_PREVIEW_QUALITY = 0.68;

function HiddenPreviewSurface({ blocks }: { blocks: Block[] }) {
  return (
    <div
      style={{
        width: `${TEMPLATE_PREVIEW_WIDTH}px`,
        backgroundColor: "#ffffff",
        overflow: "hidden",
      }}
    >
      <BlockRenderer blocks={blocks} />
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

async function renderBlocksToPreview(blocks: Block[]) {
  if (typeof document === "undefined" || blocks.length === 0) return "";
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
      root.render(<HiddenPreviewSurface blocks={blocks} />);
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
    const firstPage = plan.pages?.[0];
    if (!firstPage || !Array.isArray(firstPage.blocks) || firstPage.blocks.length === 0) continue;
    const previewUrl = await renderBlocksToPreview(firstPage.blocks);
    if (previewUrl) {
      planPreviewImageUrls[plan.id] = previewUrl;
    }
  }
  return {
    previewImageUrl: planPreviewImageUrls["plan-1"] ?? Object.values(planPreviewImageUrls)[0] ?? "",
    planPreviewImageUrls,
  };
}
