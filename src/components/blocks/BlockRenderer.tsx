"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
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
const ProductBlock = dynamic(() => import("./ProductBlock"), { loading: () => null });
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
  const [openedProductCartOpen, setOpenedProductCartOpen] = useState(false);
  const [openedProductCartCloseSignal, setOpenedProductCartCloseSignal] = useState(0);
  const openedBlockTouchStartYRef = useRef<number | null>(null);
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
    setOpenedProductCartOpen(false);
    setOpenedBlockId(null);
  }, []);
  const handleOpenedProductCartStateChange = useCallback((open: boolean) => {
    setOpenedProductCartOpen(open);
  }, []);
  const handleOpenedBlockTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    openedBlockTouchStartYRef.current = event.touches[0]?.clientY ?? null;
  }, []);
  const handleOpenedBlockTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const startY = openedBlockTouchStartYRef.current;
    const touch = event.touches[0];
    if (startY === null || !touch) return;
    event.stopPropagation();

    const target = event.currentTarget;
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const deltaY = touch.clientY - startY;
    const pullingDownPastTop = target.scrollTop <= 0 && deltaY > 0;
    const pullingUpPastBottom = target.scrollTop >= maxScrollTop - 1 && deltaY < 0;

    if (maxScrollTop <= 0 || pullingDownPastTop || pullingUpPastBottom) {
      if (event.cancelable) event.preventDefault();
    }
  }, []);
  const handleOpenedBlockTouchEnd = useCallback(() => {
    openedBlockTouchStartYRef.current = null;
  }, []);

  useEffect(() => {
    if (!openedBlockEntry || typeof document === "undefined") return;
    document.documentElement.dataset.faollaOpenedBlock = "true";
    document.body.dataset.faollaOpenedBlock = "true";
    return () => {
      delete document.documentElement.dataset.faollaOpenedBlock;
      delete document.body.dataset.faollaOpenedBlock;
    };
  }, [openedBlockEntry]);

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

  function renderBlockContent(
    b: Block,
    options: {
      openedView?: boolean;
      openedToolbarTargetId?: string;
      openedCartTargetId?: string;
      openedCartCloseEventName?: string;
      openedCartCloseSignal?: number;
      onOpenedCartStateChange?: (open: boolean) => void;
    } = {},
  ): ReactNode {
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
            runtimeInteractiveOverlayWithinBlock={forceMobileViewport || options.openedView === true}
            runtimeDisableCartPortal={options.openedView === true}
            runtimeOpenedView={options.openedView === true}
            runtimeOpenedToolbarTargetId={options.openedToolbarTargetId}
            runtimeOpenedCartTargetId={options.openedCartTargetId}
            runtimeOpenedCartCloseEventName={options.openedCartCloseEventName}
            runtimeOpenedCartCloseSignal={options.openedCartCloseSignal}
            runtimeOnOpenedCartStateChange={options.onOpenedCartStateChange}
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

  const openedBlockIsProduct = openedBlockEntry?.block.type === "product";
  const openedBlockHasToolbar = Boolean(openedBlockIsProduct && !openedProductCartOpen);
  const openedBlockOverlayClassName = forceMobileViewport
    ? "faolla-opened-block-overlay absolute inset-0 z-[2147482000] flex flex-col overflow-hidden overscroll-contain bg-white text-slate-950"
    : "faolla-opened-block-overlay fixed inset-0 z-[2147482000] flex flex-col overflow-hidden overscroll-contain bg-white text-slate-950";
  const openedBlockHeaderClassName = forceMobileViewport
    ? openedBlockHasToolbar
      ? "faolla-opened-block-header sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur"
      : "faolla-opened-block-header sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur"
    : openedBlockHasToolbar
      ? "faolla-opened-block-header sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-2 py-2 shadow-sm backdrop-blur"
      : "faolla-opened-block-header sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur";
  const openedBlockHeaderInnerClassName = forceMobileViewport
    ? "faolla-opened-block-header-inner flex w-full min-w-0 items-center gap-2"
    : "faolla-opened-block-header-inner mx-auto flex w-full max-w-6xl items-center gap-3";
  const openedBlockBackButtonClassName = forceMobileViewport
    ? "faolla-opened-block-back inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
    : "faolla-opened-block-back inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 shadow-sm hover:bg-slate-50";
  const openedBlockBodyClassName = openedProductCartOpen
    ? "faolla-opened-block-body faolla-hide-scrollbar relative min-h-0 flex-1 overflow-hidden overscroll-contain bg-white"
    : openedBlockHasToolbar
      ? "faolla-opened-block-body faolla-hide-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white pb-[calc(env(safe-area-inset-bottom)+6.5rem)]"
      : "faolla-opened-block-body faolla-hide-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white";
  const openedToolbarTargetId = openedBlockEntry ? `faolla-opened-block-toolbar-${openedBlockEntry.block.id}` : "";
  const openedCartTargetId = openedBlockEntry ? `faolla-opened-block-cart-${openedBlockEntry.block.id}` : "";
  const openedCartCloseEventName = openedBlockEntry ? `faolla-opened-block-cart-close:${openedBlockEntry.block.id}` : "";
  const openedBlockTitleClassName = openedBlockHasToolbar
    ? "faolla-opened-block-title faolla-opened-block-title-toolbar min-w-[4.5rem] max-w-[6.5rem] shrink-0 truncate text-sm font-semibold text-slate-700"
    : "faolla-opened-block-title min-w-0 flex-1 truncate text-xs font-semibold text-slate-700 sm:text-sm";
  const openedBlockTitleText = openedProductCartOpen ? "购物车" : openedBlockEntry?.title;
  const openedPortalHost = typeof document !== "undefined" ? document.body : null;
  const handleOpenedBlockBackClick = () => {
    if (openedProductCartOpen && openedCartCloseEventName && typeof window !== "undefined") {
      setOpenedProductCartCloseSignal((value) => value + 1);
      window.dispatchEvent(new Event(openedCartCloseEventName));
      setOpenedProductCartOpen(false);
      return;
    }
    closeOpenedBlock();
  };

  const openedBlockOverlay = openedBlockEntry ? (
    <div
      className={openedBlockOverlayClassName}
      role="dialog"
      aria-modal="true"
      aria-label={openedBlockTitleText}
    >
      <div className={openedBlockHeaderClassName}>
        <div className={openedBlockHeaderInnerClassName}>
          <button
            type="button"
            className={openedBlockBackButtonClassName}
            onClick={handleOpenedBlockBackClick}
            aria-label="返回"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={forceMobileViewport ? "h-4.5 w-4.5" : "h-5 w-5"}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className={openedBlockTitleClassName}>
            {openedBlockTitleText}
          </div>
          {openedBlockHasToolbar ? (
            <div id={openedToolbarTargetId} className="faolla-opened-block-toolbar-target ml-auto flex min-w-0 flex-1 justify-end" />
          ) : null}
        </div>
      </div>
      <div
        id={openedBlockEntry.publicBlockId}
        data-block-id={openedBlockEntry.block.id}
        data-jump-target={openedBlockEntry.publicBlockId}
        data-block-public-id={openedBlockEntry.publicBlockId}
        className={openedBlockBodyClassName}
        onTouchStart={handleOpenedBlockTouchStart}
        onTouchMove={handleOpenedBlockTouchMove}
        onTouchEnd={handleOpenedBlockTouchEnd}
        onTouchCancel={handleOpenedBlockTouchEnd}
      >
        <BlockRuntimeBoundary blockId={openedBlockEntry.block.id}>
          {renderBlockContent(openedBlockEntry.block, {
            openedView: true,
            openedToolbarTargetId,
            openedCartTargetId,
            openedCartCloseEventName,
            openedCartCloseSignal: openedProductCartCloseSignal,
            onOpenedCartStateChange: handleOpenedProductCartStateChange,
          })}
        </BlockRuntimeBoundary>
      </div>
      {openedBlockIsProduct && !openedProductCartOpen ? (
        <div
          id={openedCartTargetId}
          className="faolla-opened-block-cart-target pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.85rem)] z-[2147482100] px-4"
        />
      ) : null}
    </div>
  ) : null;

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
      {openedBlockOverlay
        ? forceMobileViewport || !openedPortalHost
          ? openedBlockOverlay
          : createPortal(openedBlockOverlay, openedPortalHost)
        : null}
    </div>
  );
}
