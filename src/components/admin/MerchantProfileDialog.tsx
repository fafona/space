"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MERCHANT_INDUSTRY_OPTIONS,
  type MerchantIndustry,
  type SiteLocation,
} from "@/data/platformControlStore";
import {
  findEuropeCountryByCode,
  getEuropeCityOptions,
  getEuropeCountryOptions,
  getEuropeProvinceOptions,
} from "@/lib/europeLocationOptions";
import { buildMerchantDomain, resolveMerchantRootHost } from "@/lib/siteRouting";

type MerchantProfileDialogProps = {
  open: boolean;
  siteId?: string | null;
  siteBaseDomain: string;
  initialServiceExpiresAt?: string | null;
  initialDomainPrefix?: string | null;
  takenDomainPrefixes?: string[];
  initialMerchantName?: string | null;
  initialContactAddress?: string | null;
  initialContactName?: string | null;
  initialContactPhone?: string | null;
  initialContactEmail?: string | null;
  initialLocation?: Partial<SiteLocation> | null;
  initialIndustry?: string | null;
  onClose: () => void;
  onSave: (input: {
    merchantName: string;
    domainPrefix: string;
    contactAddress: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    location: SiteLocation;
    industry: MerchantIndustry;
  }) => void;
};

type SearchOption = {
  value: string;
  label: string;
};

const CUSTOM_PROVINCE_PREFIX = "__custom_province__:";
const TYPEAHEAD_LIMIT = 30;
const DOMAIN_SUFFIX_SUBMIT_COOLDOWN_MS = 60 * 1000;

function getDomainSuffixCooldownStorageKey(siteId?: string | null) {
  const normalizedSiteId = String(siteId ?? "").trim() || "unknown-site";
  return `merchant-space:merchant-profile:domain-prefix-last-submit:v2:${normalizedSiteId}`;
}

function readDomainSuffixLastSubmitAt(siteId?: string | null) {
  if (typeof window === "undefined") return 0;
  try {
    const key = getDomainSuffixCooldownStorageKey(siteId);
    const raw = window.localStorage.getItem(key);
    const num = Number(raw ?? 0);
    return Number.isFinite(num) && num > 0 ? num : 0;
  } catch {
    return 0;
  }
}

function writeDomainSuffixLastSubmitAt(siteId: string | null | undefined, at: number) {
  if (typeof window === "undefined") return;
  try {
    const key = getDomainSuffixCooldownStorageKey(siteId);
    window.localStorage.setItem(key, String(Math.max(0, Math.floor(at))));
  } catch {
    // ignore storage failures
  }
}

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

function normalizeIndustry(value: unknown): MerchantIndustry {
  const raw = typeof value === "string" ? value.trim() : "";
  return MERCHANT_INDUSTRY_OPTIONS.find((item) => item === raw) ?? "";
}

function formatServiceExpiresAt(iso?: string | null) {
  const raw = String(iso ?? "").trim();
  if (!raw) return "未设置";
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : raw;
}

type MerchantProfileInitialState = {
  merchantName: string;
  domainPrefix: string;
  contactAddress: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  countryCode: string;
  countryInput: string;
  provinceCode: string;
  provinceInput: string;
  city: string;
  cityInput: string;
  customProvinceName: string;
  customCityName: string;
  industry: MerchantIndustry;
};

function buildInitialState(
  countryOptions: ReturnType<typeof getEuropeCountryOptions>,
  initialMerchantName?: string | null,
  initialDomainPrefix?: string | null,
  initialContactAddress?: string | null,
  initialContactName?: string | null,
  initialContactPhone?: string | null,
  initialContactEmail?: string | null,
  initialLocation?: Partial<SiteLocation> | null,
  initialIndustry?: string | null,
): MerchantProfileInitialState {
  const nextCountryCodeCandidate = (initialLocation?.countryCode ?? "").toUpperCase();
  const nextCountryCode = countryOptions.some((item) => item.code === nextCountryCodeCandidate)
    ? nextCountryCodeCandidate
    : "";
  const nextCountryName =
    countryOptions.find((item) => item.code === nextCountryCode)?.name ?? (initialLocation?.country ?? "").trim();

  const allProvinces = getEuropeProvinceOptions(nextCountryCode);
  const initialProvinceCode = (initialLocation?.provinceCode ?? "").trim();
  const initialProvinceName = (initialLocation?.province ?? "").trim();
  let nextProvinceCode = "";
  let nextCustomProvince = "";
  if (initialProvinceCode && allProvinces.some((item) => item.code === initialProvinceCode)) {
    nextProvinceCode = initialProvinceCode;
  } else if (initialProvinceName) {
    const byName = allProvinces.find(
      (item) => normalizeLocationValue(item.name) === normalizeLocationValue(initialProvinceName),
    );
    if (byName) nextProvinceCode = byName.code;
    else {
      nextProvinceCode = `${CUSTOM_PROVINCE_PREFIX}${initialProvinceName}`;
      nextCustomProvince = initialProvinceName;
    }
  }

  const resolvedProvinceName =
    allProvinces.find((item) => item.code === nextProvinceCode)?.name ?? initialProvinceName;
  const allCities = nextProvinceCode && !isCustomProvinceCode(nextProvinceCode) ? getEuropeCityOptions(nextCountryCode, nextProvinceCode) : [];
  const initialCityName = (initialLocation?.city ?? "").trim();
  const matchedCity =
    allCities.find((item) => normalizeLocationValue(item) === normalizeLocationValue(initialCityName)) ?? "";
  const resolvedCity = matchedCity || initialCityName;

  return {
    merchantName: (initialMerchantName ?? "").trim(),
    domainPrefix: (initialDomainPrefix ?? "").trim().toLowerCase(),
    contactAddress: (initialContactAddress ?? "").trim(),
    contactName: (initialContactName ?? "").trim(),
    contactPhone: (initialContactPhone ?? "").trim(),
    contactEmail: (initialContactEmail ?? "").trim(),
    countryCode: nextCountryCode,
    countryInput: nextCountryName,
    provinceCode: nextProvinceCode,
    provinceInput: resolvedProvinceName,
    city: resolvedCity,
    cityInput: resolvedCity,
    customProvinceName: nextCustomProvince,
    customCityName: resolvedCity && !allCities.includes(resolvedCity) ? resolvedCity : "",
    industry: normalizeIndustry(initialIndustry),
  };
}

export default function MerchantProfileDialog({
  open,
  siteId,
  siteBaseDomain,
  initialServiceExpiresAt,
  initialDomainPrefix,
  takenDomainPrefixes,
  initialMerchantName,
  initialContactAddress,
  initialContactName,
  initialContactPhone,
  initialContactEmail,
  initialLocation,
  initialIndustry,
  onClose,
  onSave,
}: MerchantProfileDialogProps) {
  const countryOptions = useMemo(() => getEuropeCountryOptions(), []);
  const initialState = useMemo(
    () =>
      buildInitialState(
        countryOptions,
        initialMerchantName,
        initialDomainPrefix,
        initialContactAddress,
        initialContactName,
        initialContactPhone,
        initialContactEmail,
        initialLocation,
        initialIndustry,
      ),
    [
      countryOptions,
      initialMerchantName,
      initialDomainPrefix,
      initialContactAddress,
      initialContactName,
      initialContactPhone,
      initialContactEmail,
      initialLocation,
      initialIndustry,
    ],
  );
  const [merchantName, setMerchantName] = useState(initialState.merchantName);
  const [domainPrefixInput, setDomainPrefixInput] = useState(initialState.domainPrefix);
  const [domainPrefixConfirmed, setDomainPrefixConfirmed] = useState(initialState.domainPrefix);
  const [domainPrefixMessage, setDomainPrefixMessage] = useState<string>("");
  const [domainPrefixError, setDomainPrefixError] = useState<string>("");
  const [contactAddress, setContactAddress] = useState(initialState.contactAddress);
  const [contactName, setContactName] = useState(initialState.contactName);
  const [contactPhone, setContactPhone] = useState(initialState.contactPhone);
  const [contactEmail, setContactEmail] = useState(initialState.contactEmail);
  const [countryCode, setCountryCode] = useState(initialState.countryCode);
  const [provinceCode, setProvinceCode] = useState(initialState.provinceCode);
  const [city, setCity] = useState(initialState.city);
  const [countryInput, setCountryInput] = useState(initialState.countryInput);
  const [provinceInput, setProvinceInput] = useState(initialState.provinceInput);
  const [cityInput, setCityInput] = useState(initialState.cityInput);
  const [countryOpen, setCountryOpen] = useState(false);
  const [provinceOpen, setProvinceOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [customProvinceName, setCustomProvinceName] = useState(initialState.customProvinceName);
  const [customCityName, setCustomCityName] = useState(initialState.customCityName);
  const [industry, setIndustry] = useState<MerchantIndustry>(initialState.industry);
  const [domainSubmitCooldownLeftSec, setDomainSubmitCooldownLeftSec] = useState(0);
  const normalizedTakenPrefixes = useMemo(
    () =>
      new Set(
        (takenDomainPrefixes ?? [])
          .map((item) => String(item ?? "").trim().toLowerCase().replace(/^\/+|\/+$/g, ""))
          .filter(Boolean),
      ),
    [takenDomainPrefixes],
  );
  const normalizedBaseDomain = useMemo(() => {
    const raw = String(siteBaseDomain ?? "").trim();
    if (!raw) return "";
    const withoutProtocol = raw.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
    const hostOnly = withoutProtocol.split("/")[0] ?? "";
    return hostOnly.trim();
  }, [siteBaseDomain]);
  const merchantRootHost = useMemo(
    () => resolveMerchantRootHost(normalizedBaseDomain) || normalizedBaseDomain,
    [normalizedBaseDomain],
  );
  const domainPreview = useMemo(() => {
    if (!merchantRootHost) return "";
    if (!domainPrefixConfirmed) return merchantRootHost;
    return buildMerchantDomain(merchantRootHost, domainPrefixConfirmed)?.replace(/^https?:\/\//i, "") ?? merchantRootHost;
  }, [merchantRootHost, domainPrefixConfirmed]);

  function normalizeDomainPrefix(value: string) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^\/+|\/+$/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "");
  }

  const computeDomainSubmitCooldownLeftSec = useCallback(() => {
    const lastSubmitAt = readDomainSuffixLastSubmitAt(siteId);
    if (!lastSubmitAt) return 0;
    const remainMs = DOMAIN_SUFFIX_SUBMIT_COOLDOWN_MS - (Date.now() - lastSubmitAt);
    return remainMs > 0 ? Math.ceil(remainMs / 1000) : 0;
  }, [siteId]);

  useEffect(() => {
    if (!open) return;
    const sync = () => {
      setDomainSubmitCooldownLeftSec(computeDomainSubmitCooldownLeftSec());
    };
    sync();
    const timer = window.setInterval(sync, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [computeDomainSubmitCooldownLeftSec, open]);

  function submitDomainPrefix() {
    if (domainSubmitCooldownLeftSec > 0) {
      setDomainPrefixError(`域名前缀提交后需等待 1 分钟，剩余 ${domainSubmitCooldownLeftSec} 秒`);
      setDomainPrefixMessage("");
      return;
    }
    const normalized = normalizeDomainPrefix(domainPrefixInput);
    if (!normalized) {
      setDomainPrefixError("请输入有效前缀（仅支持字母、数字、-、_）");
      setDomainPrefixMessage("");
      setDomainPrefixConfirmed("");
      return;
    }
    if (/^\d{8}$/.test(normalized)) {
      setDomainPrefixError("前缀不能使用 8 位纯数字（该格式保留给后台地址）");
      setDomainPrefixMessage("");
      setDomainPrefixConfirmed("");
      return;
    }
    if (normalizedTakenPrefixes.has(normalized)) {
      setDomainPrefixError("该前缀已被使用，请更换后重新提交");
      setDomainPrefixMessage("");
      setDomainPrefixConfirmed("");
      return;
    }
    setDomainPrefixInput(normalized);
    setDomainPrefixConfirmed(normalized);
    setDomainPrefixError("");
    setDomainPrefixMessage("前缀可用，地址已更新");
    const now = Date.now();
    writeDomainSuffixLastSubmitAt(siteId, now);
    setDomainSubmitCooldownLeftSec(Math.ceil(DOMAIN_SUFFIX_SUBMIT_COOLDOWN_MS / 1000));
  }

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
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[21000] bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border bg-white p-4 shadow-xl space-y-4"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-semibold">商户信息</h2>
          <div className="mt-1 text-xs text-slate-500">
            {domainPreview || "请先填写并提交域名前缀。"}
          </div>
          <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="text-slate-500">到期时间：</span>
            <span>{formatServiceExpiresAt(initialServiceExpiresAt)}</span>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs text-slate-600">商户名称</div>
          <input
            value={merchantName}
            placeholder="请输入商户名称"
            onChange={(event) => setMerchantName(event.target.value)}
            className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div>
          <div className="mb-1 text-xs text-slate-600">域名前缀</div>
          <div className="flex items-center gap-2">
            <input
              value={domainPrefixInput}
              placeholder="例如 merchant-a"
              onChange={(event) => {
                setDomainPrefixInput(event.target.value);
                const normalized = normalizeDomainPrefix(event.target.value);
                if (normalized !== domainPrefixConfirmed) {
                  setDomainPrefixMessage("");
                  setDomainPrefixError("");
                }
              }}
              className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              className="shrink-0 rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={submitDomainPrefix}
              disabled={domainSubmitCooldownLeftSec > 0}
            >
              {domainSubmitCooldownLeftSec > 0 ? `提交前缀 (${domainSubmitCooldownLeftSec}s)` : "提交前缀"}
            </button>
          </div>
          {merchantRootHost ? (
            <div className="mt-1 text-xs text-slate-500">{`主域名：${merchantRootHost}`}</div>
          ) : null}
          {domainPrefixError ? <div className="mt-1 text-xs text-rose-600">{domainPrefixError}</div> : null}
          {domainPrefixMessage ? <div className="mt-1 text-xs text-emerald-600">{domainPrefixMessage}</div> : null}
        </div>

        <div>
          <div className="mb-1 text-xs text-slate-600">行业</div>
          <select
            className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            value={industry}
            onChange={(event) => setIndustry(normalizeIndustry(event.target.value))}
          >
            <option value="">请选择行业</option>
            {MERCHANT_INDUSTRY_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="relative">
            <div className="mb-1 text-xs text-slate-600">国家</div>
            <input
              value={countryInput}
              placeholder="输入国家"
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
                }
              }}
              onFocus={() => setCountryOpen(true)}
              onBlur={() => window.setTimeout(() => setCountryOpen(false), 120)}
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
                if (countryFilteredOptions[0]) selectCountryCode(countryFilteredOptions[0].value);
              }}
              className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
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

          <div className="relative">
            <div className="mb-1 text-xs text-slate-600">省份</div>
            <input
              value={provinceInput}
              placeholder="输入省份"
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
                }
              }}
              onFocus={() => setProvinceOpen(true)}
              onBlur={() => window.setTimeout(() => setProvinceOpen(false), 120)}
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
              className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
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

          <div className="relative">
            <div className="mb-1 text-xs text-slate-600">城市</div>
            <input
              value={cityInput}
              placeholder="输入城市"
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
              className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
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

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-600">地址</div>
            <input
              value={contactAddress}
              placeholder="请输入地址"
              onChange={(event) => setContactAddress(event.target.value)}
              className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-600">联系人</div>
            <input
              value={contactName}
              placeholder="请输入联系人"
              onChange={(event) => setContactName(event.target.value)}
              className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-600">电话</div>
            <input
              value={contactPhone}
              placeholder="请输入电话"
              onChange={(event) => setContactPhone(event.target.value)}
              className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-600">邮箱</div>
            <input
              value={contactEmail}
              placeholder="请输入邮箱"
              onChange={(event) => setContactEmail(event.target.value)}
              className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded bg-black px-3 py-2 text-sm text-white hover:opacity-90"
            onClick={() => {
              if (!domainPrefixConfirmed) {
                setDomainPrefixError("请先提交并通过前缀校验");
                setDomainPrefixMessage("");
                return;
              }
              const normalizedCountryCode = countryCode.trim().toUpperCase();
              const resolvedCountryName =
                selectedCountryName || countryInput.trim() || findEuropeCountryByCode(normalizedCountryCode)?.name || "";
              const resolvedProvinceName = (selectedProvinceName || provinceInput).trim();
              const resolvedCity = (cityInput || city).trim();
              const location: SiteLocation = normalizedCountryCode
                ? {
                    countryCode: normalizedCountryCode,
                    country: resolvedCountryName,
                    provinceCode: isCustomProvinceCode(provinceCode) ? "" : provinceCode.trim(),
                    province: resolvedProvinceName,
                    city: resolvedCity,
                  }
                : {
                    countryCode: "",
                    country: "",
                    provinceCode: "",
                    province: "",
                    city: "",
                  };
              onSave({
                merchantName: merchantName.trim(),
                domainPrefix: domainPrefixConfirmed,
                contactAddress: contactAddress.trim(),
                contactName: contactName.trim(),
                contactPhone: contactPhone.trim(),
                contactEmail: contactEmail.trim(),
                location,
                industry,
              });
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

