import type { Block } from "@/data/homeBlocks";
import { getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { normalizeProductItems } from "@/lib/productBlock";
import type { MerchantCatalog } from "@/lib/merchantCatalog";
import { createMerchantCatalogCollectionResolver } from "@/lib/merchantCatalogReadIndex";
import type { TrafficResource } from "@/lib/accountTraffic";
import { normalizePollConfig } from "@/lib/merchantPolls";

/** Resolve ONLY the active published plan, not drafts or a caller's labels. */
export function resolveTrafficResources(input: { siteId: string; blocks: Block[]; pageId: string; viewport: "desktop" | "mobile"; catalog: MerchantCatalog | null }): TrafficResource[] {
  let blocks = input.blocks;
  if (!blocks.length) return [];
  if (input.viewport === "mobile") {
    blocks = blocks.map((block) => {
      const props = block.props as Record<string, unknown>;
      return props.pagePlanConfigMobile ? { ...block, props: { ...props, pagePlanConfig: props.pagePlanConfigMobile } } as Block : block;
    });
  }
  const config = getPagePlanConfigFromBlocks(blocks);
  const plan = config.plans.find((item) => item.id === config.activePlanId) ?? config.plans[0];
  const page = plan?.pages.find((item) => item.id === input.pageId);
  if (!page) return [];
  const result: TrafficResource[] = [
    { siteId: input.siteId, module: "website", objectId: page.id, label: page.name || "网站页面" },
    { siteId: input.siteId, module: "membership", objectId: "membership-entry", label: "会员入口" },
  ];
  // Prepare only for an actual product resource, and only for this invocation.
  // Retaining an index across calls could hide a later catalog change.
  let resolveCollection: ReturnType<typeof createMerchantCatalogCollectionResolver> | undefined;
  for (const block of page.blocks) {
    if (block.type !== "product" && block.type !== "booking" && block.type !== "coupon" && block.type !== "poll") continue;
    const heading = (block.props as { heading?: string }).heading;
    const objectId = block.type === "poll" ? `${block.id}/${normalizePollConfig(block.props, block.id).pollId}` : block.id;
    const defaults = { product: "产品模块", booking: "预约模块", coupon: "优惠券模块", poll: "投票模块" };
    result.push({ siteId: input.siteId, module: block.type, objectId, label: heading || defaults[block.type] });
    if (block.type !== "product") continue;
    const collection = input.catalog &&
      (resolveCollection ??= createMerchantCatalogCollectionResolver(input.catalog))(block.id, input.viewport);
    const collectionProductIds = collection ? new Set(collection.productIds) : null;
    const products = collectionProductIds && input.catalog
      ? input.catalog.products.filter((item) => collectionProductIds.has(item.id) && item.availability !== "hidden")
      : normalizeProductItems(block.props.products);
    for (const product of products) {
      // Namespace legacy products by block: independent blocks can reuse IDs.
      const objectId = `${block.id}/${product.id}`;
      if (objectId.length <= 240) result.push({ siteId: input.siteId, module: "product", objectId, label: product.name || product.id });
    }
  }
  return result.filter((item) => item.objectId.length <= 240);
}
