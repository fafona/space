"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  BackgroundEditableProps,
  BlockBorderStyle,
  MerchantCardTextLayoutConfig,
  MerchantCardTextRole,
  TypographyEditableProps,
} from "@/data/homeBlocks";
import { loadPlatformState, subscribePlatformState, type MerchantSortRule, type PlatformState } from "@/data/platformControlStore";
import { readPageViewDailyStats } from "@/lib/analytics";
import { findEuropeCountryByCode, getEuropeProvinceOptions } from "@/lib/europeLocationOptions";
import {
  buildMerchantCardPlacement,
  getMerchantTabKey,
  getMerchantLayoutCanvasWidth,
  getMerchantLayoutContainerHeight,
  resolveMerchantListLayoutEntries,
  type MerchantCardLayoutConfig,
} from "@/lib/merchantCardLayout";
import {
  normalizeMerchantIndustryTabs,
  type MerchantIndustryTabIndustry,
  type MerchantIndustryTabInput,
} from "@/lib/merchantIndustryTabs";
import { buildMerchantFrontendHref } from "@/lib/siteRouting";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type MerchantListBlockProps = BackgroundEditableProps &
  TypographyEditableProps & {
  heading?: string;
  text?: string;
  maxItems?: number;
  emptyText?: string;
  merchantTabButtonBgColor?: string;
  merchantTabButtonBgOpacity?: number;
  merchantTabButtonBorderStyle?: BlockBorderStyle;
  merchantTabButtonBorderColor?: string;
  merchantTabButtonActiveBgColor?: string;
  merchantTabButtonActiveBgOpacity?: number;
  merchantTabButtonActiveBorderStyle?: BlockBorderStyle;
  merchantTabButtonActiveBorderColor?: string;
  merchantPagerButtonBgColor?: string;
  merchantPagerButtonBgOpacity?: number;
  merchantPagerButtonBorderStyle?: BlockBorderStyle;
  merchantPagerButtonBorderColor?: string;
  merchantPagerButtonDisabledBgColor?: string;
  merchantPagerButtonDisabledBgOpacity?: number;
  merchantPagerButtonDisabledBorderStyle?: BlockBorderStyle;
  merchantPagerButtonDisabledBorderColor?: string;
  merchantCardBgColor?: string;
  merchantCardBgOpacity?: number;
  merchantCardBorderStyle?: BlockBorderStyle;
  merchantCardBorderColor?: string;
  merchantCardTypography?: Partial<Record<MerchantCardTextRole, TypographyEditableProps>>;
  merchantCardTextLayout?: MerchantCardTextLayoutConfig;
  merchantCardTextBoxVisible?: boolean;
  merchantCardIndustryStyles?: Partial<
    Record<
      MerchantIndustryTabIndustry,
      {
        bgColor?: string;
        bgOpacity?: number;
        borderStyle?: BlockBorderStyle;
        borderColor?: string;
      }
    >
  >;
  industryTabs?: MerchantIndustryTabInput[];
  merchantCardLayout?: MerchantCardLayoutConfig;
};

type PortalSearchDetail = {
  countryCode?: string;
  country?: string;
  provinceCode?: string;
  province?: string;
  city?: string;
  keyword?: string;
};

type SearchFilter = {
  countryCode: string;
  country: string;
  provinceCode: string;
  province: string;
  city: string;
  keyword: string;
};
type MerchantRankScope = "recommended" | "industry";
type MerchantRankLevel = "country" | "province" | "city" | null;

const EMPTY_SEARCH_FILTER: SearchFilter = {
  countryCode: "",
  country: "",
  provinceCode: "",
  province: "",
  city: "",
  keyword: "",
};
const INITIAL_SORT_NOW_MS = Date.now();
const REAL_MERCHANT_SITE_ID_REGEX = /^\d{8}$/;

function normalizeLocationValue(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
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

function getColorLayerStyle(value: string, opacity: number) {
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

function buildTypographyInlineStyle(style: TypographyEditableProps | undefined): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const fontFamily = (style?.fontFamily ?? "").trim();
  const fontColor = (style?.fontColor ?? "").trim();
  if (fontFamily) result.fontFamily = fontFamily;
  if (typeof style?.fontSize === "number" && Number.isFinite(style.fontSize) && style.fontSize > 0) {
    result.fontSize = Math.max(8, Math.min(120, style.fontSize));
  }
  if (style?.fontWeight) result.fontWeight = style.fontWeight;
  if (style?.fontStyle) result.fontStyle = style.fontStyle;
  if (style?.textDecoration) result.textDecoration = style.textDecoration;
  if (fontColor) {
    if (isGradientToken(fontColor)) {
      result.backgroundImage = fontColor;
      result.backgroundClip = "text";
      result.WebkitBackgroundClip = "text";
      result.color = "transparent";
    } else {
      result.color = fontColor;
    }
  }
  return result;
}

const DEFAULT_MERCHANT_CARD_TEXT_LAYOUT: Record<MerchantCardTextRole, { x: number; y: number }> = {
  name: { x: 0, y: 0 },
  industry: { x: 0, y: 30 },
  domain: { x: 0, y: 52 },
};

function resolveMerchantCardTextPosition(layout: MerchantCardTextLayoutConfig | undefined, role: MerchantCardTextRole) {
  const fallback = DEFAULT_MERCHANT_CARD_TEXT_LAYOUT[role];
  const current = layout?.[role] ?? {};
  const x = typeof current.x === "number" && Number.isFinite(current.x) ? Math.max(0, Math.round(current.x)) : fallback.x;
  const y = typeof current.y === "number" && Number.isFinite(current.y) ? Math.max(0, Math.round(current.y)) : fallback.y;
  return { x, y };
}

function resolveMerchantIndustryCardStyle(
  stylesByIndustry:
    | Partial<
        Record<
          MerchantIndustryTabIndustry,
          {
            bgColor?: string;
            bgOpacity?: number;
            borderStyle?: BlockBorderStyle;
            borderColor?: string;
          }
        >
      >
    | undefined,
  targetIndustry: MerchantIndustryTabIndustry,
  legacy: {
    bgColor: string;
    bgOpacity: number;
    borderStyle: BlockBorderStyle;
    borderColor: string;
  },
) {
  const scoped = stylesByIndustry?.[targetIndustry];
  const fallback = stylesByIndustry?.all;
  const candidate = scoped ?? fallback;
  if (!candidate) return legacy;
  return {
    bgColor: (candidate.bgColor ?? "").trim() || legacy.bgColor,
    bgOpacity:
      typeof candidate.bgOpacity === "number" && Number.isFinite(candidate.bgOpacity)
        ? Math.max(0, Math.min(1, candidate.bgOpacity))
        : legacy.bgOpacity,
    borderStyle: (candidate.borderStyle ?? legacy.borderStyle) as BlockBorderStyle,
    borderColor: (candidate.borderColor ?? "").trim() || legacy.borderColor,
  };
}

function resolveProvinceName(countryCode: string, provinceCodeOrName: string, fallbackName = "") {
  const raw = (provinceCodeOrName ?? "").trim();
  if (!raw) return (fallbackName ?? "").trim();
  const matched = getEuropeProvinceOptions(countryCode).find((item) => item.code === raw);
  return matched?.name ?? raw;
}

function normalizeSearchFilter(input?: PortalSearchDetail): SearchFilter {
  if (!input) return EMPTY_SEARCH_FILTER;
  const countryCode = (input.countryCode ?? "").trim().toUpperCase();
  const country = (input.country ?? "").trim() || findEuropeCountryByCode(countryCode)?.name || "";
  const provinceCode = (input.provinceCode ?? "").trim();
  const province = (input.province ?? "").trim() || resolveProvinceName(countryCode, provinceCode);
  return {
    countryCode,
    country,
    provinceCode,
    province,
    city: (input.city ?? "").trim(),
    keyword: (input.keyword ?? "").trim(),
  };
}

function siteMatchesFilter(site: PlatformState["sites"][number], filter: SearchFilter) {
  const siteCountryCode = normalizeLocationValue(site.location?.countryCode ?? "");
  const siteCountryName = normalizeLocationValue(site.location?.country ?? "");
  const siteProvinceCode = normalizeLocationValue(site.location?.provinceCode ?? "");
  const siteProvinceName = normalizeLocationValue(site.location?.province ?? "");
  const siteCity = normalizeLocationValue(site.location?.city ?? "");

  const selectedCountryCode = normalizeLocationValue(filter.countryCode);
  const selectedCountryName = normalizeLocationValue(filter.country);
  if (selectedCountryCode || selectedCountryName) {
    const countryMatched =
      (selectedCountryCode && selectedCountryCode === siteCountryCode) ||
      (selectedCountryName && selectedCountryName === siteCountryName);
    if (!countryMatched) return false;
  }

  const selectedProvinceCode = normalizeLocationValue(filter.provinceCode);
  const selectedProvinceName = normalizeLocationValue(filter.province);
  if (selectedProvinceCode || selectedProvinceName) {
    const provinceMatched =
      (selectedProvinceCode && selectedProvinceCode === siteProvinceCode) ||
      (selectedProvinceName && selectedProvinceName === siteProvinceName);
    if (!provinceMatched) return false;
  }

  const selectedCity = normalizeLocationValue(filter.city);
  if (selectedCity && selectedCity !== siteCity) return false;

  const keyword = filter.keyword.trim().toLowerCase();
  if (keyword) {
    const haystack = `${site.merchantName ?? ""} ${site.name} ${site.industry ?? ""} ${site.category} ${site.domain}`.toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }

  return true;
}

function parseIsoTime(iso: string | null | undefined) {
  const time = new Date(iso ?? "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function getSiteDisplayName(site: PlatformState["sites"][number]) {
  return ((site.merchantName ?? "").trim() || site.name || "").trim();
}

function isRealRegisteredMerchantSite(site: PlatformState["sites"][number]) {
  const siteId = String(site.id ?? "").trim();
  return REAL_MERCHANT_SITE_ID_REGEX.test(siteId);
}

function resolveRankLevelByFilter(filter: SearchFilter): MerchantRankLevel {
  if ((filter.city ?? "").trim()) return "city";
  if ((filter.provinceCode ?? "").trim() || (filter.province ?? "").trim()) return "province";
  if ((filter.countryCode ?? "").trim() || (filter.country ?? "").trim()) return "country";
  return null;
}

function readManualRankForSite(
  site: PlatformState["sites"][number],
  scope: MerchantRankScope,
  level: MerchantRankLevel,
) {
  if (!level) return null;
  const config = site.sortConfig;
  if (!config) return null;
  const value =
    scope === "recommended"
      ? level === "country"
        ? config.recommendedCountryRank
        : level === "province"
          ? config.recommendedProvinceRank
          : config.recommendedCityRank
      : level === "country"
        ? config.industryCountryRank
        : level === "province"
          ? config.industryProvinceRank
          : config.industryCityRank;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.round(value)) : null;
}

function readSitePageView30dMap(nowMs: number) {
  const stats = readPageViewDailyStats();
  const map = new Map<string, number>();
  Object.entries(stats).forEach(([bucket, daily]) => {
    if (!bucket.startsWith("site:")) return;
    const siteId = bucket.split(":")[1]?.trim();
    if (!siteId) return;
    let total = 0;
    Object.entries(daily).forEach(([day, value]) => {
      const count = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
      if (count <= 0) return;
      const at = new Date(day).getTime();
      if (!Number.isFinite(at)) return;
      if (nowMs - at < 30 * 86400_000) total += count;
    });
    if (total <= 0) return;
    map.set(siteId, (map.get(siteId) ?? 0) + total);
  });
  return map;
}

function compareByDefaultRule(
  a: PlatformState["sites"][number],
  b: PlatformState["sites"][number],
  rule: MerchantSortRule,
  siteViews30d: Map<string, number>,
) {
  const nameA = getSiteDisplayName(a);
  const nameB = getSiteDisplayName(b);
  const createdA = parseIsoTime(a.createdAt);
  const createdB = parseIsoTime(b.createdAt);
  if (rule === "name_asc") {
    const delta = nameA.localeCompare(nameB, "zh-CN");
    if (delta !== 0) return delta;
  } else if (rule === "name_desc") {
    const delta = nameB.localeCompare(nameA, "zh-CN");
    if (delta !== 0) return delta;
  } else if (rule === "created_asc") {
    const delta = createdA - createdB;
    if (delta !== 0) return delta;
  } else if (rule === "monthly_views_desc") {
    const viewsA = siteViews30d.get(a.id) ?? 0;
    const viewsB = siteViews30d.get(b.id) ?? 0;
    const delta = viewsB - viewsA;
    if (delta !== 0) return delta;
  } else {
    const delta = createdB - createdA;
    if (delta !== 0) return delta;
  }
  if (createdB !== createdA) return createdB - createdA;
  const byName = nameA.localeCompare(nameB, "zh-CN");
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id, "zh-CN");
}

export default function MerchantListBlock(props: MerchantListBlockProps) {
  const [platformState, setPlatformState] = useState<PlatformState>(() => loadPlatformState());
  const [searchFilter, setSearchFilter] = useState<SearchFilter>(EMPTY_SEARCH_FILTER);
  const [activeTabId, setActiveTabId] = useState("tab-recommended");
  const [pageIndex, setPageIndex] = useState(0);
  const [sortNowMs, setSortNowMs] = useState(INITIAL_SORT_NOW_MS);

  useEffect(
    () =>
      subscribePlatformState(() => {
        setPlatformState(loadPlatformState());
      }),
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPortalSearch = (event: Event) => {
      const detail = (event as CustomEvent<PortalSearchDetail>).detail;
      setSearchFilter(normalizeSearchFilter(detail));
    };
    window.addEventListener("portal-search", onPortalSearch as EventListener);
    return () => {
      window.removeEventListener("portal-search", onPortalSearch as EventListener);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setSortNowMs(Date.now()), 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const maxItems =
    typeof props.maxItems === "number" && Number.isFinite(props.maxItems)
      ? Math.max(1, Math.min(24, Math.round(props.maxItems)))
      : 6;
  const emptyText = (props.emptyText ?? "").trim() || "暂无商户";
  const industryTabs = useMemo(() => normalizeMerchantIndustryTabs(props.industryTabs), [props.industryTabs]);
  const activeTab = industryTabs.find((item) => item.id === activeTabId) ?? industryTabs[0];
  const activeIndustry = activeTab?.industry ?? "all";
  const merchantDefaultSortRule = platformState.homeLayout.merchantDefaultSortRule;

  const filteredSites = useMemo(
    () => {
      const rankScope: MerchantRankScope = activeIndustry === "all" ? "recommended" : "industry";
      const rankLevel = resolveRankLevelByFilter(searchFilter);
      const siteViews30d = readSitePageView30dMap(sortNowMs);
      const sorted = [...platformState.sites]
        .filter((site) => isRealRegisteredMerchantSite(site))
        .filter((site) => siteMatchesFilter(site, searchFilter))
        .filter((site) => (activeIndustry === "all" ? true : site.industry === activeIndustry))
        .sort((a, b) => {
          const rankA = readManualRankForSite(a, rankScope, rankLevel);
          const rankB = readManualRankForSite(b, rankScope, rankLevel);
          if (rankA !== null || rankB !== null) {
            if (rankA !== null && rankB !== null && rankA !== rankB) return rankA - rankB;
            if (rankA !== null && rankB === null) return -1;
            if (rankA === null && rankB !== null) return 1;
          }
          return compareByDefaultRule(a, b, merchantDefaultSortRule, siteViews30d);
        });
      return sorted;
    },
    [activeIndustry, merchantDefaultSortRule, platformState.sites, searchFilter, sortNowMs],
  );
  const totalPages = Math.max(1, Math.ceil(filteredSites.length / maxItems));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pagedSites = useMemo(
    () => filteredSites.slice(safePageIndex * maxItems, safePageIndex * maxItems + maxItems),
    [filteredSites, maxItems, safePageIndex],
  );
  const merchantLayoutEntries = useMemo(
    () => resolveMerchantListLayoutEntries(props.merchantCardLayout, maxItems, industryTabs.length),
    [industryTabs.length, maxItems, props.merchantCardLayout],
  );
  const merchantCardEntries = useMemo(
    () => merchantLayoutEntries.filter((item) => item.kind === "card"),
    [merchantLayoutEntries],
  );
  const prevLayout = merchantLayoutEntries.find((item) => item.kind === "prev");
  const nextLayout = merchantLayoutEntries.find((item) => item.kind === "next");
  const merchantLayoutCanvasWidth = useMemo(
    () => getMerchantLayoutCanvasWidth(merchantLayoutEntries),
    [merchantLayoutEntries],
  );
  const merchantLayoutContainerHeight = useMemo(
    () => getMerchantLayoutContainerHeight(merchantLayoutEntries),
    [merchantLayoutEntries],
  );

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
      ? Math.max(280, Math.round(props.blockWidth))
      : undefined;
  const blockHeight =
    typeof props.blockHeight === "number" && Number.isFinite(props.blockHeight)
      ? Math.max(180, Math.round(props.blockHeight))
      : undefined;
  const sizeStyle = {
    width: blockWidth ? `${blockWidth}px` : undefined,
    height: blockHeight ? `${blockHeight}px` : undefined,
    overflow: blockHeight ? ("auto" as const) : undefined,
  };
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
  const offsetStyle = {
    position: "relative" as const,
    transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
    zIndex: blockLayer,
  };
  const borderClass = getBlockBorderClass(props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(props.blockBorderStyle, props.blockBorderColor);
  const merchantTabButtonBgColor = (props.merchantTabButtonBgColor ?? "#ffffff").trim() || "#ffffff";
  const merchantTabButtonBgOpacity =
    typeof props.merchantTabButtonBgOpacity === "number" && Number.isFinite(props.merchantTabButtonBgOpacity)
      ? Math.max(0, Math.min(1, props.merchantTabButtonBgOpacity))
      : 1;
  const merchantTabButtonBorderStyle = (props.merchantTabButtonBorderStyle ?? "solid") as BlockBorderStyle;
  const merchantTabButtonBorderColor = (props.merchantTabButtonBorderColor ?? "#cbd5e1").trim() || "#cbd5e1";
  const merchantTabButtonActiveBgColor = (props.merchantTabButtonActiveBgColor ?? "#000000").trim() || "#000000";
  const merchantTabButtonActiveBgOpacity =
    typeof props.merchantTabButtonActiveBgOpacity === "number" &&
    Number.isFinite(props.merchantTabButtonActiveBgOpacity)
      ? Math.max(0, Math.min(1, props.merchantTabButtonActiveBgOpacity))
      : 1;
  const merchantTabButtonActiveBorderStyle = (props.merchantTabButtonActiveBorderStyle ?? "solid") as BlockBorderStyle;
  const merchantTabButtonActiveBorderColor =
    (props.merchantTabButtonActiveBorderColor ?? "#111827").trim() || "#111827";
  const merchantPagerButtonBgColor = (props.merchantPagerButtonBgColor ?? "#ffffff").trim() || "#ffffff";
  const merchantPagerButtonBgOpacity =
    typeof props.merchantPagerButtonBgOpacity === "number" && Number.isFinite(props.merchantPagerButtonBgOpacity)
      ? Math.max(0, Math.min(1, props.merchantPagerButtonBgOpacity))
      : 1;
  const merchantPagerButtonBorderStyle = (props.merchantPagerButtonBorderStyle ?? "solid") as BlockBorderStyle;
  const merchantPagerButtonBorderColor = (props.merchantPagerButtonBorderColor ?? "#cbd5e1").trim() || "#cbd5e1";
  const merchantPagerButtonDisabledBgColor =
    (props.merchantPagerButtonDisabledBgColor ?? "#e5e7eb").trim() || "#e5e7eb";
  const merchantPagerButtonDisabledBgOpacity =
    typeof props.merchantPagerButtonDisabledBgOpacity === "number" &&
    Number.isFinite(props.merchantPagerButtonDisabledBgOpacity)
      ? Math.max(0, Math.min(1, props.merchantPagerButtonDisabledBgOpacity))
      : 1;
  const merchantPagerButtonDisabledBorderStyle =
    (props.merchantPagerButtonDisabledBorderStyle ?? "solid") as BlockBorderStyle;
  const merchantPagerButtonDisabledBorderColor =
    (props.merchantPagerButtonDisabledBorderColor ?? "#cbd5e1").trim() || "#cbd5e1";
  const merchantCardBgColor = (props.merchantCardBgColor ?? "#f8fafc").trim() || "#f8fafc";
  const merchantCardBgOpacity =
    typeof props.merchantCardBgOpacity === "number" && Number.isFinite(props.merchantCardBgOpacity)
      ? Math.max(0, Math.min(1, props.merchantCardBgOpacity))
      : 1;
  const merchantCardBorderStyle = (props.merchantCardBorderStyle ?? "solid") as BlockBorderStyle;
  const merchantCardBorderColor = (props.merchantCardBorderColor ?? "#cbd5e1").trim() || "#cbd5e1";
  const merchantTabButtonStyle = {
    ...getBlockBorderInlineStyle(merchantTabButtonBorderStyle, merchantTabButtonBorderColor),
    ...getColorLayerStyle(merchantTabButtonBgColor, merchantTabButtonBgOpacity),
  };
  const merchantTabButtonActiveStyle = {
    ...getBlockBorderInlineStyle(merchantTabButtonActiveBorderStyle, merchantTabButtonActiveBorderColor),
    ...getColorLayerStyle(merchantTabButtonActiveBgColor, merchantTabButtonActiveBgOpacity),
  };
  const merchantPagerButtonStyle = {
    ...getBlockBorderInlineStyle(merchantPagerButtonBorderStyle, merchantPagerButtonBorderColor),
    ...getColorLayerStyle(merchantPagerButtonBgColor, merchantPagerButtonBgOpacity),
  };
  const merchantPagerButtonDisabledStyle = {
    ...getBlockBorderInlineStyle(merchantPagerButtonDisabledBorderStyle, merchantPagerButtonDisabledBorderColor),
    ...getColorLayerStyle(merchantPagerButtonDisabledBgColor, merchantPagerButtonDisabledBgOpacity),
  };
  const legacyMerchantCardStyle = {
    bgColor: merchantCardBgColor,
    bgOpacity: merchantCardBgOpacity,
    borderStyle: merchantCardBorderStyle,
    borderColor: merchantCardBorderColor,
  };
  const merchantTabButtonBaseClass = "absolute rounded px-3 py-1.5 text-xs transition";
  const merchantPagerButtonBaseClass = "absolute rounded px-3 py-1.5 text-xs transition disabled:cursor-not-allowed";
  const merchantTypographyBaseStyle: Record<string, string | number> = {};
  if (props.fontFamily?.trim()) merchantTypographyBaseStyle.fontFamily = props.fontFamily.trim();
  if (typeof props.fontSize === "number" && Number.isFinite(props.fontSize) && props.fontSize > 0) {
    merchantTypographyBaseStyle.fontSize = props.fontSize;
  }
  if (props.fontWeight) merchantTypographyBaseStyle.fontWeight = props.fontWeight;
  if (props.fontStyle) merchantTypographyBaseStyle.fontStyle = props.fontStyle;
  if (props.textDecoration) merchantTypographyBaseStyle.textDecoration = props.textDecoration;
  const merchantFontColor = (props.fontColor ?? "").trim();
  const merchantFontColorIsGradient = !!merchantFontColor && isGradientToken(merchantFontColor);
  const merchantButtonLabelStyle: Record<string, string | number> = {
    ...merchantTypographyBaseStyle,
    ...(merchantFontColor
      ? merchantFontColorIsGradient
        ? {
            backgroundImage: merchantFontColor,
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
          }
        : { color: merchantFontColor }
      : {}),
  };
  const merchantCardTypographyMap = (props.merchantCardTypography ??
    {}) as Partial<Record<MerchantCardTextRole, TypographyEditableProps>>;
  const merchantCardNameTextStyle = buildTypographyInlineStyle(merchantCardTypographyMap.name);
  const merchantCardIndustryTextStyle = buildTypographyInlineStyle(merchantCardTypographyMap.industry);
  const merchantCardDomainTextStyle = buildTypographyInlineStyle(merchantCardTypographyMap.domain);
  const merchantCardTextLayout = (props.merchantCardTextLayout ?? {}) as MerchantCardTextLayoutConfig;
  const merchantCardNameTextPosition = resolveMerchantCardTextPosition(merchantCardTextLayout, "name");
  const merchantCardIndustryTextPosition = resolveMerchantCardTextPosition(merchantCardTextLayout, "industry");
  const merchantCardDomainTextPosition = resolveMerchantCardTextPosition(merchantCardTextLayout, "domain");
  const merchantCardTextBoxVisible = props.merchantCardTextBoxVisible === true;
  const merchantCardTextBoxClass = merchantCardTextBoxVisible
    ? "inline-flex w-fit max-w-full rounded border border-slate-300 bg-white/90 px-1.5 py-0.5"
    : "inline-flex w-fit max-w-full";

  return (
    <section className="max-w-6xl mx-auto px-6 py-6" style={offsetStyle}>
      <div
        className={`rounded-xl bg-white p-6 shadow-sm overflow-hidden ${borderClass}`}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        <h2
          className="text-xl font-bold whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, "商户列表") }}
        />
        {props.text ? (
          <div
            className="mt-2 text-sm text-gray-600 whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: toRichHtml(props.text, "") }}
          />
        ) : null}

        <div className="mt-4 max-w-full overflow-x-auto pb-1">
          <div
            className="relative"
            style={{
              width: `${merchantLayoutCanvasWidth}px`,
              minHeight: `${merchantLayoutContainerHeight}px`,
            }}
          >
            {industryTabs.map((tab, index) => {
              const layout = merchantLayoutEntries.find(
                (item) => item.kind === "tab" && item.key === getMerchantTabKey(index),
              );
              if (!layout) return null;
              const isActive = tab.id === activeTab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`${merchantTabButtonBaseClass} ${getBlockBorderClass(
                    isActive ? merchantTabButtonActiveBorderStyle : merchantTabButtonBorderStyle,
                  )} ${isActive ? "text-white" : "text-slate-700 hover:brightness-[0.98]"}`}
                  style={{
                    left: `${layout.x}px`,
                    top: `${layout.y}px`,
                    width: `${layout.width}px`,
                    height: `${layout.height}px`,
                    ...(isActive ? merchantTabButtonActiveStyle : merchantTabButtonStyle),
                  }}
                  onClick={() => {
                    setActiveTabId(tab.id);
                    setPageIndex(0);
                  }}
                >
                  <span style={merchantButtonLabelStyle}>{tab.label}</span>
                </button>
              );
            })}
            {pagedSites.map((site, index) => {
              const layout = buildMerchantCardPlacement(merchantLayoutEntries, index);
              const targetIndustry = (site.industry || "all") as MerchantIndustryTabIndustry;
              const styleConfig = resolveMerchantIndustryCardStyle(
                props.merchantCardIndustryStyles,
                targetIndustry,
                legacyMerchantCardStyle,
              );
              const merchantCardImageUrl = (site.merchantCardImageUrl ?? "").trim();
              const hasMerchantCardImage = merchantCardImageUrl.length > 0;
              const merchantCardStyle = {
                ...getBlockBorderInlineStyle(styleConfig.borderStyle, styleConfig.borderColor),
                ...getColorLayerStyle(styleConfig.bgColor, styleConfig.bgOpacity),
                ...(hasMerchantCardImage
                  ? {
                      backgroundImage: `url(${merchantCardImageUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundRepeat: "no-repeat",
                    }
                  : {}),
              };
              return (
                <Link
                  key={site.id}
                  href={buildMerchantFrontendHref(site.id, site.domainPrefix ?? site.domainSuffix)}
                  className={`absolute block rounded-xl p-4 overflow-auto hover:brightness-[0.98] ${getBlockBorderClass(
                    styleConfig.borderStyle,
                  )}`}
                  style={{
                    left: `${layout.x}px`,
                    top: `${layout.y}px`,
                    width: `${layout.width}px`,
                    height: `${layout.height}px`,
                    ...merchantCardStyle,
                  }}
                >
                  <div className="relative min-w-0 h-full">
                    <div
                      className={`${merchantCardTextBoxClass} text-base font-semibold text-slate-900`}
                      style={{ left: `${merchantCardNameTextPosition.x}px`, top: `${merchantCardNameTextPosition.y}px`, position: "absolute", ...merchantCardNameTextStyle }}
                    >
                      <span className="truncate">{(site.merchantName ?? "").trim() || site.name}</span>
                    </div>
                    <div
                      className={`${merchantCardTextBoxClass} text-xs text-slate-500`}
                      style={{ left: `${merchantCardIndustryTextPosition.x}px`, top: `${merchantCardIndustryTextPosition.y}px`, position: "absolute", ...merchantCardIndustryTextStyle }}
                    >
                      <span className="truncate">{site.industry || site.category || "未分类"}</span>
                    </div>
                    <div
                      className={`${merchantCardTextBoxClass} text-xs text-slate-500`}
                      style={{ left: `${merchantCardDomainTextPosition.x}px`, top: `${merchantCardDomainTextPosition.y}px`, position: "absolute", ...merchantCardDomainTextStyle }}
                    >
                      <span className="truncate">{(site.location?.country ?? "") || "-"} / {(site.location?.province ?? "") || "-"} / {(site.location?.city ?? "") || "-"}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
            {pagedSites.length === 0 ? (
              <div
                className="absolute rounded-lg border border-dashed px-4 py-6 text-sm text-slate-500"
                style={{
                  left: "0px",
                  top: `${merchantCardEntries.length > 0 ? Math.min(...merchantCardEntries.map((item) => item.y)) : 52}px`,
                  width: `${merchantLayoutCanvasWidth}px`,
                  minHeight: `${Math.max(72, merchantCardEntries[0]?.height ?? 72)}px`,
                }}
              >
                {emptyText}
              </div>
            ) : null}
            {prevLayout ? (
              <button
                type="button"
                className={`${merchantPagerButtonBaseClass} ${getBlockBorderClass(
                  safePageIndex <= 0 ? merchantPagerButtonDisabledBorderStyle : merchantPagerButtonBorderStyle,
                )} ${safePageIndex <= 0 ? "text-slate-500" : "text-slate-700 hover:brightness-[0.98]"}`}
                style={{
                  left: `${prevLayout.x}px`,
                  top: `${prevLayout.y}px`,
                  width: `${prevLayout.width}px`,
                  height: `${prevLayout.height}px`,
                  ...(safePageIndex <= 0 ? merchantPagerButtonDisabledStyle : merchantPagerButtonStyle),
                }}
                disabled={safePageIndex <= 0}
                onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
              >
                <span style={merchantButtonLabelStyle}>上一页</span>
              </button>
            ) : null}
            {nextLayout ? (
              <button
                type="button"
                className={`${merchantPagerButtonBaseClass} ${getBlockBorderClass(
                  safePageIndex >= totalPages - 1 ? merchantPagerButtonDisabledBorderStyle : merchantPagerButtonBorderStyle,
                )} ${safePageIndex >= totalPages - 1 ? "text-slate-500" : "text-slate-700 hover:brightness-[0.98]"}`}
                style={{
                  left: `${nextLayout.x}px`,
                  top: `${nextLayout.y}px`,
                  width: `${nextLayout.width}px`,
                  height: `${nextLayout.height}px`,
                  ...(safePageIndex >= totalPages - 1 ? merchantPagerButtonDisabledStyle : merchantPagerButtonStyle),
                }}
                disabled={safePageIndex >= totalPages - 1}
                onClick={() => setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))}
              >
                <span style={merchantButtonLabelStyle}>下一页</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
