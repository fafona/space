import type { Block } from "@/data/homeBlocks";
import {
  formatMerchantOrderAmount,
  MERCHANT_ORDER_MAX_ITEM_QUANTITY,
  MERCHANT_ORDER_MAX_LINE_ITEMS,
  parseMerchantOrderPriceValue,
  type MerchantOrderLineItemInput,
} from "@/lib/merchantOrders";
import { isMeaningfulProductItem, normalizeProductItems } from "@/lib/productBlock";

type PublishedProductBlock = Extract<Block, { type: "product" }>;
export type ProductCatalogViewport = "desktop" | "mobile";

type PublishedProductBlockCandidate = {
  block: PublishedProductBlock;
  viewport: ProductCatalogViewport | null;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function collectPublishedProductBlocks(
  value: unknown,
  blockId: string,
  results: PublishedProductBlockCandidate[],
  visited: WeakSet<object>,
  viewport: ProductCatalogViewport | null,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPublishedProductBlocks(item, blockId, results, visited, viewport));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (visited.has(value)) return;
  visited.add(value);

  const record = value as Record<string, unknown>;
  if (record.type === "product" && trimText(record.id) === blockId && record.props && typeof record.props === "object") {
    results.push({ block: record as unknown as PublishedProductBlock, viewport });
  }
  Object.entries(record).forEach(([key, item]) => {
    const normalizedKey = key.toLowerCase();
    const childViewport = normalizedKey.includes("mobile") && normalizedKey.includes("plan")
      ? "mobile"
      : key === "pagePlanConfig"
        ? "desktop"
        : viewport;
    collectPublishedProductBlocks(item, blockId, results, visited, childViewport);
  });
}

export function findPublishedProductBlockCandidates(blocks: Block[], blockId: string) {
  const normalizedBlockId = trimText(blockId);
  if (!normalizedBlockId || !Array.isArray(blocks)) return [];
  const results: PublishedProductBlockCandidate[] = [];
  collectPublishedProductBlocks(blocks, normalizedBlockId, results, new WeakSet<object>(), null);
  return results;
}

export function findPublishedProductBlocks(blocks: Block[], blockId: string) {
  return findPublishedProductBlockCandidates(blocks, blockId).map((candidate) => candidate.block);
}

function normalizeRequestedQuantity(value: unknown) {
  const quantity = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MERCHANT_ORDER_MAX_ITEM_QUANTITY) {
    throw new Error("order_quantity_invalid");
  }
  return quantity;
}

export function quotePublishedProductOrder(input: {
  blocks: Block[];
  blockId: string;
  items: MerchantOrderLineItemInput[];
  viewport?: ProductCatalogViewport | null;
}) {
  const requestedItems = Array.isArray(input.items) ? input.items : [];
  if (requestedItems.length === 0) throw new Error("order_items_required");
  if (requestedItems.length > MERCHANT_ORDER_MAX_LINE_ITEMS) throw new Error("order_too_many_items");

  const requested = requestedItems.map((item) => ({
    productId: trimText(item?.productId),
    quantity: normalizeRequestedQuantity(item?.quantity),
  }));
  const requestedIds = new Set<string>();
  for (const item of requested) {
    if (!item.productId || requestedIds.has(item.productId)) throw new Error("order_item_invalid");
    requestedIds.add(item.productId);
  }

  const candidates = findPublishedProductBlockCandidates(input.blocks, input.blockId).map((candidate) => ({
    ...candidate,
    products: normalizeProductItems(candidate.block.props.products).filter((item) => isMeaningfulProductItem(item)),
  }));
  if (candidates.length === 0) throw new Error("order_product_block_not_found");

  for (const requestedItem of requested) {
    const prices = new Set(
      candidates
        .flatMap((candidate) => candidate.products.filter((product) => product.id === requestedItem.productId))
        .map((product) => parseMerchantOrderPriceValue(product.price).toFixed(6)),
    );
    if (prices.size > 1) throw new Error("order_product_catalog_conflict");
  }

  const requestedViewport = input.viewport === "mobile" || input.viewport === "desktop" ? input.viewport : null;
  const viewportCandidates = requestedViewport
    ? candidates.filter((candidate) => candidate.viewport === requestedViewport || candidate.viewport === null)
    : candidates;
  const scopedCandidates = viewportCandidates.length > 0 ? viewportCandidates : candidates;

  for (const candidate of scopedCandidates) {
    const { block, products } = candidate;
    const productMap = new Map(products.map((item) => [item.id, item] as const));
    if (!requested.every((item) => productMap.has(item.productId))) continue;

    const pricePrefix = trimText(block.props.productPricePrefix);
    return {
      blockId: block.id,
      pricePrefix,
      items: requested.map((requestedItem) => {
        const product = productMap.get(requestedItem.productId)!;
        const unitPrice = parseMerchantOrderPriceValue(product.price);
        return {
          productId: product.id,
          code: product.code,
          name: product.name,
          description: product.description,
          imageUrl: product.imageUrl,
          tag: product.tag,
          quantity: requestedItem.quantity,
          unitPrice,
          unitPriceText: formatMerchantOrderAmount(unitPrice, pricePrefix),
        } satisfies MerchantOrderLineItemInput;
      }),
    };
  }

  throw new Error("order_product_not_found");
}
