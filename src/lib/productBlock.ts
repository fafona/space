export type ProductLayoutPreset = "grid-2" | "grid-3" | "grid-4" | "list" | "spotlight";
export type ProductImageAspectRatio = "square" | "landscape" | "portrait";
export type ProductPriceAlign = "left" | "center" | "right";
export type ProductContainerMode = "auto" | "paged" | "scroll";
export type ProductTagPosition = "top" | "left" | "right";

export type ProductItemInput = {
  id?: string;
  code?: string;
  name?: string;
  description?: string;
  price?: string;
  imageUrl?: string;
  tag?: string;
};

export type ProductItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  tag: string;
};

export const PRODUCT_LAYOUT_OPTIONS: Array<{ value: ProductLayoutPreset; label: string }> = [
  { value: "grid-2", label: "双列卡片" },
  { value: "grid-3", label: "三列卡片" },
  { value: "grid-4", label: "四列卡片" },
  { value: "list", label: "纵向列表" },
  { value: "spotlight", label: "焦点陈列" },
];

export const PRODUCT_IMAGE_ASPECT_OPTIONS: Array<{ value: ProductImageAspectRatio; label: string }> = [
  { value: "square", label: "正方形" },
  { value: "landscape", label: "横图" },
  { value: "portrait", label: "竖图" },
];

export const PRODUCT_PRICE_PREFIX_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "¥", label: "人民币 ¥" },
  { value: "$", label: "美元 $" },
  { value: "€", label: "欧元 €" },
  { value: "£", label: "英镑 £" },
  { value: "JPY ¥", label: "日元 JPY ¥" },
  { value: "₩", label: "韩元 ₩" },
  { value: "HK$", label: "港币 HK$" },
  { value: "MOP$", label: "澳门元 MOP$" },
  { value: "NT$", label: "新台币 NT$" },
  { value: "S$", label: "新加坡元 S$" },
  { value: "A$", label: "澳元 A$" },
  { value: "C$", label: "加元 C$" },
  { value: "CHF", label: "瑞士法郎 CHF" },
  { value: "AED", label: "迪拉姆 AED" },
];

export const PRODUCT_PRICE_ALIGN_OPTIONS: Array<{ value: ProductPriceAlign; label: string }> = [
  { value: "left", label: "左" },
  { value: "center", label: "中" },
  { value: "right", label: "右" },
];

export const PRODUCT_CONTAINER_MODE_OPTIONS: Array<{ value: ProductContainerMode; label: string }> = [
  { value: "auto", label: "随产品延伸" },
  { value: "paged", label: "固定大小翻页" },
  { value: "scroll", label: "固定大小滑动" },
];

export const PRODUCT_TAG_POSITION_OPTIONS: Array<{ value: ProductTagPosition; label: string }> = [
  { value: "top", label: "上侧" },
  { value: "left", label: "左侧" },
  { value: "right", label: "右侧" },
];

export function normalizeProductTagOptions(source: unknown): string[] {
  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  source.forEach((item) => {
    const value = String(item ?? "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    next.push(value);
  });
  return next;
}

export function arrangeProductItemsByTag<T extends { tag?: string }>(items: T[], tagOptions: string[], enabled: boolean) {
  if (!enabled) return items;
  const normalizedTagOptions = normalizeProductTagOptions(tagOptions);
  const knownOrder = new Map<string, number>();
  normalizedTagOptions.forEach((tag, index) => {
    knownOrder.set(tag, index);
  });
  const fallbackOrder = new Map<string, number>();
  let fallbackIndex = normalizedTagOptions.length;
  items.forEach((item) => {
    const tag = String(item.tag ?? "").trim();
    if (!tag || knownOrder.has(tag) || fallbackOrder.has(tag)) return;
    fallbackOrder.set(tag, fallbackIndex);
    fallbackIndex += 1;
  });
  return items
    .map((item, index) => ({
      item,
      index,
      rank: (() => {
        const tag = String(item.tag ?? "").trim();
        if (!tag) return Number.MAX_SAFE_INTEGER;
        return knownOrder.get(tag) ?? fallbackOrder.get(tag) ?? Number.MAX_SAFE_INTEGER;
      })(),
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

export function groupArrangedProductItemsByTag<T extends { tag?: string }>(items: T[]) {
  const groups: Array<{ tag: string; items: T[] }> = [];
  items.forEach((item) => {
    const tag = String(item.tag ?? "").trim();
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.tag === tag) {
      lastGroup.items.push(item);
      return;
    }
    groups.push({ tag, items: [item] });
  });
  return groups;
}

export function isMeaningfulProductItem(item: ProductItemInput | ProductItem | undefined) {
  if (!item) return false;
  return Boolean(
    String(item.code ?? "").trim() ||
      String(item.name ?? "").trim() ||
      String(item.description ?? "").trim() ||
      String(item.price ?? "").trim() ||
      String(item.imageUrl ?? "").trim() ||
      String(item.tag ?? "").trim(),
  );
}

export function normalizeProductCode(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function createProductItemId() {
  return `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeProductItems(source: ProductItemInput[] | undefined): ProductItem[] {
  if (!Array.isArray(source)) return [];
  return source.map((item) => ({
    id: (item?.id ?? "").trim() || createProductItemId(),
    code: (item?.code ?? "").trim(),
    name: (item?.name ?? "").trim(),
    description: (item?.description ?? "").trim(),
    price: (item?.price ?? "").trim(),
    imageUrl: (item?.imageUrl ?? "").trim(),
    tag: (item?.tag ?? "").trim(),
  }));
}

export function normalizeProductLayoutPreset(value: unknown): ProductLayoutPreset {
  return PRODUCT_LAYOUT_OPTIONS.some((item) => item.value === value) ? (value as ProductLayoutPreset) : "list";
}

export function normalizeProductImageAspectRatio(value: unknown): ProductImageAspectRatio {
  return PRODUCT_IMAGE_ASPECT_OPTIONS.some((item) => item.value === value)
    ? (value as ProductImageAspectRatio)
    : "square";
}

export function normalizeProductPriceAlign(value: unknown): ProductPriceAlign {
  return PRODUCT_PRICE_ALIGN_OPTIONS.some((item) => item.value === value) ? (value as ProductPriceAlign) : "left";
}

export function normalizeProductContainerMode(value: unknown): ProductContainerMode {
  return PRODUCT_CONTAINER_MODE_OPTIONS.some((item) => item.value === value) ? (value as ProductContainerMode) : "auto";
}

export function normalizeProductTagPosition(value: unknown): ProductTagPosition {
  if (value === "left") return "left";
  if (value === "right") return "right";
  if (
    value === "image-top-left" ||
    value === "image-top-right" ||
    value === "image-bottom-left" ||
    value === "image-bottom-right" ||
    value === "card-top-left" ||
    value === "card-top-right" ||
    value === "top"
  ) {
    return "top";
  }
  return "top";
}

export function defaultProductItemsPerPage(layout: ProductLayoutPreset) {
  if (layout === "list") return 3;
  if (layout === "grid-2") return 4;
  if (layout === "grid-4") return 8;
  if (layout === "spotlight") return 5;
  return 6;
}

export function normalizeProductItemsPerPage(value: unknown, layout: ProductLayoutPreset) {
  const fallback = defaultProductItemsPerPage(layout);
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(24, Math.round(value)));
}

export function productContainerViewportHeight(
  layout: ProductLayoutPreset,
  imageSize: number,
  visibleItems: number,
) {
  const safeVisibleItems = Math.max(1, Math.min(24, Math.round(visibleItems)));
  const gap = 16;

  if (layout === "list") {
    const listCardHeight = imageSize + 32;
    return safeVisibleItems * listCardHeight + Math.max(0, safeVisibleItems - 1) * gap;
  }

  if (layout === "spotlight") {
    const featuredHeight = imageSize + 220;
    const secondaryHeight = imageSize + 180;
    const secondaryCount = Math.max(0, safeVisibleItems - 1);
    const secondaryRows = Math.ceil(secondaryCount / 2);
    return Math.max(featuredHeight, secondaryRows * secondaryHeight + Math.max(0, secondaryRows - 1) * gap);
  }

  const columnCount = layout === "grid-2" ? 2 : layout === "grid-4" ? 4 : 3;
  const gridCardHeight = imageSize + 180;
  const rowCount = Math.ceil(safeVisibleItems / columnCount);
  return rowCount * gridCardHeight + Math.max(0, rowCount - 1) * gap;
}

export function productImageAspectRatioValue(value: ProductImageAspectRatio) {
  if (value === "landscape") return "4 / 3";
  if (value === "portrait") return "3 / 4";
  return "1 / 1";
}

export function productGridClass(layout: ProductLayoutPreset) {
  if (layout === "grid-2") return "grid grid-cols-1 md:grid-cols-2 gap-4";
  if (layout === "grid-4") return "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4";
  if (layout === "list") return "space-y-4";
  return "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4";
}

export function productPriceText(price: string, prefix = "") {
  const safePrice = (price ?? "").trim();
  if (!safePrice) return "";
  if (!prefix) return safePrice;
  return `${prefix}${safePrice}`;
}
