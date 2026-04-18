"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";
import type { BackgroundEditableProps, BlockBorderStyle, TypographyEditableProps } from "@/data/homeBlocks";
import {
  arrangeProductItemsByTag,
  filterProductItemsByKeyword,
  groupArrangedProductItemsByTag,
  isMeaningfulProductItem,
  normalizeProductContainerMode,
  normalizeProductImageAspectRatio,
  normalizeProductItems,
  normalizeProductItemsPerPage,
  normalizeProductLayoutPreset,
  normalizeProductPriceAlign,
  normalizeProductTagOptions,
  normalizeProductTagPosition,
  productContainerViewportHeight,
  productGridClass,
  productPriceText,
  type ProductContainerMode,
  type ProductImageAspectRatio,
  type ProductItem,
  type ProductItemInput,
  type ProductLayoutPreset,
  type ProductPriceAlign,
  type ProductTagPosition,
} from "@/lib/productBlock";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { resolveMobileFitCardClass, resolveMobileFitSectionClass } from "./mobileFrame";
import { toRichHtml } from "./richText";
import { useI18n } from "@/components/I18nProvider";
import { resolveLocalizedSystemDefaultText } from "@/lib/editorSystemDefaults";
import {
  formatMerchantOrderAmount,
  parseMerchantOrderPriceValue,
  type MerchantOrderCustomerInput,
} from "@/lib/merchantOrders";

type ProductBlockProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading?: string;
    text?: string;
    products?: ProductItemInput[];
    productSearchEnabled?: boolean;
    productSearchPlaceholder?: string;
    productLayoutPreset?: ProductLayoutPreset;
    productImageAspectRatio?: ProductImageAspectRatio;
    productImageSize?: number;
    productPricePrefix?: string;
    productShowCode?: boolean;
    productShowDescription?: boolean;
    productPriceAlign?: ProductPriceAlign;
    productTagOptions?: string[];
    productTagPosition?: ProductTagPosition;
    productTagFontSize?: number;
    productTagWidth?: number;
    productTagHideUnselected?: boolean;
    productGroupByTag?: boolean;
    productTagBgColor?: string;
    productTagBgOpacity?: number;
    productTagActiveBgColor?: string;
    productTagActiveBgOpacity?: number;
    productContainerMode?: ProductContainerMode;
    productItemsPerPage?: number;
    productDetailImageSize?: number;
    productDetailShowCode?: boolean;
    productDetailShowName?: boolean;
    productDetailShowDescription?: boolean;
    productDetailShowPrice?: boolean;
    productDetailFullImage?: boolean;
    productCardBgColor?: string;
    productCardBgOpacity?: number;
    productCardBorderStyle?: BlockBorderStyle;
    productCardBorderColor?: string;
    productCodeTypography?: TypographyEditableProps;
    productNameTypography?: TypographyEditableProps;
    productDescriptionTypography?: TypographyEditableProps;
    productPriceTypography?: TypographyEditableProps;
    runtimeSiteId?: string;
    runtimeSiteName?: string;
    runtimeBlockId?: string;
    runtimeOrderManagementEnabled?: boolean;
  };

type ProductCartItemState = {
  productId: string;
  quantity: number;
  checked: boolean;
  product: ProductItem;
  unitPrice: number;
  unitPriceText: string;
};

type ProductCartStorageState = {
  customer?: MerchantOrderCustomerInput;
  items?: ProductCartItemState[];
};

const PRODUCT_CART_STORAGE_PREFIX = "merchant-space:product-cart:v1:";

function getProductAspectRatioPair(value: ProductImageAspectRatio) {
  if (value === "landscape") return { width: 4, height: 3 };
  if (value === "portrait") return { width: 3, height: 4 };
  return { width: 1, height: 1 };
}

function toRgba(hex: string, alpha: number) {
  const value = /^#([0-9a-fA-F]{6})$/.test(hex) ? hex : "#ffffff";
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function isGradientToken(value: string) {
  return /^linear-gradient\(/i.test(value.trim());
}

function gradientWithOpacity(value: string, opacity: number) {
  const alpha = Math.max(0, Math.min(1, opacity));
  let next = value.replace(/#([0-9a-fA-F]{6})/g, (match, hex: string) => {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return match;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  });
  next = next.replace(/rgba?\(([^)]+)\)/gi, (match, content: string) => {
    const parts = content.split(",").map((item) => item.trim());
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return match;
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha.toFixed(3)})`;
  });
  return next;
}

function getColorLayerStyle(value: string, opacity: number): CSSProperties {
  const trimmed = value.trim();
  if (isGradientToken(trimmed)) {
    return {
      backgroundImage: opacity < 1 ? gradientWithOpacity(trimmed, opacity) : trimmed,
    };
  }
  return {
    backgroundColor: toRgba(trimmed, opacity),
  };
}

function getSingleLineClampStyle(): CSSProperties {
  return {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

function getMultiLineClampStyle(lines: number): CSSProperties {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } as CSSProperties;
}

function buildTypographyStyle(style: TypographyEditableProps | undefined): CSSProperties {
  const next: CSSProperties = {};
  const fontFamily = (style?.fontFamily ?? "").trim();
  const fontColor = (style?.fontColor ?? "").trim();
  if (fontFamily) next.fontFamily = fontFamily;
  if (typeof style?.fontSize === "number" && Number.isFinite(style.fontSize) && style.fontSize > 0) {
    next.fontSize = Math.max(8, Math.min(120, style.fontSize));
  }
  if (style?.fontWeight) next.fontWeight = style.fontWeight;
  if (style?.fontStyle) next.fontStyle = style.fontStyle;
  if (style?.textDecoration) next.textDecoration = style.textDecoration;
  if (fontColor) {
    if (isGradientToken(fontColor)) {
      next.backgroundImage = fontColor;
      next.backgroundClip = "text";
      next.WebkitBackgroundClip = "text";
      next.color = "transparent";
    } else {
      next.color = fontColor;
    }
  }
  return next;
}

function getReadableTagTextColor(value: string) {
  const trimmed = value.trim();
  if (!/^#([0-9a-fA-F]{6})$/.test(trimmed)) return "#ffffff";
  const r = Number.parseInt(trimmed.slice(1, 3), 16);
  const g = Number.parseInt(trimmed.slice(3, 5), 16);
  const b = Number.parseInt(trimmed.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.68 ? "#0f172a" : "#ffffff";
}

function getProductCardDomId(id: string) {
  return `product-card-${id}`;
}

function getProductGroupTagKey(tag: string) {
  return encodeURIComponent((tag || "untagged").trim() || "untagged");
}

function getProductCartStorageKey(siteId: string, blockId: string) {
  return `${PRODUCT_CART_STORAGE_PREFIX}${siteId}:${blockId}`;
}

function normalizeCartItems(items: ProductCartItemState[] | undefined, pricePrefix: string) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const quantity = Math.max(0, Math.round(Number(item?.quantity ?? 0) || 0));
      const unitPrice =
        typeof item?.unitPrice === "number" && Number.isFinite(item.unitPrice)
          ? Math.max(0, Number(item.unitPrice.toFixed(2)))
          : parseMerchantOrderPriceValue(String(item?.unitPriceText ?? ""));
      return {
        productId: String(item?.productId ?? "").trim(),
        quantity,
        checked: item?.checked !== false,
        product: {
          id: String(item?.product?.id ?? item?.productId ?? "").trim(),
          code: String(item?.product?.code ?? "").trim(),
          name: String(item?.product?.name ?? "").trim(),
          description: String(item?.product?.description ?? "").trim(),
          imageUrl: normalizePublicAssetUrl(String(item?.product?.imageUrl ?? "").trim()),
          tag: String(item?.product?.tag ?? "").trim(),
          price: String(item?.product?.price ?? "").trim(),
        },
        unitPrice,
        unitPriceText: String(item?.unitPriceText ?? "").trim() || formatMerchantOrderAmount(unitPrice, pricePrefix),
      } satisfies ProductCartItemState;
    })
    .filter((item) => item.quantity > 0 && item.productId);
}

function normalizeCartCustomer(input: MerchantOrderCustomerInput | undefined): MerchantOrderCustomerInput {
  return {
    name: String(input?.name ?? "").trim(),
    phone: String(input?.phone ?? "").trim(),
    email: String(input?.email ?? "").trim(),
    note: String(input?.note ?? "").trim(),
  };
}

function loadProductCartStorageState(storageKey: string, pricePrefix: string): ProductCartStorageState {
  if (typeof window === "undefined" || !storageKey) return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProductCartStorageState;
    return {
      customer: normalizeCartCustomer(parsed.customer),
      items: normalizeCartItems(parsed.items, pricePrefix),
    };
  } catch {
    return {};
  }
}

function saveProductCartStorageState(storageKey: string, next: ProductCartStorageState) {
  if (typeof window === "undefined" || !storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Ignore storage write failures.
  }
}

function renderProductCard(
  item: ReturnType<typeof normalizeProductItems>[number],
  options: {
    imageAspectRatio: ProductImageAspectRatio;
    imageSize: number;
    pricePrefix: string;
    showCode: boolean;
    showDescription: boolean;
    priceAlign: ProductPriceAlign;
    cardBgColor: string;
    cardBgOpacity: number;
    cardBorderStyle: BlockBorderStyle;
    cardBorderColor: string;
    codeTextStyle: CSSProperties;
    nameTextStyle: CSSProperties;
    descriptionTextStyle: CSSProperties;
    priceTextStyle: CSSProperties;
    onOpen: (id: string) => void;
    cartEnabled?: boolean;
    quantity?: number;
    onIncreaseQuantity?: (item: ReturnType<typeof normalizeProductItems>[number]) => void;
    onDecreaseQuantity?: (item: ReturnType<typeof normalizeProductItems>[number]) => void;
    list?: boolean;
    spotlight?: boolean;
  },
) {
  const priceText = productPriceText(item.price, options.pricePrefix);
  const textWrapStyle = { overflowWrap: "anywhere" as const, wordBreak: "break-word" as const };
  const codeClampStyle = getSingleLineClampStyle();
  const nameClampStyle = getMultiLineClampStyle(2);
  const descriptionClampStyle = getMultiLineClampStyle(options.spotlight ? 5 : options.list ? 4 : 3);
  const ratio = getProductAspectRatioPair(options.imageAspectRatio);
  const listImageWidth = Math.max(1, Math.round((options.imageSize * ratio.width) / ratio.height));
  const cardBackgroundStyle = getColorLayerStyle(options.cardBgColor, options.cardBgOpacity);
  const cardBorderClass = getBlockBorderClass(options.cardBorderStyle);
  const cardBorderInlineStyle = getBlockBorderInlineStyle(options.cardBorderStyle, options.cardBorderColor);
  const priceAlignClass =
    options.priceAlign === "center" ? "justify-center text-center" : options.priceAlign === "right" ? "justify-end text-right" : "justify-start text-left";
  const listCardStyle = options.list
    ? ({
        "--product-list-card-height": `${options.imageSize + 32}px`,
      } as CSSProperties)
    : undefined;
  const frameStyle = options.list
    ? {
        width: `${listImageWidth}px`,
        maxWidth: "100%",
        height: `${options.imageSize}px`,
      }
    : {
        width: "100%",
        height: `${options.spotlight ? options.imageSize + 60 : options.imageSize}px`,
      };

  return (
    <div
      key={item.id}
      id={getProductCardDomId(item.id)}
      role="button"
      tabIndex={0}
      onClick={() => options.onOpen(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          options.onOpen(item.id);
        }
      }}
      className={`relative overflow-hidden rounded-2xl shadow-sm ${cardBorderClass} ${
        options.list
          ? "flex w-full cursor-pointer flex-col gap-4 p-4 text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 sm:h-[var(--product-list-card-height)] sm:max-h-[var(--product-list-card-height)] sm:flex-row"
          : "flex h-full w-full cursor-pointer flex-col text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
      } ${options.spotlight ? "lg:min-h-[420px]" : ""}`}
      style={{ ...cardBackgroundStyle, ...cardBorderInlineStyle, ...listCardStyle }}
    >
      {options.cartEnabled ? (
        <div className="absolute right-3 top-3 z-[2] flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full text-base font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              options.onDecreaseQuantity?.(item);
            }}
            disabled={!options.quantity}
            aria-label="减少购买数量"
          >
            -
          </button>
          <div className="min-w-[1.5rem] text-center text-xs font-semibold text-slate-700">{options.quantity ?? 0}</div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-full text-base font-semibold text-slate-700 transition hover:bg-slate-100"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              options.onIncreaseQuantity?.(item);
            }}
            aria-label="增加购买数量"
          >
            +
          </button>
        </div>
      ) : null}
      <div
        className={`relative overflow-hidden bg-slate-100 ${options.list ? "shrink-0 self-start rounded-xl" : ""}`}
        style={frameStyle}
      >
        {item.imageUrl ? (
          <Image src={item.imageUrl} alt={item.name || item.code || "产品图片"} fill unoptimized sizes="100vw" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无图片</div>
        )}
      </div>
      <div className={options.list ? "flex min-w-0 flex-1 flex-col overflow-hidden" : "flex min-h-[180px] flex-1 flex-col overflow-hidden p-4"}>
        {options.showCode && item.code ? (
          <div
            className="text-xs uppercase tracking-[0.24em] text-slate-500"
            style={{ ...textWrapStyle, ...codeClampStyle, ...options.codeTextStyle }}
          >
            {item.code}
          </div>
        ) : null}
        <h3 className="mt-2 text-lg font-semibold text-slate-900" style={{ ...textWrapStyle, ...nameClampStyle, ...options.nameTextStyle }}>
          {item.name || "未命名产品"}
        </h3>
        {options.showDescription && item.description ? (
          <p className="mt-2 text-sm leading-6 text-slate-600" style={{ ...textWrapStyle, ...descriptionClampStyle, ...options.descriptionTextStyle }}>
            {item.description}
          </p>
        ) : null}
        {priceText ? (
          <div className={`mt-auto flex min-h-[2.75rem] w-full shrink-0 items-end pt-4 text-lg font-semibold text-sky-700 ${priceAlignClass}`}>
            <div className="w-full" style={options.priceTextStyle}>
              {priceText}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ProductBlock(props: ProductBlockProps) {
  const mobileFitScreenWidth = props.mobileFitScreenWidth === true;
  const { locale } = useI18n();
  const products = normalizeProductItems(props.products)
    .map((item) => ({
      ...item,
      imageUrl: normalizePublicAssetUrl(item.imageUrl),
    }))
    .filter((item) => isMeaningfulProductItem(item));
  const productTags = Array.from(
    new Set([...normalizeProductTagOptions(props.productTagOptions), ...products.map((item) => item.tag).filter(Boolean)]),
  );
  const groupedByTag = props.productGroupByTag === true;
  const arrangedProducts = arrangeProductItemsByTag(products, productTags, groupedByTag);
  const layoutPreset = normalizeProductLayoutPreset(props.productLayoutPreset);
  const containerMode = normalizeProductContainerMode(props.productContainerMode);
  const itemsPerPage = normalizeProductItemsPerPage(props.productItemsPerPage, layoutPreset);
  const imageAspectRatio = normalizeProductImageAspectRatio(props.productImageAspectRatio);
  const imageSize =
    typeof props.productImageSize === "number" && Number.isFinite(props.productImageSize)
      ? Math.max(40, Math.min(420, Math.round(props.productImageSize)))
      : 220;
  const pricePrefix = (props.productPricePrefix ?? "").trim();
  const productSearchEnabled = props.productSearchEnabled !== false;
  const productSearchPlaceholder = resolveLocalizedSystemDefaultText(
    props.productSearchPlaceholder,
    "搜索产品名称/编号/介绍",
    locale,
  );
  const showCode = props.productShowCode !== false;
  const showDescription = props.productShowDescription !== false;
  const priceAlign = normalizeProductPriceAlign(props.productPriceAlign);
  const tagPosition = normalizeProductTagPosition(props.productTagPosition);
  const tagFontSize =
    typeof props.productTagFontSize === "number" && Number.isFinite(props.productTagFontSize)
      ? Math.max(10, Math.min(28, Math.round(props.productTagFontSize)))
      : 12;
  const tagWidth =
    typeof props.productTagWidth === "number" && Number.isFinite(props.productTagWidth)
      ? Math.max(56, Math.min(220, Math.round(props.productTagWidth)))
      : 92;
  const tagHideUnselected = props.productTagHideUnselected !== false;
  const tagBgColor = (props.productTagBgColor ?? "#0f172a").trim() || "#0f172a";
  const tagBgOpacity =
    typeof props.productTagBgOpacity === "number" && Number.isFinite(props.productTagBgOpacity)
      ? Math.max(0, Math.min(1, props.productTagBgOpacity))
      : 0.82;
  const tagActiveBgColor = (props.productTagActiveBgColor ?? "#1d4ed8").trim() || "#1d4ed8";
  const tagActiveBgOpacity =
    typeof props.productTagActiveBgOpacity === "number" && Number.isFinite(props.productTagActiveBgOpacity)
      ? Math.max(0, Math.min(1, props.productTagActiveBgOpacity))
      : 0.94;
  const detailImageSize =
    typeof props.productDetailImageSize === "number" && Number.isFinite(props.productDetailImageSize)
      ? Math.max(180, Math.min(720, Math.round(props.productDetailImageSize)))
      : 420;
  const detailRatioPair = getProductAspectRatioPair(imageAspectRatio);
  const detailImageWidth = Math.max(180, Math.round((detailImageSize * detailRatioPair.width) / detailRatioPair.height));
  const detailShowCode = props.productDetailShowCode !== false;
  const detailShowName = props.productDetailShowName !== false;
  const detailShowDescription = props.productDetailShowDescription !== false;
  const detailShowPrice = props.productDetailShowPrice !== false;
  const detailFullImage = props.productDetailFullImage === true;
  const detailPriceAlignClass =
    priceAlign === "center" ? "justify-center text-center" : priceAlign === "right" ? "justify-end text-right" : "justify-start text-left";
  const productCardBgColor = (props.productCardBgColor ?? "#ffffff").trim() || "#ffffff";
  const productCardBgOpacity =
    typeof props.productCardBgOpacity === "number" && Number.isFinite(props.productCardBgOpacity)
      ? Math.max(0, Math.min(1, props.productCardBgOpacity))
      : 0.9;
  const productCardBorderStyle = props.productCardBorderStyle ?? "solid";
  const productCardBorderColor = (props.productCardBorderColor ?? "#e2e8f0").trim() || "#e2e8f0";
  const productCodeTextStyle = buildTypographyStyle(props.productCodeTypography);
  const productNameTextStyle = buildTypographyStyle(props.productNameTypography);
  const productDescriptionTextStyle = buildTypographyStyle(props.productDescriptionTypography);
  const productPriceTextStyle = buildTypographyStyle(props.productPriceTypography);
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
    typeof props.blockOffsetX === "number" && Number.isFinite(props.blockOffsetX) ? Math.round(props.blockOffsetX) : 0;
  const offsetY =
    typeof props.blockOffsetY === "number" && Number.isFinite(props.blockOffsetY) ? Math.round(props.blockOffsetY) : 0;
  const blockLayer =
    typeof props.blockLayer === "number" && Number.isFinite(props.blockLayer) ? Math.max(1, Math.round(props.blockLayer)) : 1;
  const offsetStyle = {
    position: "relative" as const,
    transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
    zIndex: blockLayer,
  };
  const borderClass = getBlockBorderClass(props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(props.blockBorderStyle, props.blockBorderColor);

  const hasHeading = !!String(props.heading ?? "").replace(/<[^>]*>/g, "").trim();
  const hasText = !!String(props.text ?? "").replace(/<[^>]*>/g, "").trim();
  const [pageIndex, setPageIndex] = useState(0);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<ProductCartItemState[]>([]);
  const [cartCustomer, setCartCustomer] = useState<MerchantOrderCustomerInput>({});
  const [cartCustomerOpen, setCartCustomerOpen] = useState(false);
  const [cartSubmitting, setCartSubmitting] = useState(false);
  const [cartError, setCartError] = useState("");
  const [cartNotice, setCartNotice] = useState("");
  const [cartCustomerShakeKey, setCartCustomerShakeKey] = useState(0);
  const rootRef = useRef<HTMLElement | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const cartCustomerNameRef = useRef<HTMLInputElement | null>(null);
  const cartStorageKey =
    props.runtimeSiteId && props.runtimeBlockId ? getProductCartStorageKey(props.runtimeSiteId, props.runtimeBlockId) : "";
  const cartEnabled = Boolean(props.runtimeOrderManagementEnabled && props.runtimeSiteId && props.runtimeBlockId);
  const selectedTag = activeTag && productTags.includes(activeTag) ? activeTag : null;
  const searchMatchedProducts = productSearchEnabled ? filterProductItemsByKeyword(arrangedProducts, searchKeyword) : arrangedProducts;
  const filteredProducts =
    tagHideUnselected && selectedTag ? searchMatchedProducts.filter((item) => item.tag === selectedTag) : searchMatchedProducts;
  const totalPages = containerMode === "paged" ? Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage)) : 1;
  const normalizedPageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1));
  const pageStart = normalizedPageIndex * itemsPerPage;
  const pagedProducts = containerMode === "paged" ? filteredProducts.slice(pageStart, pageStart + itemsPerPage) : filteredProducts;
  const scrollViewportHeight =
    containerMode === "scroll" ? productContainerViewportHeight(layoutPreset, imageSize, itemsPerPage) : null;
  const activeProduct = arrangedProducts.find((item) => item.id === activeProductId) ?? products.find((item) => item.id === activeProductId) ?? null;
  const placeholderCount =
    containerMode === "paged" && layoutPreset !== "spotlight" ? Math.max(0, itemsPerPage - pagedProducts.length) : 0;
  const cartQuantities = cartItems.reduce<Record<string, number>>((map, item) => {
    map[item.productId] = item.quantity;
    return map;
  }, {});
  const checkedCartItems = cartItems.filter((item) => item.checked);
  const checkedCartTotalQuantity = checkedCartItems.reduce((sum, item) => sum + item.quantity, 0);
  const checkedCartTotalAmount = checkedCartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const hasCartCustomerIdentity = Boolean(
    String(cartCustomer.name ?? "").trim() ||
      String(cartCustomer.phone ?? "").trim() ||
      String(cartCustomer.email ?? "").trim(),
  );

  useEffect(() => {
    if (!cartEnabled || !cartStorageKey) {
      setCartItems([]);
      setCartCustomer({});
      return;
    }
    const stored = loadProductCartStorageState(cartStorageKey, pricePrefix);
    setCartItems(stored.items ?? []);
    setCartCustomer(stored.customer ?? {});
  }, [cartEnabled, cartStorageKey, pricePrefix]);

  useEffect(() => {
    if (!cartEnabled || !cartStorageKey) return;
    saveProductCartStorageState(cartStorageKey, {
      customer: normalizeCartCustomer(cartCustomer),
      items: normalizeCartItems(cartItems, pricePrefix),
    });
  }, [cartEnabled, cartCustomer, cartItems, cartStorageKey, pricePrefix]);

  useEffect(() => {
    if (!activeProductId) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveProductId(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeProductId]);

  useEffect(() => {
    if (!cartCustomerOpen) return;
    const timer = window.setTimeout(() => {
      cartCustomerNameRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [cartCustomerOpen]);

  const scrollToProductCard = (targetId: string | null) => {
    if (!targetId) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = scrollViewportRef.current;
        const target =
          rootRef.current?.querySelector<HTMLElement>(`#${getProductCardDomId(targetId)}`) ??
          document.getElementById(getProductCardDomId(targetId));
        if (!target) return;
        if (viewport && viewport.contains(target)) {
          const offset = target.offsetTop - viewport.offsetTop;
          viewport.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
          return;
        }
        target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
      });
    });
  };

  const scrollToProductGroup = (targetTag: string | null) => {
    if (!targetTag) return;
    const targetKey = getProductGroupTagKey(targetTag);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const viewport = scrollViewportRef.current;
        const target =
          rootRef.current?.querySelector<HTMLElement>(`[data-product-group-key="${targetKey}"]`) ??
          document.querySelector<HTMLElement>(`[data-product-group-key="${targetKey}"]`);
        if (!target) return;
        if (viewport && viewport.contains(target)) {
          const offset = target.offsetTop - viewport.offsetTop;
          viewport.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
          return;
        }
        target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
      });
    });
  };

  const handleSelectTag = (tag: string | null) => {
    setActiveTag(tag);
    if (tag == null) {
      setPageIndex(0);
      requestAnimationFrame(() => {
        scrollViewportRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
      return;
    }
    const sourceItems = searchMatchedProducts;
    const firstMatchIndex = sourceItems.findIndex((item) => item.tag === tag);
    if (firstMatchIndex < 0) {
      setPageIndex(0);
      return;
    }
    const targetId = sourceItems[firstMatchIndex]?.id ?? null;
    const shouldScrollToGroup = groupedByTag;
    if (containerMode === "paged") {
      setPageIndex(Math.floor(firstMatchIndex / itemsPerPage));
      if (shouldScrollToGroup) {
        scrollToProductGroup(tag);
        return;
      }
      scrollToProductCard(targetId);
      return;
    }
    if (shouldScrollToGroup) {
      scrollToProductGroup(tag);
      return;
    }
    if (targetId) {
      scrollToProductCard(targetId);
    }
  };

  const updateCartItems = (updater: (items: ProductCartItemState[]) => ProductCartItemState[]) => {
    setCartItems((current) => normalizeCartItems(updater(current), pricePrefix));
  };

  const handleIncreaseQuantity = (item: ReturnType<typeof normalizeProductItems>[number]) => {
    if (!cartEnabled) return;
    setCartError("");
    setCartNotice("");
    updateCartItems((current) => {
      const nextIndex = current.findIndex((entry) => entry.productId === item.id);
      if (nextIndex < 0) {
        const unitPrice = parseMerchantOrderPriceValue(item.price);
        return [
          ...current,
          {
            productId: item.id,
            quantity: 1,
            checked: true,
            product: item,
            unitPrice,
            unitPriceText: formatMerchantOrderAmount(unitPrice, pricePrefix),
          },
        ];
      }
      const next = [...current];
      next[nextIndex] = {
        ...next[nextIndex],
        quantity: next[nextIndex].quantity + 1,
        checked: true,
        product: item,
      };
      return next;
    });
  };

  const handleDecreaseQuantity = (item: ReturnType<typeof normalizeProductItems>[number]) => {
    if (!cartEnabled) return;
    setCartError("");
    setCartNotice("");
    updateCartItems((current) =>
      current.flatMap((entry) => {
        if (entry.productId !== item.id) return [entry];
        const nextQuantity = entry.quantity - 1;
        if (nextQuantity <= 0) return [];
        return [{ ...entry, quantity: nextQuantity, product: item }];
      }),
    );
  };

  const handleToggleCartItemChecked = (productId: string, checked: boolean) => {
    updateCartItems((current) =>
      current.map((entry) => (entry.productId === productId ? { ...entry, checked } : entry)),
    );
  };

  const handleSetCartItemQuantity = (productId: string, quantityInput: string) => {
    const nextQuantity = Math.max(0, Number.parseInt(quantityInput.replace(/[^\d]/g, ""), 10) || 0);
    updateCartItems((current) =>
      current.flatMap((entry) => {
        if (entry.productId !== productId) return [entry];
        if (nextQuantity <= 0) return [];
        return [{ ...entry, quantity: nextQuantity }];
      }),
    );
  };

  const handleRemoveCartItem = (productId: string) => {
    updateCartItems((current) => current.filter((entry) => entry.productId !== productId));
  };

  const handleCartCustomerChange = (field: keyof MerchantOrderCustomerInput, value: string) => {
    setCartCustomer((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSubmitOrder = async () => {
    if (!cartEnabled || !props.runtimeSiteId || !props.runtimeBlockId) return;
    if (checkedCartItems.length === 0) {
      setCartError("请先勾选要提交的产品。");
      return;
    }
    if (!String(cartCustomer.name ?? "").trim() && !String(cartCustomer.phone ?? "").trim() && !String(cartCustomer.email ?? "").trim()) {
      setCartError("请至少填写姓名、电话或邮箱中的一项。");
      setCartCustomerShakeKey((current) => current + 1);
      return;
    }
    setCartSubmitting(true);
    setCartError("");
    setCartNotice("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          siteId: props.runtimeSiteId,
          siteName: props.runtimeSiteName,
          blockId: props.runtimeBlockId,
          pricePrefix,
          customer: cartCustomer,
          items: checkedCartItems.map((item) => ({
            productId: item.productId,
            code: item.product.code,
            name: item.product.name,
            description: item.product.description,
            imageUrl: item.product.imageUrl,
            tag: item.product.tag,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitPriceText: item.unitPriceText,
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { order?: { id?: string }; message?: string; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "order_create_failed");
      }
      const nextOrderId = String(payload?.order?.id ?? "").trim();
      setCartItems((current) => current.filter((item) => !item.checked));
      setCartCustomer({});
      setCartCustomerOpen(false);
      setCartOpen(false);
      setCartNotice(nextOrderId ? `订单 ${nextOrderId} 已提交。` : "订单已提交。");
    } catch (error) {
      setCartError(error instanceof Error && error.message ? error.message : "提交订单失败，请稍后重试。");
    } finally {
      setCartSubmitting(false);
    }
  };

  useEffect(() => {
    if (!cartEnabled) return;
    setCartItems((current) => {
      const productMap = new Map(products.map((item) => [item.id, item] as const));
      const next = current.map((entry) => {
        const product = productMap.get(entry.productId);
        if (!product) return entry;
        const unitPrice = parseMerchantOrderPriceValue(product.price);
        return {
          ...entry,
          product,
          unitPrice,
          unitPriceText: formatMerchantOrderAmount(unitPrice, pricePrefix),
        };
      });
      return normalizeCartItems(next, pricePrefix);
    });
  }, [cartEnabled, pricePrefix, products]);

  const renderCard = (
    item: ReturnType<typeof normalizeProductItems>[number],
    extra: { list?: boolean; spotlight?: boolean; imageAspectRatio?: ProductImageAspectRatio } = {},
  ) =>
    renderProductCard(item, {
      imageAspectRatio: extra.imageAspectRatio ?? imageAspectRatio,
      imageSize,
      pricePrefix,
      showCode,
      showDescription,
      priceAlign,
      cardBgColor: productCardBgColor,
      cardBgOpacity: productCardBgOpacity,
      cardBorderStyle: productCardBorderStyle,
      cardBorderColor: productCardBorderColor,
      codeTextStyle: productCodeTextStyle,
      nameTextStyle: productNameTextStyle,
      descriptionTextStyle: productDescriptionTextStyle,
      priceTextStyle: productPriceTextStyle,
      onOpen: setActiveProductId,
      cartEnabled,
      quantity: cartQuantities[item.id] ?? 0,
      onIncreaseQuantity: handleIncreaseQuantity,
      onDecreaseQuantity: handleDecreaseQuantity,
      ...extra,
    });

  const handleSearchKeywordChange = (value: string) => {
    setSearchKeyword(value);
    setPageIndex(0);
    requestAnimationFrame(() => {
      scrollViewportRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  };

  const renderSearchBar = () =>
    productSearchEnabled && products.length > 0 ? (
      <div className="mt-5">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={searchKeyword}
            onChange={(event) => handleSearchKeywordChange(event.target.value)}
            placeholder={productSearchPlaceholder}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200 md:text-sm"
          />
          {searchKeyword.trim() ? (
            <button
              type="button"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={() => handleSearchKeywordChange("")}
            >
              清空
            </button>
          ) : null}
        </div>
      </div>
    ) : null;

  const renderTagFilters = () =>
    productTags.length > 0 ? (
      <div
        className={
          tagPosition === "top"
            ? "mt-5 flex flex-wrap gap-2"
            : tagPosition === "left"
              ? "mt-5 mr-4 flex float-left w-max flex-col items-start gap-2"
              : "mt-5 ml-4 flex float-right w-max flex-col items-end gap-2"
        }
      >
        {tagHideUnselected ? (
          <button
            type="button"
            className={`truncate rounded-full border border-white/30 px-3 py-1.5 transition-opacity ${
              selectedTag === null ? "ring-2 ring-slate-900/30 shadow-sm" : ""
            }`}
            style={{
              width: `${tagWidth}px`,
              ...(selectedTag === null
                ? getColorLayerStyle(tagActiveBgColor, tagActiveBgOpacity)
                : getColorLayerStyle(tagBgColor, tagBgOpacity)),
              color: getReadableTagTextColor(selectedTag === null ? tagActiveBgColor : tagBgColor),
              fontSize: `${tagFontSize}px`,
            }}
            onClick={() => handleSelectTag(null)}
          >
            全部
          </button>
        ) : null}
        {productTags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={`truncate rounded-full border border-white/30 px-3 py-1.5 transition-opacity ${selectedTag === tag ? "ring-2 ring-slate-900/30 shadow-sm" : ""}`}
            style={{
              width: `${tagWidth}px`,
              ...(selectedTag === tag
                ? getColorLayerStyle(tagActiveBgColor, tagActiveBgOpacity)
                : getColorLayerStyle(tagBgColor, tagBgOpacity)),
              color: getReadableTagTextColor(selectedTag === tag ? tagActiveBgColor : tagBgColor),
              fontSize: `${tagFontSize}px`,
            }}
            onClick={() => handleSelectTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
    ) : null;

  const renderProductGroupHeading = (label: string, key: string) => (
    <div key={key} data-product-group-key={getProductGroupTagKey(label)} className="flex items-center gap-3">
      <div className="h-px flex-1 bg-slate-200" />
      <div className="shrink-0 text-sm font-semibold tracking-[0.08em] text-slate-700">{label || "未分类"}</div>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );

  const renderProductCollection = (
    items: ReturnType<typeof normalizeProductItems>,
    options: { placeholderPrefix: string; includePlaceholders: boolean },
  ) => {
    if (layoutPreset === "spotlight" && items[0]) {
      const featured = items[0];
      const secondary = items.slice(1);
      return (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          {renderCard(featured, {
            spotlight: true,
            imageAspectRatio: imageAspectRatio === "portrait" ? "landscape" : imageAspectRatio,
          })}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">{secondary.map((item) => renderCard(item))}</div>
        </div>
      );
    }

    if (layoutPreset === "list") {
      return (
        <div className="space-y-4">
          {items.map((item) => renderCard(item, { list: true }))}
          {options.includePlaceholders
            ? Array.from({ length: placeholderCount }, (_, index) =>
                renderPlaceholderCard(`${options.placeholderPrefix}-list-${index}`, { list: true }),
              )
            : null}
        </div>
      );
    }

    return (
      <div className={productGridClass(layoutPreset)}>
        {items.map((item) => renderCard(item))}
        {options.includePlaceholders
          ? Array.from({ length: placeholderCount }, (_, index) =>
              renderPlaceholderCard(`${options.placeholderPrefix}-grid-${index}`),
            )
          : null}
      </div>
    );
  };

  const renderProductContent = () => {
    if (filteredProducts.length === 0) {
      return (
        <>
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            {searchKeyword.trim()
              ? `未找到与“${searchKeyword.trim()}”匹配的产品。`
              : "暂无产品，请在后台添加产品信息。"}
          </div>
          {renderPager()}
        </>
      );
    }

    if (groupedByTag) {
      const groups = groupArrangedProductItemsByTag(pagedProducts);
      return (
        <>
          <div className="mt-5 space-y-6">
            {groups.map((group, index) => (
              <div key={`${group.tag || "untagged"}-${index}`} className="space-y-4">
                {renderProductGroupHeading(group.tag, `product-group-${group.tag || "untagged"}-${index}`)}
                {renderProductCollection(group.items, {
                  placeholderPrefix: `product-group-${group.tag || "untagged"}-${index}`,
                  includePlaceholders: false,
                })}
              </div>
            ))}
          </div>
          {renderPager()}
        </>
      );
    }

    return (
      <>
        <div className="mt-5">
          {renderProductCollection(pagedProducts, {
            placeholderPrefix: "product",
            includePlaceholders: true,
          })}
        </div>
        {renderPager()}
      </>
    );
  };

  const renderProductsWithFilters = () => {
    const content = containerMode === "scroll" && scrollViewportHeight ? (
      <div ref={scrollViewportRef} className="min-w-0 overflow-y-auto pr-1" style={{ maxHeight: `${scrollViewportHeight}px` }}>
        {renderProductContent()}
      </div>
    ) : (
      renderProductContent()
    );
    if (tagPosition === "left") {
      return (
        <>
          {renderSearchBar()}
          <div className="mt-5 grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
            {renderTagFilters()}
            <div className="min-w-0">{content}</div>
          </div>
        </>
      );
    }
    if (tagPosition === "right") {
      return (
        <>
          {renderSearchBar()}
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">{content}</div>
            {renderTagFilters()}
          </div>
        </>
      );
    }
    return (
      <>
        {renderSearchBar()}
        {renderTagFilters()}
        {content}
      </>
    );
  };

  const renderPlaceholderCard = (key: string, extra: { list?: boolean } = {}) => {
    const ratio = getProductAspectRatioPair(imageAspectRatio);
    const listImageWidth = Math.max(1, Math.round((imageSize * ratio.width) / ratio.height));
    const listCardStyle = extra.list
      ? ({
          "--product-list-card-height": `${imageSize + 32}px`,
        } as CSSProperties)
      : undefined;
    const frameStyle = extra.list
      ? { width: `${listImageWidth}px`, maxWidth: "100%", height: `${imageSize}px` }
      : { width: "100%", height: `${imageSize}px` };
    return (
      <div
        key={key}
        aria-hidden="true"
        className={
          extra.list
            ? "invisible flex w-full flex-col gap-4 p-4 sm:h-[var(--product-list-card-height)] sm:max-h-[var(--product-list-card-height)] sm:flex-row"
            : "invisible flex h-full w-full flex-col"
        }
        style={listCardStyle}
      >
        <div className={`relative overflow-hidden bg-slate-100 ${extra.list ? "shrink-0 self-start rounded-xl" : ""}`} style={frameStyle} />
        <div className={extra.list ? "flex min-w-0 flex-1 flex-col overflow-hidden" : "flex min-h-[180px] flex-1 flex-col overflow-hidden p-4"} />
      </div>
    );
  };

  const renderPager = () =>
    containerMode === "paged" && totalPages > 1 ? (
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          disabled={normalizedPageIndex === 0}
        >
          上一页
        </button>
        <div className="text-sm text-slate-600">{`${normalizedPageIndex + 1} / ${totalPages}`}</div>
        <button
          type="button"
          className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setPageIndex((current) => Math.min(totalPages - 1, current + 1))}
          disabled={normalizedPageIndex >= totalPages - 1}
        >
          下一页
        </button>
      </div>
    ) : null;

  return (
    <section ref={rootRef} className={resolveMobileFitSectionClass("mx-auto max-w-6xl px-6 py-6", mobileFitScreenWidth)} style={offsetStyle}>
      <div
        className={resolveMobileFitCardClass(`relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ${borderClass}`, mobileFitScreenWidth)}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        {hasHeading ? (
          <h2
            className="break-words whitespace-pre-wrap text-2xl font-bold"
            dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, resolveLocalizedSystemDefaultText(props.heading, "产品展示", locale)) }}
          />
        ) : null}
        {hasText ? (
          <div className="mt-2 break-words whitespace-pre-wrap text-sm leading-6 text-slate-600" dangerouslySetInnerHTML={{ __html: toRichHtml(props.text, "") }} />
        ) : null}
        {renderProductsWithFilters()}
        {cartEnabled ? (
          <button
            type="button"
            className="absolute bottom-5 left-5 z-20 inline-flex items-center gap-2 rounded-full bg-slate-950/95 px-3.5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition hover:bg-slate-800"
            onClick={() => {
              setCartError("");
              setCartNotice("");
              setCartOpen(true);
            }}
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-4.5 w-4.5 stroke-current text-white"
                fill="none"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="9" cy="20" r="1.5" />
                <circle cx="18" cy="20" r="1.5" />
                <path d="M3 4h2l2.2 9.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.76L20 7H7.2" />
              </svg>
            </span>
            <span>Cart</span>
            <span className="inline-flex min-w-[1.45rem] items-center justify-center rounded-full bg-emerald-400 px-1.5 py-0.5 text-[11px] font-bold text-slate-950">
              {checkedCartTotalQuantity}
            </span>
          </button>
        ) : null}
      </div>
      {cartOpen ? (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/55 p-4"
          onClick={() => {
            setCartCustomerOpen(false);
            setCartOpen(false);
          }}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <div className="text-2xl font-semibold text-slate-900">购物车</div>
                <div className="mt-1 text-sm text-slate-500">
                  已选 {checkedCartTotalQuantity} 件，合计 {formatMerchantOrderAmount(checkedCartTotalAmount, pricePrefix)}
                </div>
                {cartNotice ? <div className="mt-2 text-sm text-emerald-600">{cartNotice}</div> : null}
                {cartError ? <div className="mt-2 text-sm text-rose-600">{cartError}</div> : null}
              </div>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-500 transition hover:bg-slate-50"
                onClick={() => {
                  setCartCustomerOpen(false);
                  setCartOpen(false);
                }}
                aria-label="关闭购物车"
              >
                ×
              </button>
            </div>
            <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
              <div className="min-h-0 overflow-y-auto px-6 py-5">
                {cartItems.length > 0 ? (
                  <div className="space-y-4">
                    {cartItems.map((item) => {
                      const subtotal = item.unitPrice * item.quantity;
                      return (
                        <div key={item.productId} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="flex items-start gap-4">
                            <input
                              type="checkbox"
                              checked={item.checked}
                              onChange={(event) => handleToggleCartItemChecked(item.productId, event.target.checked)}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                            />
                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                              {item.product.imageUrl ? (
                                <Image
                                  src={item.product.imageUrl}
                                  alt={item.product.name || item.product.code || "产品图片"}
                                  fill
                                  unoptimized
                                  sizes="96px"
                                  className="object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-slate-400">暂无图片</div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-base font-semibold text-slate-900">{item.product.name || "未命名产品"}</div>
                                  {item.product.code ? <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{item.product.code}</div> : null}
                                </div>
                                <button
                                  type="button"
                                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 transition hover:bg-white"
                                  onClick={() => handleRemoveCartItem(item.productId)}
                                >
                                  删除
                                </button>
                              </div>
                              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1">
                                  <button
                                    type="button"
                                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold text-slate-700 transition hover:bg-slate-100"
                                    onClick={() => handleDecreaseQuantity(item.product)}
                                  >
                                    -
                                  </button>
                                  <input
                                    type="text"
                                    value={String(item.quantity)}
                                    onChange={(event) => handleSetCartItemQuantity(item.productId, event.target.value)}
                                    className="w-12 border-0 bg-transparent p-0 text-center text-sm font-semibold text-slate-800 outline-none"
                                    inputMode="numeric"
                                  />
                                  <button
                                    type="button"
                                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold text-slate-700 transition hover:bg-slate-100"
                                    onClick={() => handleIncreaseQuantity(item.product)}
                                  >
                                    +
                                  </button>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs text-slate-400">小计</div>
                                  <div className="text-base font-semibold text-sky-700">
                                    {formatMerchantOrderAmount(subtotal, pricePrefix)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                    购物车还是空的，先从产品列表里加购吧。
                  </div>
                )}
              </div>
              <div className="border-t border-slate-200 bg-slate-50/70 px-6 py-5 lg:border-l lg:border-t-0">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-lg font-semibold text-slate-900">客户信息</div>
                  {hasCartCustomerIdentity ? (
                    <div className="mt-4 space-y-2 text-sm text-slate-600">
                      {cartCustomer.name ? <div>姓名：{cartCustomer.name}</div> : null}
                      {cartCustomer.phone ? <div>电话：{cartCustomer.phone}</div> : null}
                      {cartCustomer.email ? <div>邮箱：{cartCustomer.email}</div> : null}
                      {cartCustomer.note ? (
                        <div className="line-clamp-2 break-words text-slate-500">备注：{cartCustomer.note}</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-4 text-sm text-slate-400">暂未填写客户信息</div>
                  )}
                </div>
                <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>已勾选商品</span>
                    <span>{checkedCartTotalQuantity} 件</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-lg font-semibold text-slate-900">
                    <span>合计</span>
                    <span>{formatMerchantOrderAmount(checkedCartTotalAmount, pricePrefix)}</span>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    key={cartCustomerShakeKey}
                    type="button"
                    className={`rounded-full border px-5 py-3 text-sm font-medium transition ${
                      hasCartCustomerIdentity
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    } ${!hasCartCustomerIdentity && cartCustomerShakeKey > 0 ? "animate-[cartCustomerButtonShake_0.42s_ease-in-out_2]" : ""}`}
                    onClick={() => {
                      setCartError("");
                      setCartCustomerOpen(true);
                    }}
                  >
                    {hasCartCustomerIdentity ? "客户信息 已填写" : "客户信息"}
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void handleSubmitOrder()}
                    disabled={cartSubmitting || checkedCartItems.length === 0}
                  >
                    {cartSubmitting ? "提交中..." : "提交订单"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {cartOpen && cartCustomerOpen ? (
        <div className="fixed inset-0 z-[1110] flex items-center justify-center bg-black/50 p-4" onClick={() => setCartCustomerOpen(false)}>
          <div
            className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-2xl font-semibold text-slate-900">客户信息</div>
                <div className="mt-1 text-sm text-slate-500">提交订单时会把这里的客户信息一起发给商家后台。</div>
              </div>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-500 transition hover:bg-slate-50"
                onClick={() => setCartCustomerOpen(false)}
                aria-label="关闭客户信息"
              >
                ×
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block">
                <div className="mb-2 text-sm text-slate-600">姓名</div>
                <input
                  ref={cartCustomerNameRef}
                  type="text"
                  value={cartCustomer.name ?? ""}
                  onChange={(event) => handleCartCustomerChange("name", event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200"
                />
              </label>
              <label className="block">
                <div className="mb-2 text-sm text-slate-600">电话</div>
                <input
                  type="tel"
                  value={cartCustomer.phone ?? ""}
                  onChange={(event) => handleCartCustomerChange("phone", event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200"
                />
              </label>
              <label className="block">
                <div className="mb-2 text-sm text-slate-600">邮箱</div>
                <input
                  type="email"
                  value={cartCustomer.email ?? ""}
                  onChange={(event) => handleCartCustomerChange("email", event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200"
                />
              </label>
              <label className="block">
                <div className="mb-2 text-sm text-slate-600">备注</div>
                <textarea
                  rows={4}
                  value={cartCustomer.note ?? ""}
                  onChange={(event) => handleCartCustomerChange("note", event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                onClick={() => setCartCustomerOpen(false)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {activeProduct ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4" onClick={() => setActiveProductId(null)}>
          <div
            className={`relative w-full overflow-auto rounded-3xl shadow-2xl ${detailFullImage ? "max-w-6xl bg-white p-3 sm:p-4" : "max-h-[90vh] max-w-4xl bg-white p-5 sm:p-6"}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={`absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full text-2xl leading-none ${detailFullImage ? "border border-slate-200 bg-white/90 text-slate-700 hover:bg-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              onClick={() => setActiveProductId(null)}
              aria-label="关闭"
            >
              ×
            </button>
            {detailFullImage ? (
              <div className="relative overflow-hidden rounded-[1.25rem] bg-slate-100" style={{ height: "min(88vh, 960px)", minHeight: "min(88vh, 960px)" }}>
                {activeProduct.imageUrl ? (
                  <Image src={activeProduct.imageUrl} alt={activeProduct.name || activeProduct.code || "产品图片"} fill unoptimized sizes="100vw" className="object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无图片</div>
                )}
                {detailShowCode || detailShowName || detailShowDescription || detailShowPrice ? (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-5 text-white sm:p-7">
                    <div className="mx-auto max-w-3xl">
                      {detailShowCode && activeProduct.code ? (
                        <div className="text-xs uppercase tracking-[0.24em] text-white/75" style={productCodeTextStyle}>
                          {activeProduct.code}
                        </div>
                      ) : null}
                      {detailShowName ? (
                        <h3 className="mt-2 break-words text-2xl font-semibold text-white sm:text-3xl" style={productNameTextStyle}>
                          {activeProduct.name || "未命名产品"}
                        </h3>
                      ) : null}
                      {detailShowDescription && activeProduct.description ? (
                        <div
                          className="mt-3 break-words whitespace-pre-wrap text-sm leading-7 text-white/90 sm:text-base"
                          style={productDescriptionTextStyle}
                        >
                          {activeProduct.description}
                        </div>
                      ) : null}
                      {detailShowPrice && productPriceText(activeProduct.price, pricePrefix) ? (
                        <div className={`mt-4 flex w-full text-2xl font-semibold text-white ${detailPriceAlignClass}`}>
                          <div className="w-full" style={productPriceTextStyle}>
                            {productPriceText(activeProduct.price, pricePrefix)}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                <div
                  className="relative overflow-hidden rounded-2xl bg-slate-100"
                  style={{
                    width: "100%",
                    maxWidth: `${detailImageWidth}px`,
                    aspectRatio: `${detailRatioPair.width} / ${detailRatioPair.height}`,
                  }}
                >
                  {activeProduct.imageUrl ? (
                    <Image src={activeProduct.imageUrl} alt={activeProduct.name || activeProduct.code || "产品图片"} fill unoptimized sizes="100vw" className="object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无图片</div>
                  )}
                </div>
                <div className="flex min-h-full flex-col">
                  {detailShowCode && activeProduct.code ? (
                    <div className="text-xs uppercase tracking-[0.24em] text-slate-500" style={productCodeTextStyle}>
                      {activeProduct.code}
                    </div>
                  ) : null}
                  {detailShowName ? (
                    <h3 className="mt-2 break-words text-2xl font-semibold text-slate-900" style={productNameTextStyle}>
                      {activeProduct.name || "未命名产品"}
                    </h3>
                  ) : null}
                  {detailShowDescription && activeProduct.description ? (
                    <div className="mt-4 break-words whitespace-pre-wrap text-sm leading-7 text-slate-600" style={productDescriptionTextStyle}>
                      {activeProduct.description}
                    </div>
                  ) : null}
                  {detailShowPrice && productPriceText(activeProduct.price, pricePrefix) ? (
                    <div className={`mt-auto flex w-full pt-6 text-2xl font-semibold text-sky-700 ${detailPriceAlignClass}`}>
                      <div className="w-full" style={productPriceTextStyle}>
                        {productPriceText(activeProduct.price, pricePrefix)}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
      <style jsx global>{`
        @keyframes cartCustomerButtonShake {
          0%,
          100% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-6px);
          }
          40% {
            transform: translateX(6px);
          }
          60% {
            transform: translateX(-4px);
          }
          80% {
            transform: translateX(4px);
          }
        }
      `}</style>
    </section>
  );
}
