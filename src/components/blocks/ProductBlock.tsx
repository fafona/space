"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";
import type { BackgroundEditableProps, BlockBorderStyle, TypographyEditableProps } from "@/data/homeBlocks";
import {
  arrangeProductItemsByTag,
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
  type ProductItemInput,
  type ProductLayoutPreset,
  type ProductPriceAlign,
  type ProductTagPosition,
} from "@/lib/productBlock";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type ProductBlockProps = BackgroundEditableProps &
  TypographyEditableProps & {
    heading?: string;
    text?: string;
    products?: ProductItemInput[];
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
  };

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

function getProductTagPlacementStyle(position: ProductTagPosition): CSSProperties {
  const gap = "0.75rem";
  if (position === "left") return { top: "50%", left: gap, transform: "translateY(-50%)" };
  if (position === "right") return { top: "50%", right: gap, transform: "translateY(-50%)" };
  return { top: gap, left: "50%", transform: "translateX(-50%)" };
}

function getProductCardDomId(id: string) {
  return `product-card-${id}`;
}

function renderProductTag(
  tag: string,
  options: {
    position: ProductTagPosition;
    fontSize: number;
    bgColor: string;
    bgOpacity: number;
    onClick?: () => void;
  },
) {
  const safeTag = tag.trim();
  if (!safeTag) return null;
  const style: CSSProperties = {
    ...getColorLayerStyle(options.bgColor, options.bgOpacity),
    ...getProductTagPlacementStyle(options.position),
    fontSize: `${options.fontSize}px`,
    lineHeight: 1.2,
    color: getReadableTagTextColor(options.bgColor),
    padding: `${Math.max(4, Math.round(options.fontSize * 0.3))}px ${Math.max(8, Math.round(options.fontSize * 0.72))}px`,
    maxWidth: "calc(100% - 1.5rem)",
  };
  return (
    <button
      type="button"
      className={`absolute z-[3] max-w-full truncate rounded-full border border-white/30 font-medium shadow-sm ${
        options.onClick ? "pointer-events-auto cursor-pointer hover:opacity-90" : "pointer-events-none"
      }`}
      style={style}
      title={safeTag}
      onClick={(event) => {
        event.stopPropagation();
        options.onClick?.();
      }}
    >
      {safeTag}
    </button>
  );
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
    tagPosition: ProductTagPosition;
    tagFontSize: number;
    tagBgColor: string;
    tagBgOpacity: number;
    cardBgColor: string;
    cardBgOpacity: number;
    cardBorderStyle: BlockBorderStyle;
    cardBorderColor: string;
    codeTextStyle: CSSProperties;
    nameTextStyle: CSSProperties;
    descriptionTextStyle: CSSProperties;
    priceTextStyle: CSSProperties;
    onOpen: (id: string) => void;
    onSelectTag: (tag: string) => void;
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
      <div
        className={`relative overflow-hidden bg-slate-100 ${options.list ? "shrink-0 self-start rounded-xl" : ""}`}
        style={frameStyle}
      >
        {item.imageUrl ? (
          <Image src={item.imageUrl} alt={item.name || item.code || "产品图片"} fill unoptimized sizes="100vw" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无图片</div>
        )}
        {renderProductTag(item.tag, {
          position: options.tagPosition,
          fontSize: options.tagFontSize,
          bgColor: options.tagBgColor,
          bgOpacity: options.tagBgOpacity,
          onClick: item.tag ? () => options.onSelectTag(item.tag) : undefined,
        })}
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
  const products = normalizeProductItems(props.products).filter((item) => isMeaningfulProductItem(item));
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
  const [pendingScrollProductId, setPendingScrollProductId] = useState<string | null>(null);
  const selectedTag = activeTag && productTags.includes(activeTag) ? activeTag : null;
  const filteredProducts = tagHideUnselected && selectedTag ? arrangedProducts.filter((item) => item.tag === selectedTag) : arrangedProducts;
  const totalPages = containerMode === "paged" ? Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage)) : 1;
  const normalizedPageIndex = Math.min(pageIndex, Math.max(0, totalPages - 1));
  const pageStart = normalizedPageIndex * itemsPerPage;
  const pagedProducts = containerMode === "paged" ? filteredProducts.slice(pageStart, pageStart + itemsPerPage) : filteredProducts;
  const scrollViewportHeight =
    containerMode === "scroll" ? productContainerViewportHeight(layoutPreset, imageSize, itemsPerPage) : null;
  const first = pagedProducts[0];
  const rest = pagedProducts.slice(1);
  const activeProduct = arrangedProducts.find((item) => item.id === activeProductId) ?? products.find((item) => item.id === activeProductId) ?? null;
  const placeholderCount =
    containerMode === "paged" && layoutPreset !== "spotlight" ? Math.max(0, itemsPerPage - pagedProducts.length) : 0;

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
    const targetId = pendingScrollProductId;
    if (!targetId) return;
    const target = document.getElementById(getProductCardDomId(targetId));
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      setPendingScrollProductId(null);
    });
  }, [pagedProducts, pendingScrollProductId, selectedTag, tagHideUnselected]);

  const handleSelectTag = (tag: string | null) => {
    setActiveTag(tag);
    if (tag == null) {
      setPageIndex(0);
      setPendingScrollProductId(null);
      return;
    }
    const firstMatchIndex = arrangedProducts.findIndex((item) => item.tag === tag);
    if (firstMatchIndex < 0) {
      setPageIndex(0);
      setPendingScrollProductId(null);
      return;
    }
    const targetId = arrangedProducts[firstMatchIndex]?.id ?? null;
    setPendingScrollProductId(targetId);
    if (containerMode === "paged") {
      setPageIndex(Math.floor(firstMatchIndex / itemsPerPage));
      return;
    }
    if (targetId) {
      const target = document.getElementById(getProductCardDomId(targetId));
      if (target) {
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        });
        setPendingScrollProductId(null);
      }
    }
  };

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
      tagPosition,
      tagFontSize,
      tagBgColor,
      tagBgOpacity,
      cardBgColor: productCardBgColor,
      cardBgOpacity: productCardBgOpacity,
      cardBorderStyle: productCardBorderStyle,
      cardBorderColor: productCardBorderColor,
      codeTextStyle: productCodeTextStyle,
      nameTextStyle: productNameTextStyle,
      descriptionTextStyle: productDescriptionTextStyle,
      priceTextStyle: productPriceTextStyle,
      onOpen: setActiveProductId,
      onSelectTag: (tag) => handleSelectTag(tag),
      ...extra,
    });

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

  const renderProductContent = () => (
    <>
      {filteredProducts.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
          暂无产品，请在后台添加产品信息。
        </div>
      ) : layoutPreset === "spotlight" && first ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          {renderCard(first, {
            spotlight: true,
            imageAspectRatio: imageAspectRatio === "portrait" ? "landscape" : imageAspectRatio,
          })}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">{rest.map((item) => renderCard(item))}</div>
        </div>
      ) : layoutPreset === "list" ? (
        <div className="mt-5 space-y-4">
          {pagedProducts.map((item) => renderCard(item, { list: true }))}
          {Array.from({ length: placeholderCount }, (_, index) => renderPlaceholderCard(`list-placeholder-${index}`, { list: true }))}
        </div>
      ) : (
        <div className={`mt-5 ${productGridClass(layoutPreset)}`}>
          {pagedProducts.map((item) => renderCard(item))}
          {Array.from({ length: placeholderCount }, (_, index) => renderPlaceholderCard(`grid-placeholder-${index}`))}
        </div>
      )}
      {renderPager()}
    </>
  );

  const renderProductsWithFilters = () => {
    const content = containerMode === "scroll" && scrollViewportHeight ? (
      <div className="min-w-0 overflow-y-auto pr-1" style={{ maxHeight: `${scrollViewportHeight}px` }}>
        {renderProductContent()}
      </div>
    ) : (
      renderProductContent()
    );
    if (tagPosition === "left") {
      return (
        <div className="mt-5 grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
          {renderTagFilters()}
          <div className="min-w-0">{content}</div>
        </div>
      );
    }
    if (tagPosition === "right") {
      return (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">{content}</div>
          {renderTagFilters()}
        </div>
      );
    }
    return (
      <>
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
    <section className="mx-auto max-w-6xl px-6 py-6" style={offsetStyle}>
      <div
        className={`overflow-hidden rounded-2xl bg-white p-6 shadow-sm ${borderClass}`}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        {hasHeading ? (
          <h2 className="break-words whitespace-pre-wrap text-2xl font-bold" dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, "产品展示") }} />
        ) : null}
        {hasText ? (
          <div className="mt-2 break-words whitespace-pre-wrap text-sm leading-6 text-slate-600" dangerouslySetInnerHTML={{ __html: toRichHtml(props.text, "") }} />
        ) : null}
        {renderProductsWithFilters()}
      </div>
      {activeProduct ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4" onClick={() => setActiveProductId(null)}>
          <div
            className={`relative w-full overflow-auto rounded-3xl shadow-2xl ${detailFullImage ? "max-w-6xl bg-white p-3 sm:p-4" : "max-h-[90vh] max-w-4xl bg-white p-5 sm:p-6"}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={`absolute right-4 top-4 rounded-full px-3 py-1 text-sm ${detailFullImage ? "border border-slate-200 bg-white/90 text-slate-700 hover:bg-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              onClick={() => setActiveProductId(null)}
            >
              关闭
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
    </section>
  );
}
