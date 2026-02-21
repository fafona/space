"use client";

import type { BackgroundEditableProps, BlockBorderStyle } from "@/data/homeBlocks";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type NavItem = {
  id?: string;
  label?: string;
  pageId?: string;
};

type NavBlockProps = BackgroundEditableProps & {
  heading?: string;
  navOrientation?: "horizontal" | "vertical";
  navItemBgColor?: string;
  navItemBgOpacity?: number;
  navItemBorderStyle?: BlockBorderStyle;
  navItemBorderColor?: string;
  navItemActiveBgColor?: string;
  navItemActiveBgOpacity?: number;
  navItemActiveBorderStyle?: BlockBorderStyle;
  navItemActiveBorderColor?: string;
  navItems?: NavItem[];
  currentPageId?: string;
  onNavigatePage?: (pageId: string) => void;
};

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

function pickSolidBorderColor(value: string, fallback: string) {
  const trimmed = value.trim();
  const hex = trimmed.match(/#([0-9a-fA-F]{6})/);
  if (hex) return `#${hex[1]}`;
  return /^#([0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : fallback;
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

function getColorLayerStyle(value: string, opacity: number) {
  if (isGradientToken(value)) {
    return {
      backgroundImage: opacity < 1 ? gradientWithOpacity(value, opacity) : value,
    };
  }
  return {
    backgroundColor: toRgba(value, opacity),
  };
}

export default function NavBlock(props: NavBlockProps) {
  const orientation = props.navOrientation === "vertical" ? "vertical" : "horizontal";
  const navItems =
    Array.isArray(props.navItems) && props.navItems.length > 0
      ? props.navItems
          .map((item, idx) => ({
            id: item.id?.trim() || `nav-${idx}`,
            label: (item.label ?? "") || `页面 ${idx + 1}`,
            pageId: (item.pageId ?? "").trim() || `plan-${idx + 1}`,
          }))
          .filter((item) => !!item.pageId)
      : [
          { id: "nav-page-1", label: "页面 1", pageId: "page-1" },
          { id: "nav-page-2", label: "页面 2", pageId: "page-2" },
          { id: "nav-page-3", label: "页面 3", pageId: "page-3" },
        ];

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
  const offsetX =
    typeof props.blockOffsetX === "number" && Number.isFinite(props.blockOffsetX)
      ? Math.round(props.blockOffsetX)
      : 0;
  const offsetY =
    typeof props.blockOffsetY === "number" && Number.isFinite(props.blockOffsetY)
      ? Math.round(props.blockOffsetY)
      : 0;
  const blockLayer =
    typeof props.blockLayer === "number" && Number.isFinite(props.blockLayer)
      ? Math.max(1, Math.round(props.blockLayer))
      : 1;
  const borderClass = getBlockBorderClass(props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(props.blockBorderStyle, props.blockBorderColor);
  const navItemBgColor = (props.navItemBgColor ?? "#ffffff").trim() || "#ffffff";
  const navItemBgOpacity =
    typeof props.navItemBgOpacity === "number" && Number.isFinite(props.navItemBgOpacity)
      ? Math.max(0, Math.min(1, props.navItemBgOpacity))
      : 1;
  const navItemBorderStyle = (props.navItemBorderStyle ?? "solid") as BlockBorderStyle;
  const navItemBorderColor = pickSolidBorderColor(props.navItemBorderColor ?? "#6b7280", "#6b7280");
  const navItemClass = `px-4 py-2 rounded overflow-hidden text-sm whitespace-pre-wrap`;
  const navItemStyle = {
    ...getBlockBorderInlineStyle(navItemBorderStyle, navItemBorderColor),
    ...getColorLayerStyle(navItemBgColor, navItemBgOpacity),
  };
  const navItemActiveBgColor = (props.navItemActiveBgColor ?? navItemBgColor).trim() || navItemBgColor;
  const navItemActiveBgOpacity =
    typeof props.navItemActiveBgOpacity === "number" && Number.isFinite(props.navItemActiveBgOpacity)
      ? Math.max(0, Math.min(1, props.navItemActiveBgOpacity))
      : navItemBgOpacity;
  const navItemActiveBorderStyle = (props.navItemActiveBorderStyle ?? navItemBorderStyle) as BlockBorderStyle;
  const navItemActiveBorderColor = pickSolidBorderColor(props.navItemActiveBorderColor ?? navItemBorderColor, navItemBorderColor);
  const navItemActiveStyle = {
    ...getBlockBorderInlineStyle(navItemActiveBorderStyle, navItemActiveBorderColor),
    ...getColorLayerStyle(navItemActiveBgColor, navItemActiveBgOpacity),
  };

  return (
    <section
      className="max-w-6xl mx-auto px-6 py-4"
      style={{
        position: "relative",
        transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
        zIndex: blockLayer,
      }}
    >
      <div
        className={`rounded-xl shadow-sm p-4 ${borderClass}`}
        style={{
          ...cardStyle,
          ...borderInlineStyle,
          width:
            orientation === "vertical"
              ? blockWidth
                ? `${blockWidth}px`
                : "max-content"
              : blockWidth
                ? `${blockWidth}px`
                : undefined,
          maxWidth: "100%",
          height: blockHeight ? `${blockHeight}px` : undefined,
          overflow: blockHeight ? "auto" : undefined,
        }}
      >
        {props.heading ? (
          <div
            className="text-sm font-semibold text-gray-700 mb-2 whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, "") }}
          />
        ) : null}
        <nav className={orientation === "vertical" ? "flex flex-col items-start gap-2" : "flex flex-wrap items-center gap-2"}>
          {navItems.map((item) => {
            const isActive = props.currentPageId === item.pageId;
            return (
              <button
                key={item.id}
                type="button"
                className={`${navItemClass} ${getBlockBorderClass(isActive ? navItemActiveBorderStyle : navItemBorderStyle)} ${isActive ? "" : "hover:brightness-[0.98]"}`}
                style={isActive ? navItemActiveStyle : navItemStyle}
                onClick={() => props.onNavigatePage?.(item.pageId)}
              >
                <span dangerouslySetInnerHTML={{ __html: toRichHtml(item.label, "") }} />
              </button>
            );
          })}
        </nav>
      </div>
    </section>
  );
}

