"use client";

import { Component, type ReactNode } from "react";
import type { Block } from "@/data/homeBlocks";
import HeroBlock from "./HeroBlock";
import TextBlock from "./TextBlock";
import ListBlock from "./ListBlock";
import SearchBarBlock from "./SearchBarBlock";
import MerchantListBlock from "./MerchantListBlock";
import ContactBlock from "./ContactBlock";
import CommonBlock from "./CommonBlock";
import GalleryBlock from "./GalleryBlock";
import ChartBlock from "./ChartBlock";
import MusicBlock from "./MusicBlock";
import NavBlock from "./NavBlock";
import ProductBlock from "./ProductBlock";
import BookingBlock from "./BookingBlock";
import ButtonBlock from "./ButtonBlock";
import { getBlockRenderStackOrder } from "@/lib/blockStacking";
import { buildPublicBlockId } from "@/lib/blockPublicId";
import type { MerchantBookingRuleViewport } from "@/lib/merchantBookingRules";

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

export default function BlockRenderer({
  blocks,
  currentPageId,
  currentPageIndex = 0,
  availablePages,
  onNavigatePage,
  bookingSiteId,
  bookingSiteName,
  bookingInteractive = true,
  bookingViewport,
}: {
  blocks: Block[];
  currentPageId?: string;
  currentPageIndex?: number;
  availablePages?: Array<{ id: string; name?: string }>;
  onNavigatePage?: (pageId: string) => void;
  bookingSiteId?: string;
  bookingSiteName?: string;
  bookingInteractive?: boolean;
  bookingViewport?: MerchantBookingRuleViewport;
}) {
  if (!blocks || blocks.length === 0) return null;

  return (
    <>
      {blocks.map((b, index) => {
        const publicBlockId = buildPublicBlockId(currentPageIndex, index);
        let content: ReactNode = null;
        switch (b.type) {
          case "common":
            content = <CommonBlock {...b.props} />;
            break;
          case "button":
            content = <ButtonBlock {...b.props} availablePages={availablePages} onNavigatePage={onNavigatePage} />;
            break;
          case "gallery":
            content = <GalleryBlock {...b.props} />;
            break;
          case "chart":
            content = <ChartBlock {...b.props} />;
            break;
          case "nav":
            content = <NavBlock {...b.props} currentPageId={currentPageId} onNavigatePage={onNavigatePage} />;
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
            content = <ProductBlock {...b.props} />;
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
    </>
  );
}
