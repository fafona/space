"use client";

import { useEffect, useMemo, useState } from "react";
import type { BackgroundEditableProps, BlockBorderStyle } from "@/data/homeBlocks";
import { useI18n } from "@/components/I18nProvider";
import { localizeSystemDefaultText, resolveLocalizedSystemDefaultText } from "@/lib/editorSystemDefaults";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { resolveMobileFitCardClass, resolveMobileFitSectionClass } from "./mobileFrame";
import { stripInlineTextColorStylesFromHtml, toRichHtml } from "./richText";

type NavItem = {
  id?: string;
  label?: string;
  pageId?: string;
};

type NavBlockProps = BackgroundEditableProps & {
  heading?: string;
  navOrientation?: "horizontal" | "vertical";
  mobileNavDisplayMode?: "inline" | "hidden";
  forceMobileViewport?: boolean;
  mobileNavButtonBgColor?: string;
  mobileNavButtonBgOpacity?: number;
  mobileNavButtonBorderStyle?: BlockBorderStyle;
  mobileNavButtonLineColor?: string;
  navItemBgColor?: string;
  navItemBgOpacity?: number;
  navItemBorderStyle?: BlockBorderStyle;
  navItemBorderColor?: string;
  navItemActiveBgColor?: string;
  navItemActiveBgOpacity?: number;
  navItemActiveBorderStyle?: BlockBorderStyle;
  navItemActiveBorderColor?: string;
  navItemActiveTextColor?: string;
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

function buildLabelColorStyle(color: string) {
  const trimmed = color.trim();
  if (!trimmed) return {};
  if (isGradientToken(trimmed)) {
    return {
      backgroundImage: trimmed,
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      color: "transparent",
    };
  }
  return { color: trimmed };
}

function toPlainNavText(value: string | undefined, fallback = "") {
  const source = (value ?? "").trim();
  if (!source) return fallback;
  const noTags = source
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return noTags.trim() || fallback;
}

export default function NavBlock(props: NavBlockProps) {
  const { locale } = useI18n();
  const mobileFitScreenWidth = props.mobileFitScreenWidth === true;
  const [mobileMenuOpenPageId, setMobileMenuOpenPageId] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const effectiveMobileViewport = props.forceMobileViewport || isMobileViewport;
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
  const localizedHeading = resolveLocalizedSystemDefaultText(props.heading, "页面导航", locale);
  const localizedNavItems = navItems.map((item) => ({
    ...item,
    label: localizeSystemDefaultText(item.label ?? "", locale),
  }));
  const currentPageKey = props.currentPageId ?? localizedNavItems[0]?.pageId ?? "__default__";
  const mobileMenuOpen = mobileMenuOpenPageId === currentPageKey;
  const activeNavLabel = useMemo(
    () => localizedNavItems.find((item) => item.pageId === props.currentPageId)?.label ?? localizedNavItems[0]?.label ?? localizedHeading,
    [localizedHeading, localizedNavItems, props.currentPageId],
  );
  const hiddenMobileHeadingText = useMemo(() => {
    const localizedSource = props.heading ? localizeSystemDefaultText(props.heading, locale) : "";
    return toPlainNavText(localizedSource, activeNavLabel || localizedHeading);
  }, [activeNavLabel, localizedHeading, locale, props.heading]);
  const hiddenMobileMenuItems = localizedNavItems.map((item) => {
    const isActive = props.currentPageId === item.pageId;
    const labelHtml = toRichHtml(item.label, "");
    const renderedLabelHtml = isActive ? stripInlineTextColorStylesFromHtml(labelHtml) : labelHtml;
    return (
      <button
        key={item.id}
        type="button"
        className={`${navItemClass} w-full ${getBlockBorderClass(isActive ? navItemActiveBorderStyle : navItemBorderStyle)} ${
          isActive ? "" : "hover:brightness-[0.98]"
        }`}
        style={isActive ? navItemActiveStyle : navItemStyle}
        onClick={() => {
          setMobileMenuOpenPageId(null);
          props.onNavigatePage?.(item.pageId);
        }}
      >
        <span
          className="block w-full break-words whitespace-normal"
          style={isActive ? navItemActiveLabelStyle : undefined}
          dangerouslySetInnerHTML={{ __html: renderedLabelHtml }}
        />
      </button>
    );
  });

  useEffect(() => {
    if (props.forceMobileViewport) return;
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);
    syncViewport();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }
    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, [props.forceMobileViewport]);

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
  const navItemClass = "inline-flex max-w-full items-center justify-center rounded px-4 py-2 text-center text-sm leading-tight";
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
  const navItemActiveTextColor = (props.navItemActiveTextColor ?? "").trim();
  const navItemActiveLabelStyle = buildLabelColorStyle(navItemActiveTextColor);
  const mobileNavButtonBgColor = (props.mobileNavButtonBgColor ?? "#ffffff").trim() || "#ffffff";
  const mobileNavButtonBgOpacity =
    typeof props.mobileNavButtonBgOpacity === "number" && Number.isFinite(props.mobileNavButtonBgOpacity)
      ? Math.max(0, Math.min(1, props.mobileNavButtonBgOpacity))
      : 0.8;
  const mobileNavButtonBorderStyle = (props.mobileNavButtonBorderStyle ?? "solid") as BlockBorderStyle;
  const mobileNavButtonBorderColor = "#cbd5e1";
  const mobileNavButtonLineColor = (props.mobileNavButtonLineColor ?? "#334155").trim() || "#334155";
  const mobileNavButtonStyle = {
    ...getBlockBorderInlineStyle(mobileNavButtonBorderStyle, mobileNavButtonBorderColor),
    ...getColorLayerStyle(mobileNavButtonBgColor, mobileNavButtonBgOpacity),
  };
  const hiddenMobileMode = props.mobileNavDisplayMode === "hidden" && effectiveMobileViewport;

  return (
    <section
      className={resolveMobileFitSectionClass("max-w-6xl mx-auto px-6 py-4", mobileFitScreenWidth)}
      style={{
        position: "relative",
        transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
        zIndex: blockLayer,
      }}
    >
      <div
        className={resolveMobileFitCardClass(`rounded-xl shadow-sm p-4 ${borderClass}`, mobileFitScreenWidth)}
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
        {hiddenMobileMode ? (
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:brightness-[0.98] ${getBlockBorderClass(
                  mobileNavButtonBorderStyle,
                )}`}
                  aria-label={mobileMenuOpen ? "收起导航" : "展开导航"}
                style={mobileNavButtonStyle}
                onClick={() => setMobileMenuOpenPageId((current) => (current === currentPageKey ? null : currentPageKey))}
              >
                <span className="inline-flex flex-col items-center justify-center gap-1.5">
                  <span className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: mobileNavButtonLineColor }} />
                  <span className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: mobileNavButtonLineColor }} />
                  <span className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: mobileNavButtonLineColor }} />
                </span>
              </button>
              <div className="min-w-0 flex-1 text-sm font-semibold text-slate-700">
                <div className="truncate">{hiddenMobileHeadingText}</div>
              </div>
            </div>
            {mobileMenuOpen ? (
              <div className="absolute left-0 top-full z-20 mt-3 w-[min(16rem,calc(100vw-4rem))] max-w-full rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
                <div className="mb-2 text-xs font-medium tracking-[0.12em] text-slate-400 uppercase">选择页面</div>
                <nav className="flex flex-col items-stretch gap-2">
                  {hiddenMobileMenuItems}
                </nav>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {props.heading ? (
              <div
                className="text-sm font-semibold text-gray-700 mb-2 whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, localizedHeading) }}
              />
            ) : null}
            <nav className={orientation === "vertical" ? "flex flex-col items-start gap-2" : "flex flex-wrap items-center gap-2"}>
              {localizedNavItems.map((item) => {
                const isActive = props.currentPageId === item.pageId;
                const labelHtml = toRichHtml(item.label, "");
                const renderedLabelHtml = isActive ? stripInlineTextColorStylesFromHtml(labelHtml) : labelHtml;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${navItemClass} ${getBlockBorderClass(isActive ? navItemActiveBorderStyle : navItemBorderStyle)} ${isActive ? "" : "hover:brightness-[0.98]"}`}
                    style={isActive ? navItemActiveStyle : navItemStyle}
                    onClick={() => props.onNavigatePage?.(item.pageId)}
                  >
                    <span
                      className="block w-full break-words whitespace-normal"
                      style={isActive ? navItemActiveLabelStyle : undefined}
                      dangerouslySetInnerHTML={{ __html: renderedLabelHtml }}
                    />
                  </button>
                );
              })}
            </nav>
          </>
        )}
      </div>
    </section>
  );
}

