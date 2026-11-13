import type { Block } from "@/data/homeBlocks";
import { getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { normalizeMerchantIndustryTabs } from "@/lib/merchantIndustryTabs";
import { normalizeMerchantCardCount } from "@/lib/merchantCardLayout";

/** Display-only adaptation: never write the published source or the merchant editor. */
export function serviceDirectoryBlocks(source: Block[], containerWidth: number) {
  const config = getPagePlanConfigFromBlocks(source);
  const plan = config.plans.find(plan => plan.id === config.activePlanId) ?? config.plans[0];
  const page = plan?.pages.find(page => page.id === "page-1") ?? plan?.pages[0];
  const candidates = [...(page?.blocks ?? plan?.blocks ?? []), ...source];
  const choices: Array<Block | undefined> = [candidates.find(block => block.type === "search-bar"), candidates.find(block => block.type === "merchant-list")];
  const chosen = choices.filter((block): block is Block => Boolean(block));
  const width = Math.max(160, Math.floor(containerWidth - 32)), narrow = width < 560;
  const columns = narrow ? 1 : width < 900 ? 2 : 3;
  return chosen.map(block => {
    const props = { ...block.props, searchEventName: "faolla:service-directory-search", blockOffsetX: 0, blockOffsetY: 0, blockHeight: undefined, blockWidth: width + 32, mobileFitScreenWidth: false };
    if (block.type === "merchant-list") {
      const tabs = normalizeMerchantIndustryTabs(block.props.industryTabs), count = normalizeMerchantCardCount(block.props.maxItems);
      const tabColumns = Math.max(1, Math.floor(width / 108)), cardTop = Math.ceil(tabs.length / tabColumns) * 42 + 12;
      const layout: Record<string, { x: number; y: number; width: number; height: number }> = {};
      tabs.forEach((_tab,index) => { layout[`tab${index+1}`] = { x: (index % tabColumns) * 108, y: Math.floor(index / tabColumns) * 42, width: Math.min(100,width), height: 34 }; });
      const cardWidth = Math.floor((width - (columns-1)*14) / columns);
      for(let index=0;index<count;index++) layout[`card${index+1}`] = { x: (index % columns)*(cardWidth+14), y: cardTop+Math.floor(index/columns)*166, width: cardWidth, height: 152 };
      const pagerY = cardTop + Math.ceil(count/columns)*166;
      layout.prev = { x:0,y:pagerY,width:100,height:36 }; layout.next = { x:112,y:pagerY,width:100,height:36 };
      return { ...block, props: { ...props, merchantCardLayout: layout } } as Block;
    }
    if (block.type === "search-bar") {
      const locationWidth = narrow ? Math.floor((width-10)/2) : Math.floor((width-102)/3);
      const layout = narrow ? {
        locate:{x:0,y:0,width:72,height:40},country:{x:82,y:0,width:width-82,height:40},
        province:{x:0,y:52,width:locationWidth,height:40},city:{x:locationWidth+10,y:52,width:locationWidth,height:40},
        keyword:{x:0,y:104,width:width-82,height:40},action:{x:width-72,y:104,width:72,height:40},
      } : { locate:{x:0,y:0,width:72,height:40},country:{x:82,y:0,width:locationWidth,height:40},
        province:{x:92+locationWidth,y:0,width:locationWidth,height:40},city:{x:102+locationWidth*2,y:0,width:locationWidth,height:40},
        keyword:{x:0,y:52,width:width-82,height:40},action:{x:width-72,y:52,width:72,height:40} };
      return { ...block, props: { ...props, searchLayout: layout } } as Block;
    }
    return block;
  });
}
