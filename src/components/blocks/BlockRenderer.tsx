"use client";

import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Block } from "@/data/homeBlocks";
import HeroBlock from "./HeroBlock";
import TextBlock from "./TextBlock";
import ListBlock from "./ListBlock";
import SearchBarBlock from "./SearchBarBlock";
import MerchantListBlock from "./MerchantListBlock";
import CommonBlock from "./CommonBlock";
import NavBlock from "./NavBlock";
import ButtonBlock from "./ButtonBlock";
import { getBlockRenderStackOrder } from "@/lib/blockStacking";
import { buildPublicBlockId } from "@/lib/blockPublicId";
import type { ButtonJumpBlock } from "@/lib/buttonBlock";
import type { MerchantBookingRuleViewport } from "@/lib/merchantBookingRules";

const GalleryBlock = dynamic(() => import("./GalleryBlock"), { ssr: false, loading: () => null });
const ChartBlock = dynamic(() => import("./ChartBlock"), { ssr: false, loading: () => null });
const MusicBlock = dynamic(() => import("./MusicBlock"), { ssr: false, loading: () => null });
const ContactBlock = dynamic(() => import("./ContactBlock"), { ssr: false, loading: () => null });
const ProductBlock = dynamic(() => import("./ProductBlock"), { ssr: false, loading: () => null });
const CouponBlock = dynamic(() => import("./CouponBlock"), { ssr: false, loading: () => null });
const GoogleReviewsBlock = dynamic(() => import("./GoogleReviewsBlock"), { ssr: false, loading: () => null });
const BookingBlock = dynamic(() => import("./BookingBlock"), { ssr: false, loading: () => null });

class BlockRuntimeBoundary extends Component<{ blockId: string; children: ReactNode }, { hasError: boolean }> {
  constructor(props: { blockId: string; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`Block render failed: ${this.props.blockId}`, error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function isButtonOpenedBlock(block: Block) {
  return block.props.blockOpenMode === "button";
}

function stripInlineText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveOpenBlockTitle(block: Block, publicBlockId: string) {
  const props = block.props as Record<string, unknown>;
  const text =
    stripInlineText(props.heading) ||
    stripInlineText(props.title) ||
    stripInlineText(props.buttonLabel) ||
    stripInlineText(props.text);
  return text || `区块 ${publicBlockId}`;
}

export default function BlockRenderer({
  blocks,
  currentPageId,
  currentPageIndex = 0,
  availablePages,
  onNavigatePage,
  forceMobileViewport = false,
  bookingSiteId,
  bookingSiteName,
  productCartEnabled = false,
  bookingInteractive = true,
  bookingViewport,
}: {
  blocks: Block[];
  currentPageId?: string;
  currentPageIndex?: number;
  availablePages?: Array<{ id: string; name?: string }>;
  onNavigatePage?: (pageId: string) => void;
  forceMobileViewport?: boolean;
  bookingSiteId?: string;
  bookingSiteName?: string;
  productCartEnabled?: boolean;
  bookingInteractive?: boolean;
  bookingViewport?: MerchantBookingRuleViewport;
}) {
  const safeBlocks = useMemo(() => (Array.isArray(blocks) ? blocks : []), [blocks]);
  const [openedBlockId, setOpenedBlockId] = useState<string | null>(null);
  const openableBlocks = useMemo<ButtonJumpBlock[]>(
    () =>
      safeBlocks
        .map((block, index) => ({
          id: block.id,
          publicId: buildPublicBlockId(currentPageIndex, index),
          label: resolveOpenBlockTitle(block, buildPublicBlockId(currentPageIndex, index)),
          openByButton: isButtonOpenedBlock(block),
        }))
        .filter((block) => block.openByButton),
    [safeBlocks, currentPageIndex],
  );
  const openedBlockEntry = useMemo(() => {
    if (!openedBlockId) return null;
    const index = safeBlocks.findIndex((block) => block.id === openedBlockId && isButtonOpenedBlock(block));
    if (index < 0) return null;
    const block = safeBlocks[index];
    if (!block) return null;
    const publicBlockId = buildPublicBlockId(currentPageIndex, index);
    return {
      block,
      index,
      publicBlockId,
      title: resolveOpenBlockTitle(block, publicBlockId),
    };
  }, [safeBlocks, currentPageIndex, openedBlockId]);
  const openBlock = useCallback(
    (blockId: string) => {
      if (!openableBlocks.some((block) => block.id === blockId)) return;
      setOpenedBlockId(blockId);
    },
    [openableBlocks],
  );
  const closeOpenedBlock = useCallback(() => {
    setOpenedBlockId(null);
  }, []);

  useEffect(() => {
    if (!openedBlockEntry || forceMobileViewport || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [forceMobileViewport, openedBlockEntry]);

  useEffect(() => {
    if (!openedBlockEntry || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeOpenedBlock();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOpenedBlock, openedBlockEntry]);

  function renderBlockContent(b: Block, options: { openedView?: boolean } = {}): ReactNode {
    let content: ReactNode = null;
    switch (b.type) {
      case "common":
        content = <CommonBlock {...b.props} />;
        break;
      case "button":
        content = (
          <ButtonBlock
            {...b.props}
            availablePages={availablePages}
            onNavigatePage={onNavigatePage}
            availableBlocks={openableBlocks}
            onOpenBlock={openBlock}
          />
        );
        break;
      case "gallery":
        content = <GalleryBlock {...b.props} />;
        break;
      case "chart":
        content = <ChartBlock {...b.props} />;
        break;
      case "nav":
        content = (
          <NavBlock
            {...b.props}
            currentPageId={currentPageId}
            onNavigatePage={onNavigatePage}
            forceMobileViewport={forceMobileViewport}
          />
        );
        break;
      case "hero":
        content = <HeroBlock {...b.props} />;
        break;
      case "text":
        content = <TextBlock {...b.props} />;
        break;
      case "list":
        content = <ListBlock {...b.props} />;
        break;
      case "search-bar":
        content = <SearchBarBlock {...b.props} />;
        break;
      case "merchant-list":
        content = <MerchantListBlock {...b.props} />;
        break;
      case "contact":
        content = <ContactBlock {...b.props} />;
        break;
      case "music":
        content = <MusicBlock {...b.props} />;
        break;
      case "product":
        content = (
          <ProductBlock
            {...b.props}
            runtimeSiteId={bookingSiteId}
            runtimeSiteName={bookingSiteName}
            runtimeBlockId={b.id}
            runtimeOrderManagementEnabled={productCartEnabled}
            runtimeInteractiveOverlayWithinBlock={forceMobileViewport}
            runtimeDisableCartPortal={options.openedView === true}
          />
        );
        break;
      case "coupon":
        content = <CouponBlock {...b.props} runtimeSiteId={bookingSiteId} />;
        break;
      case "google-reviews":
        content = <GoogleReviewsBlock {...b.props} />;
        break;
      case "booking":
        content = (
          <BookingBlock
            {...b.props}
            runtimeSiteId={bookingSiteId}
            runtimeSiteName={bookingSiteName}
            interactive={bookingInteractive}
            runtimeBlockId={b.id}
            runtimeViewport={bookingViewport}
          />
        );
        break;
      default:
        content = null;
        break;
    }
    return content;
  }

  if (safeBlocks.length === 0) return null;

  const openedBlockOverlayClassName = forceMobileViewport
    ? "absolute inset-0 z-[2147482000] overflow-y-auto bg-white text-slate-950"
    : "fixed inset-0 z-[2147482000] overflow-y-auto bg-white text-slate-950";
  const openedBlockHeaderClassName = forceMobileViewport
    ? "sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur"
    : "sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur";
  const openedBlockHeaderInnerClassName = forceMobileViewport
    ? "flex w-full items-center gap-2"
    : "mx-auto flex max-w-6xl items-center gap-3";
  const openedBlockBackButtonClassName = forceMobileViewport
    ? "inline-flex min-h-9 items-center rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
    : "inline-flex min-h-10 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50";

  return (
    <div className={forceMobileViewport ? "relative min-h-[780px]" : "contents"}>
      {safeBlocks.map((b, index) => {
        if (isButtonOpenedBlock(b)) return null;
        const publicBlockId = buildPublicBlockId(currentPageIndex, index);
        const content = renderBlockContent(b);
        if (!content) return null;
        return (
          <div
            key={b.id}
            className="relative"
            id={publicBlockId}
            data-block-id={b.id}
            data-jump-target={publicBlockId}
            data-block-public-id={publicBlockId}
            style={{ zIndex: getBlockRenderStackOrder(b, index, blocks.length) }}
          >
            <BlockRuntimeBoundary blockId={b.id}>
              {content}
            </BlockRuntimeBoundary>
          </div>
        );
      })}
      {openedBlockEntry ? (
        <div
          className={openedBlockOverlayClassName}
          role="dialog"
          aria-modal="true"
          aria-label={openedBlockEntry.title}
        >
          <div className={openedBlockHeaderClassName}>
            <div className={openedBlockHeaderInnerClassName}>
              <button
                type="button"
                className={openedBlockBackButtonClassName}
                onClick={closeOpenedBlock}
              >
                返回
              </button>
              <div className="min-w-0 truncate text-xs font-semibold text-slate-700 sm:text-sm">
                {openedBlockEntry.title}
              </div>
            </div>
          </div>
          <div
            id={openedBlockEntry.publicBlockId}
            data-block-id={openedBlockEntry.block.id}
            data-jump-target={openedBlockEntry.publicBlockId}
            data-block-public-id={openedBlockEntry.publicBlockId}
          >
            <BlockRuntimeBoundary blockId={openedBlockEntry.block.id}>
              {renderBlockContent(openedBlockEntry.block, { openedView: true })}
            </BlockRuntimeBoundary>
          </div>
        </div>
      ) : null}
    </div>
  );
}
