"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { BackgroundEditableProps, BlockBorderStyle, TypographyEditableProps } from "@/data/homeBlocks";
import {
  findBestProvinceAndCity,
  findBestCityName,
  findEuropeCountryByCode,
  getEuropeCityOptions,
  getEuropeCountryOptions,
  getEuropeProvinceOptions,
} from "@/lib/europeLocationOptions";
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

type ReverseGeocodeResponse = {
  countryCode?: string;
  principalSubdivision?: string;
  city?: string;
  locality?: string;
  localityName?: string;
  localityInfo?: {
    administrative?: Array<{
      name?: string;
    }>;
  };
};

const CUSTOM_PROVINCE_PREFIX = "__custom_province__:";
const TYPEAHEAD_LIMIT = 30;

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
    .replace(/[^a-z0-9]/g, "");
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
  if (!normalized) return options.slice(0, limit);

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

export default function SearchBarBlock(props: SearchBarBlockProps) {
  const countryOptions = useMemo(() => getEuropeCountryOptions(), []);
  const initialCountryCode = useMemo(() => {
    const fromProps = (props.defaultCountryCode ?? "").toUpperCase();
    if (countryOptions.some((item) => item.code === fromProps)) return fromProps;
    return countryOptions[0]?.code ?? "";
  }, [countryOptions, props.defaultCountryCode]);
  const initialProvinceCode = useMemo(() => {
    const provinces = getEuropeProvinceOptions(initialCountryCode);
    const fromProps = (props.defaultProvinceCode ?? "").trim();
    if (provinces.some((item) => item.code === fromProps)) return fromProps;
    return provinces[0]?.code ?? "";
  }, [initialCountryCode, props.defaultProvinceCode]);
  const initialCity = useMemo(() => {
    const cityByName = findBestCityName(initialCountryCode, initialProvinceCode, props.defaultCity ?? "");
    if (cityByName) return cityByName;
    return getEuropeCityOptions(initialCountryCode, initialProvinceCode)[0] ?? "";
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

  const locateLabel = (props.locateLabel ?? "").trim() || "定位";
  const actionLabel = (props.actionLabel ?? "").trim() || "搜索";
  const cityPlaceholder = (props.cityPlaceholder ?? "").trim() || "选择城市";
  const searchPlaceholder = (props.searchPlaceholder ?? "").trim() || "请输入关键词";

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
  const citySelectOptions = useMemo(() => {
    const list = [...cityOptions];
    const custom = (customCityName || city).trim();
    if (custom && !list.includes(custom)) list.unshift(custom);
    return list;
  }, [cityOptions, customCityName, city]);
  const selectedCountryName = useMemo(
    () => countryOptions.find((item) => item.code === countryCode)?.name ?? "",
    [countryOptions, countryCode],
  );
  const selectedProvinceName = useMemo(
    () => provinceSelectOptions.find((item) => item.code === provinceCode)?.name ?? customProvinceName,
    [provinceSelectOptions, provinceCode, customProvinceName],
  );
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
  const countryFilteredOptions = useMemo(
    () => buildFuzzyOptions(countrySearchOptions, countryInput),
    [countrySearchOptions, countryInput],
  );
  const provinceFilteredOptions = useMemo(
    () => buildFuzzyOptions(provinceSearchOptions, provinceInput),
    [provinceSearchOptions, provinceInput],
  );
  const cityFilteredOptions = useMemo(
    () => buildFuzzyOptions(citySearchOptions, cityInput),
    [citySearchOptions, cityInput],
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
    ...(searchFontColor && !searchFontColorIsGradient ? { color: searchFontColor } : {}),
  };

  const locationHintClass = useMemo(() => {
    if (!locationHint) return "text-slate-500";
    if (locationHint.includes("失败") || locationHint.includes("不支持")) return "text-rose-600";
    return "text-emerald-600";
  }, [locationHint]);
  const hasHeading = hasVisibleRichText(props.heading);
  const hasText = hasVisibleRichText(props.text);

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
    setCountryOpen(false);
    setProvinceOpen(false);
    setCityOpen(false);
  };

  const selectProvinceCode = (nextProvinceCode: string) => {
    const nextProvinceName = provinceSelectOptions.find((item) => item.code === nextProvinceCode)?.name ?? "";
    setProvinceCode(nextProvinceCode);
    setCity("");
    setCustomProvinceName(isCustomProvinceCode(nextProvinceCode) ? nextProvinceName : "");
    setCustomCityName("");
    setProvinceInput(nextProvinceName);
    setCityInput("");
    setProvinceOpen(false);
    setCityOpen(false);
  };

  const selectCityName = (nextCity: string) => {
    setCity(nextCity);
    setCustomCityName("");
    setCityInput(nextCity);
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
      setProvinceOpen(false);
      return;
    }
    const nextCode = `${CUSTOM_PROVINCE_PREFIX}${name}`;
    setProvinceCode(nextCode);
    setCustomProvinceName(name);
    setCustomCityName("");
    setCity("");
    setCityInput("");
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

  const onLocate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationHint("当前浏览器不支持定位");
      return;
    }
    setLocating(true);
    setLocationHint("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        try {
          const response = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
            { cache: "no-store" },
          );
          if (!response.ok) {
            setLocationHint("定位成功，但城市解析失败");
            return;
          }
          const payload = (await response.json()) as ReverseGeocodeResponse;
          const nextCountryCode = (payload.countryCode ?? "").toUpperCase();
          const matchedCountry = findEuropeCountryByCode(nextCountryCode);
          if (!matchedCountry) {
            setLocationHint("已定位，但当前城市不在欧洲国家列表中");
            return;
          }

          const provinceName =
            (payload.principalSubdivision ?? "").trim() ||
            (payload.localityInfo?.administrative?.[0]?.name ?? "").trim();
          const cityName =
            (payload.city ?? "").trim() || (payload.locality ?? "").trim() || (payload.localityName ?? "").trim();
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

          setCountryCode(matchedCountry.code);
          if (useCustomProvince) {
            setProvinceCode(`${CUSTOM_PROVINCE_PREFIX}${provinceName}`);
            setCustomProvinceName(provinceName);
          } else {
            setProvinceCode(activeProvinceCode);
            setCustomProvinceName("");
          }
          setCustomCityName(useCustomCity ? resolvedCity : "");
          setCity(resolvedCity);
          setLocationHint(
            `已定位: ${matchedCountry.name}${resolvedProvinceName ? ` / ${resolvedProvinceName}` : ""}${
              resolvedCity ? ` / ${resolvedCity}` : ""
            }`,
          );
          triggerSearch({
            countryCode: matchedCountry.code,
            country: matchedCountry.name,
            provinceCode: useCustomProvince ? resolvedProvinceName : activeProvinceCode,
            province: resolvedProvinceName,
            city: resolvedCity,
            keyword: keyword.trim(),
          });
        } catch {
          setLocationHint("定位成功，但城市解析失败，请手动选择");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setLocationHint("定位失败");
      },
      {
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 300_000,
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
            dangerouslySetInnerHTML={{ __html: toRichHtml(props.text, "") }}
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
                  className="h-full w-full rounded border bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 placeholder:text-current"
                  style={searchInputTextStyle}
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
                  className="h-full w-full rounded border bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 placeholder:text-current"
                  style={searchInputTextStyle}
                />
                {provinceOpen && provinceFilteredOptions.length > 0 ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-56 overflow-auto rounded border bg-white shadow">
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
                  className="h-full w-full rounded border bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-blue-200 placeholder:text-current"
                  style={searchInputTextStyle}
                />
                {cityOpen && cityFilteredOptions.length > 0 ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-56 overflow-auto rounded border bg-white shadow">
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
                className="h-full w-full rounded border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-200 placeholder:text-current"
                style={searchInputTextStyle}
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
