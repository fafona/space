"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { BackgroundEditableProps } from "@/data/homeBlocks";
import {
  buildCustomGalleryRows,
  getGalleryCardLayout,
  normalizeCustomGalleryLayout,
  normalizeGalleryLayoutPreset,
  type CustomGalleryLayout,
  type GalleryLayoutPreset,
} from "@/lib/galleryLayout";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type GalleryImageItem = {
  id: string;
  url: string;
  featured: boolean;
  fitToFrame: boolean;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
};

type GalleryBlockProps = BackgroundEditableProps & {
  heading?: string;
  galleryFrameWidth?: number;
  galleryFrameHeight?: number;
  galleryLayoutPreset?: GalleryLayoutPreset;
  galleryCustomLayout?: CustomGalleryLayout;
  images?: Array<
    | string
    | {
        id?: string;
        url?: string;
        featured?: boolean;
        fitToFrame?: boolean;
        offsetX?: number;
        offsetY?: number;
        scaleX?: number;
        scaleY?: number;
      }
  >;
  autoplayMs?: number;
};

function normalizeGalleryItems(source: GalleryBlockProps["images"]): GalleryImageItem[] {
  if (!Array.isArray(source)) return [];
  return source
    .map((item, idx) => {
      if (typeof item === "string") {
        const url = item.trim();
        if (!url) return null;
        return {
          id: `legacy-${idx}`,
          url,
          featured: idx === 0,
          fitToFrame: true,
          offsetX: 0,
          offsetY: 0,
          scaleX: 1,
          scaleY: 1,
        } as GalleryImageItem;
      }
      if (!item || typeof item !== "object") return null;
      const url = (item.url ?? "").trim();
      if (!url) return null;
      const scaleX = typeof item.scaleX === "number" && Number.isFinite(item.scaleX) ? item.scaleX : 1;
      const scaleY = typeof item.scaleY === "number" && Number.isFinite(item.scaleY) ? item.scaleY : 1;
      return {
        id: item.id?.trim() || `gallery-${idx}`,
        url,
        featured: !!item.featured,
        fitToFrame: typeof item.fitToFrame === "boolean" ? item.fitToFrame : true,
        offsetX: typeof item.offsetX === "number" && Number.isFinite(item.offsetX) ? item.offsetX : 0,
        offsetY: typeof item.offsetY === "number" && Number.isFinite(item.offsetY) ? item.offsetY : 0,
        scaleX: Math.max(0.2, Math.min(3, scaleX)),
        scaleY: Math.max(0.2, Math.min(3, scaleY)),
      };
    })
    .filter((item): item is GalleryImageItem => !!item);
}

export default function GalleryBlock(props: GalleryBlockProps) {
  const imageItems = useMemo(() => normalizeGalleryItems(props.images), [props.images]);
  const featured = imageItems.filter((item) => item.featured);
  const homeItems = featured.length > 0 ? featured : imageItems;
  const [index, setIndex] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const intervalMs =
    typeof props.autoplayMs === "number" && Number.isFinite(props.autoplayMs)
      ? Math.max(1000, Math.round(props.autoplayMs))
      : 3000;
  const safeIndex = homeItems.length > 0 ? index % homeItems.length : 0;

  useEffect(() => {
    if (homeItems.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % homeItems.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [homeItems.length, intervalMs]);

  const cardStyle = getBackgroundStyle({
    imageUrl: props.bgImageUrl,
    fillMode: props.bgFillMode,
    position: props.bgPosition,
    color: props.bgColor,
    opacity: props.bgOpacity,
    imageOpacity: props.bgImageOpacity,
    colorOpacity: props.bgColorOpacity,
  });
  const blockWidth =
    typeof props.blockWidth === "number" && Number.isFinite(props.blockWidth)
      ? Math.max(240, Math.round(props.blockWidth))
      : undefined;
  const blockHeight =
    typeof props.blockHeight === "number" && Number.isFinite(props.blockHeight)
      ? Math.max(120, Math.round(props.blockHeight))
      : undefined;
  const sizeStyle = {
    width: blockWidth ? `${blockWidth}px` : undefined,
    height: blockHeight ? `${blockHeight}px` : undefined,
    overflow: blockHeight ? ("auto" as const) : undefined,
  };
  const offsetX =
    typeof props.blockOffsetX === "number" && Number.isFinite(props.blockOffsetX)
      ? Math.round(props.blockOffsetX)
      : 0;
  const offsetY =
    typeof props.blockOffsetY === "number" && Number.isFinite(props.blockOffsetY)
      ? Math.round(props.blockOffsetY)
      : 0;
  const blockLayer =
    typeof props.blockLayer === "number" && Number.isFinite(props.blockLayer)
      ? Math.max(1, Math.round(props.blockLayer))
      : 1;
  const offsetStyle = {
    position: "relative" as const,
    transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
    zIndex: blockLayer,
  };
  const borderClass = getBlockBorderClass(props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(props.blockBorderStyle, props.blockBorderColor);
  const currentImage = homeItems[safeIndex] ?? null;
  const frameWidth =
    typeof props.galleryFrameWidth === "number" && Number.isFinite(props.galleryFrameWidth)
      ? Math.max(220, Math.round(props.galleryFrameWidth))
      : undefined;
  const contentMaxWidth =
    typeof blockWidth === "number" && Number.isFinite(blockWidth)
      ? Math.max(120, blockWidth - 48)
      : undefined;
  const effectiveFrameWidth =
    typeof frameWidth === "number"
      ? typeof contentMaxWidth === "number"
        ? Math.min(frameWidth, contentMaxWidth)
        : frameWidth
      : undefined;
  const frameHeight =
    typeof props.galleryFrameHeight === "number" && Number.isFinite(props.galleryFrameHeight)
      ? Math.max(140, Math.round(props.galleryFrameHeight))
      : 260;
  const frameStyle = {
    width: effectiveFrameWidth ? `${effectiveFrameWidth}px` : "100%",
    maxWidth: "100%",
    height: `${frameHeight}px`,
  };
  const headingStyle = {
    width: effectiveFrameWidth ? `${effectiveFrameWidth}px` : "100%",
    maxWidth: "100%",
  };
  const galleryLayoutPreset = normalizeGalleryLayoutPreset(props.galleryLayoutPreset);
  const customLayout = normalizeCustomGalleryLayout(props.galleryCustomLayout);
  const customRows = buildCustomGalleryRows(customLayout, imageItems.length);

  return (
    <section className="max-w-6xl mx-auto px-6 py-6" style={offsetStyle}>
      <div
        className={`bg-white rounded-xl shadow-sm p-6 overflow-hidden ${borderClass}`}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        <h2
          className="text-xl font-bold whitespace-pre-wrap break-words mx-auto"
          style={headingStyle}
          dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, "相册展示") }}
        />
        {currentImage ? (
          <div className="mt-4 space-y-3">
            <div className="block mx-auto overflow-hidden rounded-lg bg-transparent" style={frameStyle}>
              <div className="relative w-full h-full overflow-hidden">
                {currentImage.fitToFrame ? (
                  <div
                    className="absolute inset-0"
                    style={{ overflow: "hidden" }}
                  >
                    <Image
                      src={currentImage.url}
                      alt=""
                      fill
                      unoptimized
                      sizes="100vw"
                      className="object-cover"
                      style={{
                        objectPosition: `calc(50% + ${currentImage.offsetX}px) calc(50% + ${currentImage.offsetY}px)`,
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{
                      transform: `translate(${currentImage.offsetX}px, ${currentImage.offsetY}px) scale(${currentImage.scaleX}, ${currentImage.scaleY})`,
                      transformOrigin: "center center",
                    }}
                  >
                    <Image src={currentImage.url} alt="" fill unoptimized sizes="100vw" className="object-contain" />
                  </div>
                )}
                <div className="absolute left-2 bottom-2 px-2 py-1 text-xs rounded border bg-white/90 text-gray-700">
                  {safeIndex + 1} / {homeItems.length}
                </div>
                <button
                  className="absolute right-2 bottom-2 px-3 py-1 text-xs rounded border bg-white/90 hover:bg-white"
                  onClick={() => setShowMore((prev) => !prev)}
                >
                  更多
                </button>
              </div>
            </div>
            {showMore ? (
              <div className="rounded-lg border border-gray-200 p-3">
                {galleryLayoutPreset === "custom" ? (
                  <div className="space-y-3">
                    {customRows.map((row) => (
                      <div
                        key={row.key}
                        className={`flex flex-wrap gap-3 ${
                          row.align === "center" ? "justify-center" : row.align === "right" ? "justify-end" : "justify-start"
                        }`}
                      >
                        {row.items.map((slot) => {
                          const item = imageItems[slot.index];
                          if (!item) return null;
                          return (
                            <button
                              key={`${item.id}-${slot.index}`}
                              className="relative rounded-lg overflow-hidden border border-gray-200"
                              style={{ width: `${(slot.span / 12) * 100}%`, height: slot.height }}
                              onClick={() => setIndex(slot.index)}
                            >
                              <Image src={item.url} alt="" fill unoptimized sizes="100vw" className="object-contain bg-gray-50" />
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                    {imageItems.map((item, idx) => (
                      <button
                        key={`${item.id}-${idx}`}
                        className={`relative rounded-lg overflow-hidden border border-gray-200 ${getGalleryCardLayout(galleryLayoutPreset, idx, customLayout).itemClass}`}
                        style={getGalleryCardLayout(galleryLayoutPreset, idx, customLayout).frameStyle}
                        onClick={() => setIndex(idx)}
                      >
                        <Image src={item.url} alt="" fill unoptimized sizes="100vw" className="object-contain bg-gray-50" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
            暂无图片，请在后台添加相册图片。
          </div>
        )}
      </div>
    </section>
  );
}
