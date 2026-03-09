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

export default function BlockRenderer({
  blocks,
  currentPageId,
  onNavigatePage,
}: {
  blocks: Block[];
  currentPageId?: string;
  onNavigatePage?: (pageId: string) => void;
}) {
  if (!blocks || blocks.length === 0) return null;

  return (
    <>
      {blocks.map((b) => {
        switch (b.type) {
          case "common":
            return <CommonBlock key={b.id} {...b.props} />;
          case "gallery":
            return <GalleryBlock key={b.id} {...b.props} />;
          case "chart":
            return <ChartBlock key={b.id} {...b.props} />;
          case "nav":
            return <NavBlock key={b.id} {...b.props} currentPageId={currentPageId} onNavigatePage={onNavigatePage} />;
          case "hero":
            return <HeroBlock key={b.id} {...b.props} />;
          case "text":
            return <TextBlock key={b.id} {...b.props} />;
          case "list":
            return <ListBlock key={b.id} {...b.props} />;
          case "search-bar":
            return <SearchBarBlock key={b.id} {...b.props} />;
          case "merchant-list":
            return <MerchantListBlock key={b.id} {...b.props} />;
          case "contact":
            return <ContactBlock key={b.id} {...b.props} />;
          case "music":
            return <MusicBlock key={b.id} {...b.props} />;
          case "product":
            return <ProductBlock key={b.id} {...b.props} />;
          default:
            return null;
        }
      })}
    </>
  );
}
