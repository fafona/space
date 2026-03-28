"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { BackgroundEditableProps, BlockBorderStyle, TypographyEditableProps } from "@/data/homeBlocks";
import {
  findBestProvinceAndCity,
  findBestCityName,
  findEuropeCountryByCode,
  getEuropeCityOptions,
  getEuropeCountryOptions,
  getEuropeProvinceOptions,
} from "@/lib/europeLocationOptions";
import { resolveReverseGeocodeLocation, type ReverseGeocodeResponse } from "@/lib/reverseGeocodeLocation";
import { useI18n } from "@/components/I18nProvider";
import { resolveLocalizedSystemDefaultText } from "@/lib/editorSystemDefaults";
import { getBackgroundStyle } from "./backgroundStyle";
import { getBlockBorderClass, getBlockBorderInlineStyle } from "./borderStyle";
import { toRichHtml } from "./richText";

type SearchBarBlockProps = BackgroundEditableProps &
  TypographyEditableProps & {
  heading?: string;
  text?: string;
  cityPlaceholder?: string;
  searchPlaceholder?: string;
  locateLabel?: string;
  actionLabel?: string;
  defaultCountryCode?: string;
  defaultProvinceCode?: string;
  defaultCity?: string;
  searchButtonBgColor?: string;
  searchButtonBgOpacity?: number;
  searchButtonBorderStyle?: BlockBorderStyle;
  searchButtonBorderColor?: string;
  searchButtonActiveBgColor?: string;
  searchButtonActiveBgOpacity?: number;
  searchButtonActiveBorderStyle?: BlockBorderStyle;
  searchButtonActiveBorderColor?: string;
  searchLayout?: Partial<
    Record<
      "locate" | "country" | "province" | "city" | "keyword" | "action",
      {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }
    >
  >;
};

const CUSTOM_PROVINCE_PREFIX = "__custom_province__:";
const TYPEAHEAD_LIMIT = 30;
const MAX_AUTO_APPLY_LOCATION_ACCURACY_METERS = 3000;

type SearchOption = {
  value: string;
  label: string;
};

type SearchLayoutKey = "locate" | "country" | "province" | "city" | "keyword" | "action";
type PortalSearchDetail = {
  countryCode: string;
  country: string;
  provinceCode: string;
  province: string;
  city: string;
  keyword: string;
};

function isCustomProvinceCode(value: string) {
  return value.startsWith(CUSTOM_PROVINCE_PREFIX);
}

function normalizeLocationValue(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function resolveDropdownFilterInput(inputValue: string, selectedValue: string, isOpen: boolean) {
  if (!isOpen) return inputValue;
  const normalizedInput = normalizeLocationValue(inputValue);
  const normalizedSelected = normalizeLocationValue(selectedValue);
  if (normalizedInput && normalizedInput === normalizedSelected) return "";
  return inputValue;
}

function hasVisibleRichText(value?: string) {
  const raw = String(value ?? "");
  if (!raw.trim()) return false;
  const stripped = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return stripped.length > 0;
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

function buildFuzzyOptions(options: SearchOption[], inputValue: string, limit = TYPEAHEAD_LIMIT) {
  const normalized = normalizeLocationValue(inputValue);
  if (!normalized) return options;

  const starts: SearchOption[] = [];
  const includes: SearchOption[] = [];
  for (const item of options) {
    const normalizedLabel = normalizeLocationValue(item.label);
    const normalizedValue = normalizeLocationValue(item.value);
    if (normalizedLabel.startsWith(normalized) || normalizedValue.startsWith(normalized)) {
      starts.push(item);
      continue;
    }
    if (normalizedLabel.includes(normalized) || normalizedValue.includes(normalized)) {
      includes.push(item);
    }
    if (starts.length + includes.length >= limit * 3) break;
  }

  return [...starts, ...includes].slice(0, limit);
}

function clampLayoutNumber(value: unknown, fallback: number, min = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback;
}

function logLocateDebug(label: string, detail: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.info(`[search-bar:locate] ${label}`, detail);
}

export default function SearchBarBlock(props: SearchBarBlockProps) {
  const { locale } = useI18n();
  const countryOptions = useMemo(() => getEuropeCountryOptions(), []);
  const normalizedText = useMemo(() => {
    const raw = typeof props.text === "string" ? props.text.trim() : "";
    if (!raw) return "";
    if (raw === "攌城市定位与内容搜") return "城市定位与内容搜索";
    return raw;
  }, [props.text]);
  const initialCountryCode = useMemo(() => {
    const fromProps = (props.defaultCountryCode ?? "").toUpperCase();
    if (!fromProps) return "";
    if (countryOptions.some((item) => item.code === fromProps)) return fromProps;
    return "";
  }, [countryOptions, props.defaultCountryCode]);
  const initialProvinceCode = useMemo(() => {
    if (!initialCountryCode) return "";
    const provinces = getEuropeProvinceOptions(initialCountryCode);
    const fromProps = (props.defaultProvinceCode ?? "").trim();
    if (provinces.some((item) => item.code === fromProps)) return fromProps;
    return "";
  }, [initialCountryCode, props.defaultProvinceCode]);
  const initialCity = useMemo(() => {
    if (!initialCountryCode || !initialProvinceCode) return "";
    const cityByName = findBestCityName(initialCountryCode, initialProvinceCode, props.defaultCity ?? "");
    if (cityByName) return cityByName;
    return "";
  }, [initialCountryCode, initialProvinceCode, props.defaultCity]);
  const initialCountryName = useMemo(
    () => countryOptions.find((item) => item.code === initialCountryCode)?.name ?? "",
    [countryOptions, initialCountryCode],
  );
  const initialProvinceName = useMemo(
    () => getEuropeProvinceOptions(initialCountryCode).find((item) => item.code === initialProvinceCode)?.name ?? "",
    [initialCountryCode, initialProvinceCode],
  );

  const [countryCode, setCountryCode] = useState(initialCountryCode);
  const [provinceCode, setProvinceCode] = useState(initialProvinceCode);
  const [city, setCity] = useState(initialCity);
  const [countryInput, setCountryInput] = useState(initialCountryName);
  const [provinceInput, setProvinceInput] = useState(initialProvinceName);
  const [cityInput, setCityInput] = useState(initialCity);
  const [countryOpen, setCountryOpen] = useState(false);
  const [provinceOpen, setProvinceOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [customProvinceName, setCustomProvinceName] = useState("");
  const [customCityName, setCustomCityName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationHint, setLocationHint] = useState("");
  const [debugLocateText, setDebugLocateText] = useState("");
  const provinceInputRef = useRef<HTMLInputElement | null>(null);
  const cityInputRef = useRef<HTMLInputElement | null>(null);
  const provinceDropdownRef = useRef<HTMLDivElement | null>(null);
  const cityDropdownRef = useRef<HTMLDivElement | null>(null);

  const locateLabel = resolveLocalizedSystemDefaultText(props.locateLabel, "定位", locale);
  const actionLabel = resolveLocalizedSystemDefaultText(props.actionLabel, "搜索", locale);
  const cityPlaceholder = resolveLocalizedSystemDefaultText(props.cityPlaceholder, "选择城市", locale);
  const searchPlaceholder = resolveLocalizedSystemDefaultText(props.searchPlaceholder, "请输入关键词", locale);

  const provinceOptions = useMemo(() => getEuropeProvinceOptions(countryCode), [countryCode]);
  const cityOptions = useMemo(
    () => (isCustomProvinceCode(provinceCode) ? [] : getEuropeCityOptions(countryCode, provinceCode)),
    [countryCode, provinceCode],
  );
  const provinceSelectOptions = useMemo(() => {
    if (!isCustomProvinceCode(provinceCode)) return provinceOptions;
    const customName = customProvinceName.trim();
    if (!customName) return provinceOptions;
    if (provinceOptions.some((item) => item.code === provinceCode)) return provinceOptions;
    return [{ code: provinceCode, name: customName, cities: [customCityName || city].filter(Boolean) }, ...provinceOptions];
  }, [provinceOptions, provinceCode, customProvinceName, customCityName, city]);
  const selectedCountryName = useMemo(
    () => countryOptions.find((item) => item.code === countryCode)?.name ?? "",
    [countryOptions, countryCode],
  );
  const selectedProvinceName = useMemo(
    () => provinceSelectOptions.find((item) => item.code === provinceCode)?.name ?? customProvinceName,
    [provinceSelectOptions, provinceCode, customProvinceName],
  );
  const citySelectOptions = useMemo(() => {
    const list = [...cityOptions];
    const custom = (customCityName || city).trim();
    if (custom && !list.includes(custom)) list.unshift(custom);
    const normalizedProvinceName = normalizeLocationValue(selectedProvinceName);
    if (normalizedProvinceName) {
      const sameNameCityIndex = list.findIndex((item) => normalizeLocationValue(item) === normalizedProvinceName);
      if (sameNameCityIndex > 0) {
        const [sameNameCity] = list.splice(sameNameCityIndex, 1);
        list.unshift(sameNameCity);
      }
    }
    return list;
  }, [cityOptions, customCityName, city, selectedProvinceName]);
  const countrySearchOptions = useMemo<SearchOption[]>(
    () => countryOptions.map((item) => ({ value: item.code, label: item.name })),
    [countryOptions],
  );
  const provinceSearchOptions = useMemo<SearchOption[]>(
    () => provinceSelectOptions.map((item) => ({ value: item.code, label: item.name })),
    [provinceSelectOptions],
  );
  const citySearchOptions = useMemo<SearchOption[]>(
    () => citySelectOptions.map((item) => ({ value: item, label: item })),
    [citySelectOptions],
  );
  const effectiveCountryFilterInput = useMemo(
    () => resolveDropdownFilterInput(countryInput, selectedCountryName, countryOpen),
    [countryInput, selectedCountryName, countryOpen],
  );
  const effectiveProvinceFilterInput = useMemo(
    () => resolveDropdownFilterInput(provinceInput, selectedProvinceName, provinceOpen),
    [provinceInput, selectedProvinceName, provinceOpen],
  );
  const effectiveCityFilterInput = useMemo(
    () => resolveDropdownFilterInput(cityInput, city, cityOpen),
    [cityInput, city, cityOpen],
  );
  const countryFilteredOptions = useMemo(
    () => buildFuzzyOptions(countrySearchOptions, effectiveCountryFilterInput),
    [countrySearchOptions, effectiveCountryFilterInput],
  );
  const provinceFilteredOptions = useMemo(
    () => buildFuzzyOptions(provinceSearchOptions, effectiveProvinceFilterInput),
    [provinceSearchOptions, effectiveProvinceFilterInput],
  );
  const cityFilteredOptions = useMemo(
    () => buildFuzzyOptions(citySearchOptions, effectiveCityFilterInput),
    [citySearchOptions, effectiveCityFilterInput],
  );

  useEffect(() => {
    setCountryCode(initialCountryCode);
    setCustomProvinceName("");
    setCustomCityName("");
  }, [initialCountryCode]);

  useEffect(() => {
    setProvinceCode((current) => {
      if (isCustomProvinceCode(current) && customProvinceName.trim()) return current;
      if (provinceOptions.some((item) => item.code === current)) return current;
      return "";
    });
  }, [provinceOptions, customProvinceName]);

  useEffect(() => {
    setCity((current) => {
      if ((customCityName || "").trim() && current === customCityName) return current;
      if (cityOptions.includes(current)) return current;
      return "";
    });
  }, [cityOptions, customCityName]);

  useEffect(() => {
    setCountryInput(selectedCountryName);
  }, [selectedCountryName]);

  useEffect(() => {
    setProvinceInput(selectedProvinceName);
  }, [selectedProvinceName]);

  useEffect(() => {
    setCityInput(city);
  }, [city]);

  useEffect(() => {
    if (!provinceOpen || !provinceDropdownRef.current) return;
    provinceDropdownRef.current.scrollTop = 0;
  }, [provinceOpen, provinceFilteredOptions]);

  useEffect(() => {
    if (!cityOpen || !cityDropdownRef.current) return;
    cityDropdownRef.current.scrollTop = 0;
  }, [cityOpen, cityFilteredOptions]);

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
      ? Math.max(360, Math.round(props.blockWidth))
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
  const hasDropdownOpen = countryOpen || provinceOpen || cityOpen;
  const offsetStyle = {
    position: "relative" as const,
    transform: offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : undefined,
    zIndex: hasDropdownOpen ? Math.max(blockLayer, 1000) : blockLayer,
  };
  const borderClass = getBlockBorderClass(props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(props.blockBorderStyle, props.blockBorderColor);
  const searchButtonBgColor = (props.searchButtonBgColor ?? "#ffffff").trim() || "#ffffff";
  const searchButtonBgOpacity =
    typeof props.searchButtonBgOpacity === "number" && Number.isFinite(props.searchButtonBgOpacity)
      ? Math.max(0, Math.min(1, props.searchButtonBgOpacity))
      : 1;
  const searchButtonBorderStyle = (props.searchButtonBorderStyle ?? "solid") as BlockBorderStyle;
  const searchButtonBorderColor = pickSolidBorderColor(props.searchButtonBorderColor ?? "#6b7280", "#6b7280");
  const searchButtonActiveBgColor = (props.searchButtonActiveBgColor ?? "#000000").trim() || "#000000";
  const searchButtonActiveBgOpacity =
    typeof props.searchButtonActiveBgOpacity === "number" && Number.isFinite(props.searchButtonActiveBgOpacity)
      ? Math.max(0, Math.min(1, props.searchButtonActiveBgOpacity))
      : 1;
  const searchButtonActiveBorderStyle = (props.searchButtonActiveBorderStyle ?? "solid") as BlockBorderStyle;
  const searchButtonActiveBorderColor = pickSolidBorderColor(
    props.searchButtonActiveBorderColor ?? "#111827",
    "#111827",
  );
  const locateButtonClass = `flex h-full w-full items-center justify-center rounded px-3 text-sm hover:brightness-[0.98] ${getBlockBorderClass(searchButtonBorderStyle)}`;
  const locateButtonStyle = {
    ...getBlockBorderInlineStyle(searchButtonBorderStyle, searchButtonBorderColor),
    ...getColorLayerStyle(searchButtonBgColor, searchButtonBgOpacity),
  };
  const actionButtonClass = `flex h-full w-full items-center justify-center whitespace-nowrap rounded px-4 text-sm text-white hover:brightness-[0.98] ${getBlockBorderClass(searchButtonActiveBorderStyle)}`;
  const actionButtonStyle = {
    ...getBlockBorderInlineStyle(searchButtonActiveBorderStyle, searchButtonActiveBorderColor),
    ...getColorLayerStyle(searchButtonActiveBgColor, searchButtonActiveBgOpacity),
  };
  const searchTypographyBaseStyle: Record<string, string | number> = {};
  if (props.fontFamily?.trim()) searchTypographyBaseStyle.fontFamily = props.fontFamily.trim();
  if (typeof props.fontSize === "number" && Number.isFinite(props.fontSize) && props.fontSize > 0) {
    searchTypographyBaseStyle.fontSize = props.fontSize;
  }
  if (props.fontWeight) searchTypographyBaseStyle.fontWeight = props.fontWeight;
  if (props.fontStyle) searchTypographyBaseStyle.fontStyle = props.fontStyle;
  if (props.textDecoration) searchTypographyBaseStyle.textDecoration = props.textDecoration;
  const searchFontColor = (props.fontColor ?? "").trim();
  const searchFontColorIsGradient = !!searchFontColor && isGradientToken(searchFontColor);
  const searchButtonLabelStyle: Record<string, string | number> = {
    ...searchTypographyBaseStyle,
    ...(searchFontColor
      ? searchFontColorIsGradient
        ? {
            backgroundImage: searchFontColor,
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
          }
        : { color: searchFontColor }
      : {}),
  };
  const searchInputTextStyle: Record<string, string | number> = {
    ...searchTypographyBaseStyle,
  };
  const resolvedSearchInputFontSize =
    typeof searchTypographyBaseStyle.fontSize === "number" && Number.isFinite(searchTypographyBaseStyle.fontSize)
      ? searchTypographyBaseStyle.fontSize
      : undefined;
  const searchInputMobileSafeStyle = {
    ...(searchInputTextStyle as CSSProperties),
  } as CSSProperties & Record<string, string | number>;
  searchInputMobileSafeStyle["--mobile-safe-font-size"] = `${Math.max(0, resolvedSearchInputFontSize ?? 16)}px`;

  const locationHintClass = useMemo(() => {
    if (!locationHint) return "text-slate-500";
    if (locationHint.includes("失败") || locationHint.includes("不支持")) return "text-rose-600";
    return "text-emerald-600";
  }, [locationHint]);
  const hasHeading = hasVisibleRichText(props.heading);
  const hasText = hasVisibleRichText(normalizedText);

  const searchLayout = props.searchLayout ?? {};
  const searchLayoutEntries = [
    {
      key: "locate" as SearchLayoutKey,
      x: clampLayoutNumber(searchLayout.locate?.x, 0),
      y: clampLayoutNumber(searchLayout.locate?.y, 0),
      width: clampLayoutNumber(searchLayout.locate?.width, 72, 56),
      height: clampLayoutNumber(searchLayout.locate?.height, 40, 32),
    },
    {
      key: "country" as SearchLayoutKey,
      x: clampLayoutNumber(searchLayout.country?.x, 82),
      y: clampLayoutNumber(searchLayout.country?.y, 0),
      width: clampLayoutNumber(searchLayout.country?.width, 190, 130),
      height: clampLayoutNumber(searchLayout.country?.height, 40, 32),
    },
    {
      key: "province" as SearchLayoutKey,
      x: clampLayoutNumber(searchLayout.province?.x, 282),
      y: clampLayoutNumber(searchLayout.province?.y, 0),
      width: clampLayoutNumber(searchLayout.province?.width, 190, 130),
      height: clampLayoutNumber(searchLayout.province?.height, 40, 32),
    },
    {
      key: "city" as SearchLayoutKey,
      x: clampLayoutNumber(searchLayout.city?.x, 482),
      y: clampLayoutNumber(searchLayout.city?.y, 0),
      width: clampLayoutNumber(searchLayout.city?.width, 190, 130),
      height: clampLayoutNumber(searchLayout.city?.height, 40, 32),
    },
    {
      key: "keyword" as SearchLayoutKey,
      x: clampLayoutNumber(searchLayout.keyword?.x, 0),
      y: clampLayoutNumber(searchLayout.keyword?.y, 52),
      width: clampLayoutNumber(searchLayout.keyword?.width, 670, 180),
      height: clampLayoutNumber(searchLayout.keyword?.height, 40, 32),
    },
    {
      key: "action" as SearchLayoutKey,
      x: clampLayoutNumber(searchLayout.action?.x, 680),
      y: clampLayoutNumber(searchLayout.action?.y, 52),
      width: clampLayoutNumber(searchLayout.action?.width, 72, 64),
      height: clampLayoutNumber(searchLayout.action?.height, 40, 32),
    },
  ];
  const locateLayout = searchLayoutEntries.find((item) => item.key === "locate") ?? { x: 0, y: 0, width: 72, height: 40 };
  const countryLayout = searchLayoutEntries.find((item) => item.key === "country") ?? { x: 82, y: 0, width: 190, height: 40 };
  const provinceLayout = searchLayoutEntries.find((item) => item.key === "province") ?? { x: 282, y: 0, width: 190, height: 40 };
  const cityLayout = searchLayoutEntries.find((item) => item.key === "city") ?? { x: 482, y: 0, width: 190, height: 40 };
  const keywordLayout = searchLayoutEntries.find((item) => item.key === "keyword") ?? { x: 0, y: 52, width: 670, height: 40 };
  const actionLayout = searchLayoutEntries.find((item) => item.key === "action") ?? { x: 680, y: 52, width: 72, height: 40 };
  const layoutCanvasWidth = Math.max(220, ...searchLayoutEntries.map((item) => item.x + item.width));
  const layoutOffsetY = Math.min(...searchLayoutEntries.map((item) => item.y));
  const toLayoutY = (value: number) => Math.max(0, value - layoutOffsetY);
  const layoutCanvasHeight = Math.max(52, ...searchLayoutEntries.map((item) => toLayoutY(item.y) + item.height));

  const selectCountryCode = (nextCountryCode: string) => {
    const nextCountry = countryOptions.find((item) => item.code === nextCountryCode);
    setCountryCode(nextCountryCode);
    setProvinceCode("");
    setCity("");
    setCustomProvinceName("");
    setCustomCityName("");
    setCountryInput(nextCountry?.name ?? "");
    setProvinceInput("");
    setCityInput("");
    setLocationHint("");
    setCountryOpen(false);
    setProvinceOpen(true);
    setCityOpen(false);
    window.setTimeout(() => {
      provinceInputRef.current?.focus();
      provinceDropdownRef.current?.scrollTo({ top: 0 });
    }, 0);
  };

  const selectProvinceCode = (nextProvinceCode: string) => {
    const nextProvinceName = provinceSelectOptions.find((item) => item.code === nextProvinceCode)?.name ?? "";
    setProvinceCode(nextProvinceCode);
    setCity("");
    setCustomProvinceName(isCustomProvinceCode(nextProvinceCode) ? nextProvinceName : "");
    setCustomCityName("");
    setProvinceInput(nextProvinceName);
    setCityInput("");
    setLocationHint("");
    setProvinceOpen(false);
    setCityOpen(true);
    window.setTimeout(() => {
      cityInputRef.current?.focus();
      cityDropdownRef.current?.scrollTo({ top: 0 });
    }, 0);
  };

  const selectCityName = (nextCity: string) => {
    setCity(nextCity);
    setCustomCityName("");
    setCityInput(nextCity);
    setLocationHint("");
    setCityOpen(false);
  };

  const commitCustomProvince = () => {
    const name = provinceInput.trim();
    if (!name) {
      setProvinceCode("");
      setCustomProvinceName("");
      setCustomCityName("");
      setCity("");
      setProvinceInput("");
      setCityInput("");
      setLocationHint("");
      setProvinceOpen(false);
      return;
    }
    const nextCode = `${CUSTOM_PROVINCE_PREFIX}${name}`;
    setProvinceCode(nextCode);
    setCustomProvinceName(name);
    setCustomCityName("");
    setCity("");
    setCityInput("");
    setLocationHint("");
    setProvinceOpen(false);
  };

  const commitCustomCity = () => {
    const name = cityInput.trim();
    if (!name) {
      setCity("");
      setCustomCityName("");
      setCityOpen(false);
      return;
    }
    const exact = citySelectOptions.find((item) => normalizeLocationValue(item) === normalizeLocationValue(name));
    if (exact) {
      selectCityName(exact);
      return;
    }
    setCity(name);
    setCustomCityName(name);
    setCityInput(name);
    setLocationHint("");
    setCityOpen(false);
  };

  const dispatchPortalSearch = (detail: PortalSearchDetail) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("portal-search", { detail }));
  };

  const triggerSearch = (override?: Partial<PortalSearchDetail>) => {
    const nextCity = (override?.city ?? (cityInput || city)).trim();
    if (!override?.city && nextCity !== city) {
      setCity(nextCity);
      setCustomCityName(citySelectOptions.includes(nextCity) ? "" : nextCity);
    }
    const nextCountryCode = (override?.countryCode ?? countryCode.trim()) || "";
    const nextCountry = (override?.country ?? selectedCountryName) || "";
    const nextProvinceCode =
      override?.provinceCode ??
      (isCustomProvinceCode(provinceCode) ? selectedProvinceName.trim() : provinceCode.trim());
    const nextProvince = (override?.province ?? selectedProvinceName) || "";
    const nextKeyword = (override?.keyword ?? keyword.trim()) || "";
    dispatchPortalSearch({
      countryCode: nextCountryCode,
      country: nextCountry,
      provinceCode: nextProvinceCode,
      province: nextProvince,
      city: nextCity,
      keyword: nextKeyword,
    });
  };

  const applyResolvedPayload = (
    payload: ReverseGeocodeResponse,
    options: {
      debugLabel: string;
      accuracy?: number | null;
      locationHintPrefix?: string;
    },
  ) => {
    const nextCountryCode = (payload.countryCode ?? "").toUpperCase();
    const matchedCountry = findEuropeCountryByCode(nextCountryCode);
    logLocateDebug("reverse-geocode-payload", {
      source: options.debugLabel,
      lookupSource: payload.lookupSource ?? "",
      accuracy: options.accuracy ?? null,
      countryCode: payload.countryCode ?? "",
      countryName: payload.countryName ?? "",
      principalSubdivision: payload.principalSubdivision ?? "",
      principalSubdivisionCode: payload.principalSubdivisionCode ?? "",
      city: payload.city ?? "",
      locality: payload.locality ?? "",
      localityName: payload.localityName ?? "",
    });
    if (!matchedCountry) {
      logLocateDebug("country-not-supported", {
        source: options.debugLabel,
        lookupSource: payload.lookupSource ?? "",
        accuracy: options.accuracy ?? null,
        countryCode: nextCountryCode,
      });
      setLocationHint("已定位，但当前城市不在支持的国家列表中");
      if (process.env.NODE_ENV !== "production") {
        setDebugLocateText(
          `${options.debugLabel} unsupported country=${nextCountryCode} lookupSource=${payload.lookupSource ?? "-"}`,
        );
      }
      return false;
    }

    const { provinceName, cityName, provinceSource, citySource } = resolveReverseGeocodeLocation(payload);
    const matched = findBestProvinceAndCity(matchedCountry.code, provinceName, cityName);
    const knownProvinces = getEuropeProvinceOptions(matchedCountry.code);
    const resolvedProvinceCode = matched.provinceCode || "";
    const fallbackProvinceCode = !resolvedProvinceCode && !provinceName ? knownProvinces[0]?.code || "" : "";
    const activeProvinceCode = resolvedProvinceCode || fallbackProvinceCode;
    const resolvedProvince = knownProvinces.find((item) => item.code === activeProvinceCode) ?? null;
    const provinceCities = activeProvinceCode ? getEuropeCityOptions(matchedCountry.code, activeProvinceCode) : [];
    const normalizedCityName = normalizeLocationValue(cityName);
    const exactCityInProvince =
      normalizedCityName && provinceCities.length > 0
        ? provinceCities.find((item) => normalizeLocationValue(item) === normalizedCityName) ?? ""
        : "";
    const resolvedCity = matched.cityName || exactCityInProvince || cityName || provinceCities[0] || "";
    const resolvedProvinceName = resolvedProvince?.name || provinceName || "";
    const hasKnownProvince = !!resolvedProvince;
    const useCustomProvince = !hasKnownProvince && !!provinceName;
    const useCustomCity = !!resolvedCity && !provinceCities.includes(resolvedCity);
    logLocateDebug("resolved-location", {
      source: options.debugLabel,
      lookupSource: payload.lookupSource ?? "",
      accuracy: options.accuracy ?? null,
      matchedCountryCode: matchedCountry.code,
      matchedCountryName: matchedCountry.name,
      rawProvinceName: provinceName,
      rawCityName: cityName,
      provinceSource,
      citySource,
      resolvedProvinceCode,
      activeProvinceCode,
      resolvedProvinceName,
      resolvedCity,
      useCustomProvince,
      useCustomCity,
    });

    setCountryCode(matchedCountry.code);
    setCountryInput(matchedCountry.name);
    if (useCustomProvince) {
      setProvinceCode(`${CUSTOM_PROVINCE_PREFIX}${provinceName}`);
      setCustomProvinceName(provinceName);
      setProvinceInput(provinceName);
    } else {
      setProvinceCode(activeProvinceCode);
      setCustomProvinceName("");
      setProvinceInput(resolvedProvinceName);
    }
    setCustomCityName(useCustomCity ? resolvedCity : "");
    setCity(resolvedCity);
    setCityInput(resolvedCity);
    setLocationHint(
      `${options.locationHintPrefix ?? "已定位"}: ${matchedCountry.name}${resolvedProvinceName ? ` / ${resolvedProvinceName}` : ""}${
        resolvedCity ? ` / ${resolvedCity}` : ""
      }`,
    );
    if (process.env.NODE_ENV !== "production") {
      setDebugLocateText(
        `${options.debugLabel} raw=${matchedCountry.name}/${provinceName || "-"}/${cityName || "-"} -> matched=${matchedCountry.name}/${resolvedProvinceName || "-"}/${resolvedCity || "-"} lookupSource=${payload.lookupSource ?? "-"} accuracy=${options.accuracy !== null && options.accuracy !== undefined ? `${Math.round(options.accuracy)}m` : '-'}`,
      );
    }
    const searchProvinceCode = resolvedProvinceCode ? activeProvinceCode : "";
    const searchProvinceName = resolvedProvinceCode ? resolvedProvinceName : "";
    const searchCity = resolvedProvinceCode && provinceCities.includes(resolvedCity) ? resolvedCity : "";
    triggerSearch({
      countryCode: matchedCountry.code,
      country: matchedCountry.name,
      provinceCode: searchProvinceCode,
      province: searchProvinceName,
      city: searchCity,
      keyword: keyword.trim(),
    });
    return true;
  };

  const fetchIpFallbackLocation = async (reason: string, accuracy?: number | null) => {
    logLocateDebug("ip-fallback-start", {
      reason,
      accuracy: accuracy ?? null,
    });
    try {
      const response = await fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en", {
        cache: "no-store",
      });
      if (!response.ok) {
        logLocateDebug("ip-fallback-http-error", {
          reason,
          accuracy: accuracy ?? null,
          status: response.status,
          statusText: response.statusText,
        });
        setLocationHint("自动定位不可用，请手动选择国家/省份/城市");
        if (process.env.NODE_ENV !== "production") {
          setDebugLocateText(
            `ip fallback http error status=${response.status} reason=${reason} accuracy=${accuracy ?? "-"}`,
          );
        }
        return false;
      }
      const payload = (await response.json()) as ReverseGeocodeResponse;
      return applyResolvedPayload(payload, {
        debugLabel: `ip-fallback(${reason})`,
        accuracy,
        locationHintPrefix: "IP定位",
      });
    } catch (error) {
      logLocateDebug("ip-fallback-exception", {
        reason,
        accuracy: accuracy ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      setLocationHint("自动定位不可用，请手动选择国家/省份/城市");
      if (process.env.NODE_ENV !== "production") {
        setDebugLocateText(
          `ip fallback exception=${error instanceof Error ? error.message : String(error)} reason=${reason}`,
        );
      }
      return false;
    }
  };

  const onLocate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (process.env.NODE_ENV !== "production") setDebugLocateText("geolocation unavailable -> trying ip fallback");
      setLocating(true);
      void fetchIpFallbackLocation("geolocation-unavailable").finally(() => setLocating(false));
      return;
    }
    setLocating(true);
    setLocationHint("");
    if (process.env.NODE_ENV !== "production") setDebugLocateText("requesting geolocation...");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        if (process.env.NODE_ENV !== "production") {
          setDebugLocateText(`coords lat=${lat.toFixed(6)} lng=${lng.toFixed(6)} accuracy=${Math.round(accuracy)}m`);
        }
        logLocateDebug("position", {
          latitude: lat,
          longitude: lng,
          accuracy,
        });
        if (accuracy > MAX_AUTO_APPLY_LOCATION_ACCURACY_METERS) {
          logLocateDebug("position-accuracy-too-low", {
            latitude: lat,
            longitude: lng,
            accuracy,
            maxAutoApplyAccuracy: MAX_AUTO_APPLY_LOCATION_ACCURACY_METERS,
          });
          if (process.env.NODE_ENV !== "production") {
            setDebugLocateText(
              `coords lat=${lat.toFixed(6)} lng=${lng.toFixed(6)} accuracy=${Math.round(accuracy)}m -> trying ip fallback`,
            );
          }
          void fetchIpFallbackLocation("low-accuracy", accuracy).finally(() => setLocating(false));
          return;
        }
        try {
          const response = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
            { cache: "no-store" },
          );
          if (!response.ok) {
            logLocateDebug("reverse-geocode-http-error", {
              status: response.status,
              statusText: response.statusText,
              latitude: lat,
              longitude: lng,
              accuracy,
            });
            setLocationHint("定位成功，但城市解析失败");
            if (process.env.NODE_ENV !== "production") {
              setDebugLocateText(
                `reverse geocode http error status=${response.status} lat=${lat.toFixed(6)} lng=${lng.toFixed(6)}`,
              );
            }
            return;
          }
          const payload = (await response.json()) as ReverseGeocodeResponse;
          applyResolvedPayload(payload, {
            debugLabel: "browser-geolocation",
            accuracy,
          });
        } catch (error) {
          logLocateDebug("reverse-geocode-exception", {
            latitude: lat,
            longitude: lng,
            accuracy,
            error: error instanceof Error ? error.message : String(error),
          });
          setLocationHint("定位成功，但城市解析失败，请手动选择");
          if (process.env.NODE_ENV !== "production") {
            setDebugLocateText(
              `reverse geocode exception=${error instanceof Error ? error.message : String(error)} lat=${lat.toFixed(6)} lng=${lng.toFixed(6)} -> trying ip fallback`,
            );
          }
          await fetchIpFallbackLocation("reverse-geocode-exception", accuracy);
        } finally {
          setLocating(false);
        }
      },
      (error) => {
        logLocateDebug("geolocation-error", {
          code: error.code,
          message: error.message,
        });
        if (process.env.NODE_ENV !== "production") {
          setDebugLocateText(`geolocation error code=${error.code} message=${error.message} -> trying ip fallback`);
        }
        void fetchIpFallbackLocation(`geolocation-error-${error.code}`).finally(() => setLocating(false));
      },
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      },
    );
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    triggerSearch();
  };

  return (
    <section className="max-w-6xl mx-auto px-6 py-6" style={offsetStyle}>
      <div
        className={`rounded-xl bg-white p-6 shadow-sm overflow-visible ${borderClass}`}
        style={{ ...cardStyle, ...sizeStyle, ...borderInlineStyle }}
      >
        {hasHeading ? (
          <h2
            className="text-xl font-bold whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: toRichHtml(props.heading, "") }}
          />
        ) : null}
        {hasText ? (
          <div
            className="mt-2 text-sm text-gray-600 whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: toRichHtml(normalizedText, "") }}
          />
        ) : null}
        <form onSubmit={onSearch} className={`${hasHeading || hasText ? "mt-4 " : ""}space-y-3`}>
          <div className="relative" style={{ minHeight: `${layoutCanvasHeight}px`, width: `${layoutCanvasWidth}px`, maxWidth: "100%" }}>
            <div
              className="absolute"
              style={{
                left: `${locateLayout.x}px`,
                top: `${toLayoutY(locateLayout.y)}px`,
                width: `${locateLayout.width}px`,
                height: `${locateLayout.height}px`,
              }}
            >
              <button
                type="button"
                className={`${locateButtonClass} disabled:opacity-60`}
                style={locateButtonStyle}
                onClick={onLocate}
                disabled={locating}
              >
                <span style={searchButtonLabelStyle}>{locating ? "定位中..." : locateLabel}</span>
              </button>
            </div>

            <div
              className="absolute"
              style={{
                left: `${countryLayout.x}px`,
                top: `${toLayoutY(countryLayout.y)}px`,
                width: `${countryLayout.width}px`,
                height: `${countryLayout.height}px`,
              }}
            >
              <div className="relative h-full">
                <input
                  value={countryInput}
                  placeholder="国家"
                  onChange={(event) => {
                    const next = event.target.value;
                    setCountryInput(next);
                    setCountryOpen(true);
                    if (!next.trim()) {
                      setCountryCode("");
                      setProvinceCode("");
                      setCity("");
                      setProvinceInput("");
                      setCityInput("");
                      setCustomProvinceName("");
                      setCustomCityName("");
                      setProvinceOpen(false);
                      setCityOpen(false);
                      return;
                    }
                  }}
                  onFocus={() => setCountryOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setCountryOpen(false);
                    }, 120);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (!countryInput.trim()) {
                      setCountryCode("");
                      setProvinceCode("");
                      setCity("");
                      setProvinceInput("");
                      setCityInput("");
                      setCustomProvinceName("");
                      setCustomCityName("");
                      setCountryOpen(false);
                      setProvinceOpen(false);
                      setCityOpen(false);
                      return;
                    }
                    if (countryFilteredOptions[0]) {
                      selectCountryCode(countryFilteredOptions[0].value);
                    }
                  }}
                  className="mobile-safe-input-text h-full w-full rounded border bg-white px-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-200 placeholder:text-slate-400"
                  style={searchInputMobileSafeStyle}
                />
                {countryOpen && countryFilteredOptions.length > 0 ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-56 overflow-auto rounded border bg-white shadow">
                    {countryFilteredOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectCountryCode(item.value);
                        }}
                        className="block w-full truncate px-2 py-2 text-left text-sm hover:bg-slate-100"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className="absolute"
              style={{
                left: `${provinceLayout.x}px`,
                top: `${toLayoutY(provinceLayout.y)}px`,
                width: `${provinceLayout.width}px`,
                height: `${provinceLayout.height}px`,
              }}
            >
              <div className="relative h-full">
                <input
                  ref={provinceInputRef}
                  value={provinceInput}
                  placeholder="省份"
                  onChange={(event) => {
                    const next = event.target.value;
                    setProvinceInput(next);
                    setProvinceOpen(true);
                    if (!next.trim()) {
                      setProvinceCode("");
                      setCustomProvinceName("");
                      setCustomCityName("");
                      setCity("");
                      setCityInput("");
                      setCityOpen(false);
                      return;
                    }
                  }}
                  onFocus={() => setProvinceOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setProvinceOpen(false);
                    }, 120);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (!provinceInput.trim()) {
                      setProvinceCode("");
                      setCustomProvinceName("");
                      setCustomCityName("");
                      setCity("");
                      setCityInput("");
                      setProvinceOpen(false);
                      setCityOpen(false);
                      return;
                    }
                    if (provinceFilteredOptions[0]) {
                      selectProvinceCode(provinceFilteredOptions[0].value);
                      return;
                    }
                    commitCustomProvince();
                  }}
                  className="mobile-safe-input-text h-full w-full rounded border bg-white px-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-200 placeholder:text-slate-400"
                  style={searchInputMobileSafeStyle}
                />
                {provinceOpen && provinceFilteredOptions.length > 0 ? (
                  <div
                    ref={provinceDropdownRef}
                    className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-56 overflow-auto rounded border bg-white shadow"
                  >
                    {provinceFilteredOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectProvinceCode(item.value);
                        }}
                        className="block w-full truncate px-2 py-2 text-left text-sm hover:bg-slate-100"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className="absolute"
              style={{
                left: `${cityLayout.x}px`,
                top: `${toLayoutY(cityLayout.y)}px`,
                width: `${cityLayout.width}px`,
                height: `${cityLayout.height}px`,
              }}
            >
              <div className="relative h-full">
                <input
                  ref={cityInputRef}
                  value={cityInput}
                  placeholder={cityPlaceholder}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCityInput(next);
                    setCityOpen(true);
                    if (!next.trim()) {
                      setCity("");
                      setCustomCityName("");
                      return;
                    }
                    const normalized = normalizeLocationValue(next);
                    const exact = citySearchOptions.find((item) => normalizeLocationValue(item.label) === normalized);
                    if (exact) {
                      setCity(exact.value);
                      setCustomCityName("");
                      return;
                    }
                    setCity(next.trim());
                    setCustomCityName(next.trim());
                  }}
                  onFocus={() => setCityOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setCityOpen(false);
                      if (!cityInput.trim()) {
                        setCity("");
                        setCustomCityName("");
                      }
                    }, 120);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (cityFilteredOptions[0]) {
                      selectCityName(cityFilteredOptions[0].value);
                      return;
                    }
                    commitCustomCity();
                  }}
                  className="mobile-safe-input-text h-full w-full rounded border bg-white px-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-200 placeholder:text-slate-400"
                  style={searchInputMobileSafeStyle}
                />
                {cityOpen && cityFilteredOptions.length > 0 ? (
                  <div
                    ref={cityDropdownRef}
                    className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-56 overflow-auto rounded border bg-white shadow"
                  >
                    {cityFilteredOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectCityName(item.value);
                        }}
                        className="block w-full truncate px-2 py-2 text-left text-sm hover:bg-slate-100"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className="absolute"
              style={{
                left: `${keywordLayout.x}px`,
                top: `${toLayoutY(keywordLayout.y)}px`,
                width: `${keywordLayout.width}px`,
                height: `${keywordLayout.height}px`,
              }}
            >
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="mobile-safe-input-text h-full w-full rounded border bg-white px-3 text-sm text-slate-600 outline-none focus:ring-2 focus:ring-blue-200 placeholder:text-slate-400"
                style={searchInputMobileSafeStyle}
                placeholder={searchPlaceholder}
              />
            </div>

            <div
              className="absolute"
              style={{
                left: `${actionLayout.x}px`,
                top: `${toLayoutY(actionLayout.y)}px`,
                width: `${actionLayout.width}px`,
                height: `${actionLayout.height}px`,
              }}
            >
              <button
                type="submit"
                className={actionButtonClass}
                style={actionButtonStyle}
              >
                <span style={searchButtonLabelStyle}>{actionLabel}</span>
              </button>
            </div>
          </div>
        </form>
        <div className={`mt-2 text-xs ${locationHintClass}`}>{locationHint || "可点击定位，或手动选择国家/省份/城市。"}</div>
      </div>
    </section>
  );
}
