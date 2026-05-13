"use client";

import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  MERCHANT_INDUSTRY_OPTIONS,
  type MerchantIndustry,
  type SiteLocation,
} from "@/data/platformControlStore";
import { loadEuropeLocationOptionsApi, type EuropeLocationOptionsApi } from "@/lib/europeLocationOptionsLoader";
import { normalizeMerchantBusinessCards, type MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import {
  buildGoogleBusinessProfileOpenUrl,
  buildGoogleBusinessProfileReadiness,
  buildGoogleBusinessProfileSearchUrl,
  buildGoogleBusinessProfileWebsiteUrl,
  buildGoogleBusinessProfileWorksheet,
} from "@/lib/googleBusinessProfileAssistant";
import { getMerchantSeoReadiness, type MerchantSeoProfile } from "@/lib/merchantSeo";
import {
  getMerchantProfileContactNameError,
  getMerchantProfileDomainPrefixError,
  getMerchantProfileMerchantNameError,
  getUtf8ByteLength,
  MERCHANT_PROFILE_CONTACT_NAME_MAX_BYTES,
  MERCHANT_PROFILE_DOMAIN_PREFIX_MAX_BYTES,
  MERCHANT_PROFILE_MERCHANT_NAME_MAX_BYTES,
  normalizeMerchantProfileDomainPrefixInput,
  truncateUtf8ByBytes,
} from "@/lib/merchantProfileBinding";
import { buildMerchantDomain, resolveMerchantRootHost } from "@/lib/siteRouting";

type MerchantProfileDialogProps = {
  open: boolean;
  mode?: "dialog" | "inline";
  showCloseButton?: boolean;
  showBusinessCardManager?: boolean;
  className?: string;
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
  initialBusinessCards?: MerchantBusinessCardAsset[] | null;
  businessCardLimit?: number;
  allowBusinessCardLinkMode?: boolean;
  businessCardBackgroundImageLimitKb?: number;
  businessCardContactImageLimitKb?: number;
  businessCardExportImageLimitKb?: number;
  onClose: () => void;
  onCardsChange?: (cards: MerchantBusinessCardAsset[]) => void;
  onSave: (input: {
    merchantName: string;
    domainPrefix: string;
    contactAddress: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    location: SiteLocation;
    industry: MerchantIndustry;
  }) => void | Promise<void>;
};

type EuropeCountryOptions = ReturnType<EuropeLocationOptionsApi["getEuropeCountryOptions"]>;
type EuropeProvinceOptions = ReturnType<EuropeLocationOptionsApi["getEuropeProvinceOptions"]>;

type SearchOption = {
  value: string;
  label: string;
};

const CUSTOM_PROVINCE_PREFIX = "__custom_province__:";
const TYPEAHEAD_LIMIT = 30;
const DOMAIN_SUFFIX_SUBMIT_COOLDOWN_MS = 60 * 1000;
const EMPTY_COUNTRY_OPTIONS: EuropeCountryOptions = [];
const EMPTY_PROVINCE_OPTIONS: EuropeProvinceOptions = [];
const EMPTY_CITY_OPTIONS: string[] = [];

const MerchantBusinessCardManager = dynamic(() => import("@/components/admin/MerchantBusinessCardManager"), {
  ssr: false,
  loading: () => (
    <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
      名片工具加载中...
    </div>
  ),
});

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

function renderDialogOverlay(children: ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
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
  initialMerchantName?: string | null,
  initialDomainPrefix?: string | null,
  initialContactAddress?: string | null,
  initialContactName?: string | null,
  initialContactPhone?: string | null,
  initialContactEmail?: string | null,
  initialLocation?: Partial<SiteLocation> | null,
  initialIndustry?: string | null,
): MerchantProfileInitialState {
  const nextCountryCode = (initialLocation?.countryCode ?? "").trim().toUpperCase();
  const nextCountryName = (initialLocation?.country ?? "").trim();
  const initialProvinceCode = (initialLocation?.provinceCode ?? "").trim();
  const initialProvinceName = (initialLocation?.province ?? "").trim();
  let nextProvinceCode = initialProvinceCode;
  let nextCustomProvince = "";
  if (isCustomProvinceCode(nextProvinceCode)) {
    nextCustomProvince = initialProvinceName || nextProvinceCode.slice(CUSTOM_PROVINCE_PREFIX.length);
  } else if (!nextProvinceCode && initialProvinceName) {
    nextProvinceCode = `${CUSTOM_PROVINCE_PREFIX}${initialProvinceName}`;
    nextCustomProvince = initialProvinceName;
  }

  const initialCityName = (initialLocation?.city ?? "").trim();

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
    provinceInput: initialProvinceName,
    city: initialCityName,
    cityInput: initialCityName,
    customProvinceName: nextCustomProvince,
    customCityName: "",
    industry: normalizeIndustry(initialIndustry),
  };
}

export default function MerchantProfileDialog({
  open,
  mode = "dialog",
  showCloseButton,
  showBusinessCardManager = true,
  className,
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
  initialBusinessCards,
  businessCardLimit = 1,
  allowBusinessCardLinkMode = true,
  businessCardBackgroundImageLimitKb = 200,
  businessCardContactImageLimitKb = 200,
  businessCardExportImageLimitKb = 400,
  onClose,
  onCardsChange,
  onSave,
}: MerchantProfileDialogProps) {
  const [locationOptionsApi, setLocationOptionsApi] = useState<EuropeLocationOptionsApi | null>(null);
  const locationOptionsApiTaskRef = useRef<Promise<EuropeLocationOptionsApi> | null>(null);
  const mountedRef = useRef(false);
  const isInline = mode === "inline";
  const resolvedShowCloseButton = showCloseButton ?? !isInline;
  const initialState = useMemo(
    () =>
      buildInitialState(
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
  const [businessCards, setBusinessCards] = useState<MerchantBusinessCardAsset[]>(() => normalizeMerchantBusinessCards(initialBusinessCards ?? []));
  const [domainSubmitCooldownLeftSec, setDomainSubmitCooldownLeftSec] = useState(0);
  const [domainPrefixPending, setDomainPrefixPending] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [googleBusinessProfileCopyMessage, setGoogleBusinessProfileCopyMessage] = useState("");
  const [googleSeoPanelOpen, setGoogleSeoPanelOpen] = useState(false);
  const [googleBusinessProfilePanelOpen, setGoogleBusinessProfilePanelOpen] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ensureLocationOptionsLoaded = useCallback(() => {
    if (locationOptionsApi) return Promise.resolve(locationOptionsApi);
    if (!locationOptionsApiTaskRef.current) {
      locationOptionsApiTaskRef.current = loadEuropeLocationOptionsApi()
        .then((api) => {
          if (mountedRef.current) setLocationOptionsApi(api);
          return api;
        })
        .finally(() => {
          locationOptionsApiTaskRef.current = null;
        });
    }
    return locationOptionsApiTaskRef.current;
  }, [locationOptionsApi]);

  const countryOptions = useMemo(
    () => locationOptionsApi?.getEuropeCountryOptions() ?? EMPTY_COUNTRY_OPTIONS,
    [locationOptionsApi],
  );
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

  useEffect(() => {
    if (!open) {
      setSavePending(false);
      setDomainPrefixPending(false);
      setSaveError("");
    }
  }, [open]);

  async function submitDomainPrefix() {
    if (domainPrefixPending) return;
    if (domainSubmitCooldownLeftSec > 0) {
      setDomainPrefixError(`域名前缀提交后需等待 1 分钟，剩余 ${domainSubmitCooldownLeftSec} 秒`);
      setDomainPrefixMessage("");
      return;
    }
    const normalized = normalizeMerchantProfileDomainPrefixInput(domainPrefixInput);
    const prefixError = getMerchantProfileDomainPrefixError(normalized);
    if (prefixError) {
      setDomainPrefixInput(normalized);
      setDomainPrefixError(prefixError);
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
    setDomainPrefixPending(true);
    try {
      const response = await fetch(`/api/site-resolve?prefix=${encodeURIComponent(normalized)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = (await response.json().catch(() => null)) as { siteId?: unknown } | null;
      if (response.ok) {
        const currentSiteId = String(siteId ?? "").trim();
        const resolvedSiteId = String(data?.siteId ?? "").trim();
        if (!resolvedSiteId || (currentSiteId && resolvedSiteId === currentSiteId)) {
          setDomainPrefixInput(normalized);
          setDomainPrefixConfirmed(normalized);
          setDomainPrefixError("");
          setDomainPrefixMessage("前缀可用，地址已更新");
          const now = Date.now();
          writeDomainSuffixLastSubmitAt(siteId, now);
          setDomainSubmitCooldownLeftSec(Math.ceil(DOMAIN_SUFFIX_SUBMIT_COOLDOWN_MS / 1000));
          return;
        }
        setDomainPrefixError("该前缀已被使用，请更换后重新提交");
        setDomainPrefixMessage("");
        setDomainPrefixConfirmed("");
        return;
      }
      if (response.status === 404) {
        setDomainPrefixInput(normalized);
        setDomainPrefixConfirmed(normalized);
        setDomainPrefixError("");
        setDomainPrefixMessage("前缀可用，地址已更新");
        const now = Date.now();
        writeDomainSuffixLastSubmitAt(siteId, now);
        setDomainSubmitCooldownLeftSec(Math.ceil(DOMAIN_SUFFIX_SUBMIT_COOLDOWN_MS / 1000));
        return;
      }
      setDomainPrefixError("暂时无法校验前缀，请稍后重试");
      setDomainPrefixMessage("");
      setDomainPrefixConfirmed("");
    } catch {
      setDomainPrefixError("暂时无法校验前缀，请稍后重试");
      setDomainPrefixMessage("");
      setDomainPrefixConfirmed("");
    } finally {
      setDomainPrefixPending(false);
    }
  }

  const provinceOptions = useMemo(
    () => locationOptionsApi?.getEuropeProvinceOptions(countryCode) ?? EMPTY_PROVINCE_OPTIONS,
    [countryCode, locationOptionsApi],
  );
  const cityOptions = useMemo(
    () =>
      locationOptionsApi && !isCustomProvinceCode(provinceCode)
        ? locationOptionsApi.getEuropeCityOptions(countryCode, provinceCode)
        : EMPTY_CITY_OPTIONS,
    [countryCode, locationOptionsApi, provinceCode],
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

  useEffect(() => {
    if (!locationOptionsApi) return;
    const normalizedCountryCode = countryCode.trim().toUpperCase();
    if (normalizedCountryCode && !countryInput.trim()) {
      const country = locationOptionsApi.findEuropeCountryByCode(normalizedCountryCode);
      if (country?.name) setCountryInput(country.name);
    }
    if (normalizedCountryCode && provinceCode && !isCustomProvinceCode(provinceCode) && !provinceInput.trim()) {
      const province = locationOptionsApi
        .getEuropeProvinceOptions(normalizedCountryCode)
        .find((item) => item.code === provinceCode);
      if (province?.name) setProvinceInput(province.name);
    }
    if (city && !cityInput.trim()) {
      setCityInput(city);
    }
  }, [city, cityInput, countryCode, countryInput, locationOptionsApi, provinceCode, provinceInput]);

  const merchantNameBytes = useMemo(() => getUtf8ByteLength(merchantName.trim()), [merchantName]);
  const merchantNameError = useMemo(() => getMerchantProfileMerchantNameError(merchantName), [merchantName]);
  const domainPrefixBytes = useMemo(() => getUtf8ByteLength(domainPrefixInput.trim().toLowerCase()), [domainPrefixInput]);
  const contactNameBytes = useMemo(() => getUtf8ByteLength(contactName.trim()), [contactName]);
  const contactNameError = useMemo(() => getMerchantProfileContactNameError(contactName), [contactName]);
  const liveProfile = useMemo(
    () => ({
      merchantName: merchantName.trim(),
      domainPrefix: domainPrefixConfirmed || domainPrefixInput.trim(),
      contactAddress: contactAddress.trim(),
      contactName: contactName.trim(),
      contactPhone: contactPhone.trim(),
      contactEmail: contactEmail.trim(),
      industry,
      location: {
        country: selectedCountryName || countryInput.trim(),
        province: (selectedProvinceName || provinceInput).trim(),
        city: (cityInput || city).trim(),
      },
    }),
    [
      city,
      cityInput,
      contactAddress,
      contactEmail,
      contactName,
      contactPhone,
      countryInput,
      domainPrefixConfirmed,
      domainPrefixInput,
      industry,
      merchantName,
      provinceInput,
      selectedCountryName,
      selectedProvinceName,
    ],
  );
  const merchantSeoProfile = useMemo<MerchantSeoProfile>(
    () => ({
      id: siteId ?? "",
      merchantName: merchantName.trim(),
      name: merchantName.trim(),
      domainPrefix: domainPrefixConfirmed || domainPrefixInput.trim(),
      contactAddress: contactAddress.trim(),
      contactName: contactName.trim(),
      contactPhone: contactPhone.trim(),
      contactEmail: contactEmail.trim(),
      industry,
      location: {
        countryCode: countryCode.trim().toUpperCase(),
        country: selectedCountryName || countryInput.trim(),
        provinceCode: isCustomProvinceCode(provinceCode) ? "" : provinceCode.trim(),
        province: (selectedProvinceName || provinceInput).trim(),
        city: (cityInput || city).trim(),
      },
    }),
    [
      city,
      cityInput,
      contactAddress,
      contactEmail,
      contactName,
      contactPhone,
      countryCode,
      countryInput,
      domainPrefixConfirmed,
      domainPrefixInput,
      industry,
      merchantName,
      provinceCode,
      provinceInput,
      selectedCountryName,
      selectedProvinceName,
      siteId,
    ],
  );
  const merchantSeoReadiness = useMemo(() => getMerchantSeoReadiness(merchantSeoProfile), [merchantSeoProfile]);
  const googleBusinessProfileWebsiteUrl = useMemo(
    () => buildGoogleBusinessProfileWebsiteUrl(merchantSeoProfile, siteBaseDomain),
    [merchantSeoProfile, siteBaseDomain],
  );
  const googleBusinessProfileReadiness = useMemo(
    () => buildGoogleBusinessProfileReadiness(merchantSeoProfile, googleBusinessProfileWebsiteUrl),
    [googleBusinessProfileWebsiteUrl, merchantSeoProfile],
  );
  const googleBusinessProfileWorksheet = useMemo(
    () => buildGoogleBusinessProfileWorksheet(merchantSeoProfile, siteBaseDomain),
    [merchantSeoProfile, siteBaseDomain],
  );
  const googleBusinessProfileSearchUrl = useMemo(
    () => buildGoogleBusinessProfileSearchUrl(merchantSeoProfile),
    [merchantSeoProfile],
  );
  const googleBusinessProfileOpenUrl = useMemo(() => buildGoogleBusinessProfileOpenUrl(), []);

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
    if (!open || isInline) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [isInline, onClose, open]);

  useEffect(() => {
    if (!googleBusinessProfileCopyMessage) return;
    const timer = window.setTimeout(() => setGoogleBusinessProfileCopyMessage(""), 2600);
    return () => window.clearTimeout(timer);
  }, [googleBusinessProfileCopyMessage]);

  const copyGoogleBusinessProfileWorksheet = useCallback(async () => {
    const text = googleBusinessProfileWorksheet.trim();
    if (!text) {
      setGoogleBusinessProfileCopyMessage("暂无可复制资料");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setGoogleBusinessProfileCopyMessage("资料已复制");
    } catch {
      setGoogleBusinessProfileCopyMessage("复制失败，请手动复制");
    }
  }, [googleBusinessProfileWorksheet]);

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

  const content = (
    <div
      className={`w-full space-y-4 rounded-xl border bg-white p-4 shadow-xl ${
        isInline ? "max-w-none shadow-sm" : "my-4 max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto"
      }${className ? ` ${className}` : ""}`}
      onMouseDown={isInline ? undefined : (event) => event.stopPropagation()}
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
          <div
            className={`mt-2 overflow-hidden rounded-lg border text-sm ${
              merchantSeoReadiness.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
              aria-expanded={googleSeoPanelOpen}
              onClick={() => setGoogleSeoPanelOpen((current) => !current)}
            >
              <div>
                <div className="font-semibold text-slate-900">Google 搜索优化</div>
                {googleSeoPanelOpen ? (
                  <div className="mt-1 text-xs text-slate-600">资料完整并发布后，会自动生成 Google 可读取的页面信息。</div>
                ) : null}
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    merchantSeoReadiness.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {merchantSeoReadiness.ready
                    ? "已满足"
                    : `${merchantSeoReadiness.requiredCompleteCount}/${merchantSeoReadiness.requiredTotal}`}
                </span>
                <span className="text-xs font-semibold text-slate-500">{googleSeoPanelOpen ? "收起" : "展开"}</span>
              </span>
            </button>
            {googleSeoPanelOpen ? (
              <div className="grid gap-2 border-t border-white/70 px-3 py-3 sm:grid-cols-2">
                {merchantSeoReadiness.required.map((item) => (
                  <div
                    key={item.key}
                    className={`flex items-center gap-2 text-xs ${item.complete ? "text-emerald-700" : "text-slate-600"}`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                        item.complete ? "bg-emerald-100 text-emerald-700" : "bg-white text-amber-700"
                      }`}
                    >
                      {item.complete ? "✓" : "!"}
                    </span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div
            className={`mt-2 overflow-hidden rounded-lg border text-sm ${
              googleBusinessProfileReadiness.ready ? "border-sky-200 bg-sky-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
              aria-expanded={googleBusinessProfilePanelOpen}
              onClick={() => setGoogleBusinessProfilePanelOpen((current) => !current)}
            >
              <div>
                <div className="font-semibold text-slate-900">Google 商家资料验证助手</div>
                {googleBusinessProfilePanelOpen ? (
                  <div className="mt-1 text-xs text-slate-600">
                    先自动整理创建 Google Business Profile 所需资料，API 权限开通后这里会继续接发起验证。
                  </div>
                ) : null}
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    googleBusinessProfileReadiness.ready ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {googleBusinessProfileReadiness.ready
                    ? "资料齐全"
                    : `${googleBusinessProfileReadiness.requiredCompleteCount}/${googleBusinessProfileReadiness.requiredTotal}`}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {googleBusinessProfilePanelOpen ? "收起" : "展开"}
                </span>
              </span>
            </button>
            {googleBusinessProfilePanelOpen ? (
              <div className="border-t border-white/70 px-3 py-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {googleBusinessProfileReadiness.required.map((item) => (
                    <div
                      key={item.key}
                      className={`flex items-center gap-2 text-xs ${item.complete ? "text-sky-700" : "text-slate-600"}`}
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                          item.complete ? "bg-sky-100 text-sky-700" : "bg-white text-amber-700"
                        }`}
                      >
                        {item.complete ? "✓" : "!"}
                      </span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded border border-white/70 bg-white/70 px-2 py-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">商户网站：</span>
                  <span className="break-all">{googleBusinessProfileWebsiteUrl}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    onClick={() => {
                      void copyGoogleBusinessProfileWorksheet();
                    }}
                  >
                    复制商户资料
                  </button>
                  <a
                    href={googleBusinessProfileOpenUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                  >
                    打开 Google 商家资料
                  </a>
                  <a
                    href={googleBusinessProfileSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    搜索现有档案
                  </a>
                  {googleBusinessProfileCopyMessage ? (
                    <span className="text-xs text-sky-700">{googleBusinessProfileCopyMessage}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs text-slate-600">商户名称</div>
          <input
            value={merchantName}
            placeholder="请输入商户名称"
            onChange={(event) =>
              setMerchantName(truncateUtf8ByBytes(event.target.value, MERCHANT_PROFILE_MERCHANT_NAME_MAX_BYTES))
            }
            className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          />
          <div className="mt-1 flex items-center justify-between gap-3 text-xs">
            <span className={merchantNameError ? "text-rose-600" : "text-slate-500"}>
              {merchantNameError || `最多 ${MERCHANT_PROFILE_MERCHANT_NAME_MAX_BYTES} 字节`}
            </span>
            <span className={merchantNameError ? "text-rose-600" : "text-slate-400"}>
              {merchantNameBytes}/{MERCHANT_PROFILE_MERCHANT_NAME_MAX_BYTES}
            </span>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs text-slate-600">域名前缀</div>
          <div className="flex items-center gap-2">
            <input
              value={domainPrefixInput}
              placeholder="例如 merchant01"
              onChange={(event) => {
                const normalized = normalizeMerchantProfileDomainPrefixInput(event.target.value);
                setDomainPrefixInput(normalized);
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
              onClick={() => {
                void submitDomainPrefix();
              }}
              disabled={domainSubmitCooldownLeftSec > 0 || domainPrefixPending}
            >
              {domainPrefixPending ? "检查中..." : domainSubmitCooldownLeftSec > 0 ? `提交前缀 (${domainSubmitCooldownLeftSec}s)` : "提交前缀"}
            </button>
          </div>
          {merchantRootHost ? (
            <div className="mt-1 text-xs text-slate-500">{`主域名：${merchantRootHost}`}</div>
          ) : null}
          <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>{`仅支持字母和数字，最多 ${MERCHANT_PROFILE_DOMAIN_PREFIX_MAX_BYTES} 字节`}</span>
            <span>{domainPrefixBytes}/{MERCHANT_PROFILE_DOMAIN_PREFIX_MAX_BYTES}</span>
          </div>
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
                void ensureLocationOptionsLoaded();
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
              onFocus={() => {
                setCountryOpen(true);
                void ensureLocationOptionsLoaded();
              }}
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
                void ensureLocationOptionsLoaded();
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
              onFocus={() => {
                setProvinceOpen(true);
                void ensureLocationOptionsLoaded();
              }}
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
                void ensureLocationOptionsLoaded();
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
              onFocus={() => {
                setCityOpen(true);
                void ensureLocationOptionsLoaded();
              }}
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
              onChange={(event) =>
                setContactName(truncateUtf8ByBytes(event.target.value, MERCHANT_PROFILE_CONTACT_NAME_MAX_BYTES))
              }
              className="w-full rounded border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <div className="mt-1 flex items-center justify-between gap-3 text-xs">
              <span className={contactNameError ? "text-rose-600" : "text-slate-500"}>
                {contactNameError || `最多 ${MERCHANT_PROFILE_CONTACT_NAME_MAX_BYTES} 字节`}
              </span>
              <span className={contactNameError ? "text-rose-600" : "text-slate-400"}>
                {contactNameBytes}/{MERCHANT_PROFILE_CONTACT_NAME_MAX_BYTES}
              </span>
            </div>
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

        {showBusinessCardManager ? (
          <MerchantBusinessCardManager
            merchantId={siteId}
            siteBaseDomain={siteBaseDomain}
            profile={liveProfile}
            cards={businessCards}
            cardLimit={businessCardLimit}
            allowLinkMode={allowBusinessCardLinkMode}
            backgroundImageLimitKb={businessCardBackgroundImageLimitKb}
            contactPageImageLimitKb={businessCardContactImageLimitKb}
            exportImageLimitKb={businessCardExportImageLimitKb}
            onCardsChange={(cards) => {
              setBusinessCards(cards);
              onCardsChange?.(cards);
            }}
          />
        ) : null}

        <div className="flex justify-end gap-2">
          {saveError ? <div className="mr-auto self-center text-sm text-rose-600">{saveError}</div> : null}
          {resolvedShowCloseButton ? (
            <button
              type="button"
              className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onClose}
              disabled={savePending}
            >
              取消
            </button>
          ) : null}
          <button
            type="button"
            className="rounded bg-black px-3 py-2 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={async () => {
              if (savePending) return;
              setSaveError("");
              if (merchantNameError || contactNameError) {
                return;
              }
              if (!domainPrefixConfirmed) {
                setDomainPrefixError("请先提交并通过前缀校验");
                setDomainPrefixMessage("");
                return;
              }
              const confirmedDomainPrefixError = getMerchantProfileDomainPrefixError(domainPrefixConfirmed);
              if (confirmedDomainPrefixError) {
                setDomainPrefixError(confirmedDomainPrefixError);
                setDomainPrefixMessage("");
                return;
              }
              const normalizedCountryCode = countryCode.trim().toUpperCase();
              let locationApi = locationOptionsApi;
              if (normalizedCountryCode) {
                try {
                  locationApi = await ensureLocationOptionsLoaded();
                } catch {
                  locationApi = null;
                }
              }
              const resolvedCountryName =
                selectedCountryName || countryInput.trim() || locationApi?.findEuropeCountryByCode(normalizedCountryCode)?.name || "";
              let resolvedProvinceCode = isCustomProvinceCode(provinceCode) ? "" : provinceCode.trim();
              let resolvedProvinceName = (selectedProvinceName || provinceInput).trim();
              let resolvedCity = (cityInput || city).trim();
              if (locationApi && normalizedCountryCode) {
                if (!resolvedProvinceCode && (resolvedProvinceName || resolvedCity)) {
                  const best = locationApi.findBestProvinceAndCity(
                    normalizedCountryCode,
                    resolvedProvinceName,
                    resolvedCity,
                  );
                  resolvedProvinceCode = best.provinceCode;
                  if (best.cityName) resolvedCity = best.cityName;
                }
                if (resolvedProvinceCode) {
                  const matchedProvince = locationApi
                    .getEuropeProvinceOptions(normalizedCountryCode)
                    .find((item) => item.code === resolvedProvinceCode);
                  resolvedProvinceName = resolvedProvinceName || matchedProvince?.name || "";
                  const matchedCity = locationApi.findBestCityName(normalizedCountryCode, resolvedProvinceCode, resolvedCity);
                  if (matchedCity) resolvedCity = matchedCity;
                }
              }
              const location: SiteLocation = normalizedCountryCode
                ? {
                    countryCode: normalizedCountryCode,
                    country: resolvedCountryName,
                    provinceCode: resolvedProvinceCode,
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
              setSavePending(true);
              try {
                await Promise.resolve(
                  onSave({
                    merchantName: merchantName.trim(),
                    domainPrefix: domainPrefixConfirmed,
                    contactAddress: contactAddress.trim(),
                    contactName: contactName.trim(),
                    contactPhone: contactPhone.trim(),
                    contactEmail: contactEmail.trim(),
                    location,
                    industry,
                  }),
                );
              } catch (error) {
                setSaveError(error instanceof Error ? error.message : "保存失败，请稍后重试");
              } finally {
                setSavePending(false);
              }
            }}
            disabled={savePending || Boolean(merchantNameError) || Boolean(contactNameError)}
          >
            {savePending ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
  );

  if (isInline) return content;

  return renderDialogOverlay(
    <div
      className="fixed inset-0 z-[2147482500] flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onMouseDown={onClose}
    >
      {content}
    </div>,
  );
}

