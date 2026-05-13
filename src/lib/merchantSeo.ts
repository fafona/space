import type { MetadataRoute } from "next";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import type { MerchantContactVisibility, SiteLocation } from "@/data/platformControlStore";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import { buildMerchantFrontendHref } from "@/lib/siteRouting";

type JsonRecord = Record<string, unknown>;

export type MerchantSeoOpeningHoursInput = {
  dayOfWeek?: string | string[] | null;
  opens?: string | null;
  closes?: string | null;
  validFrom?: string | null;
  validThrough?: string | null;
};

export type MerchantSeoProfile = {
  id?: string | null;
  merchantName?: string | null;
  name?: string | null;
  domain?: string | null;
  domainPrefix?: string | null;
  domainSuffix?: string | null;
  signature?: string | null;
  category?: string | null;
  industry?: string | null;
  location?: Partial<SiteLocation> | null;
  contactAddress?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  geo?: {
    latitude?: string | number | null;
    longitude?: string | number | null;
  } | null;
  openingHoursSpecification?: MerchantSeoOpeningHoursInput | MerchantSeoOpeningHoursInput[] | null;
  businessHours?: MerchantSeoOpeningHoursInput | MerchantSeoOpeningHoursInput[] | null;
  priceRange?: string | null;
  sameAs?: string[] | null;
  merchantCardImageUrl?: string | null;
  chatAvatarImageUrl?: string | null;
  contactVisibility?: Partial<MerchantContactVisibility> | null;
  status?: string | null;
  serviceExpiresAt?: string | null;
  businessCards?: Array<{
    imageUrl?: string | null;
    shareImageUrl?: string | null;
    contactPagePublicImageUrl?: string | null;
  }> | null;
};

export type MerchantSeoReadinessItem = {
  key: string;
  label: string;
  complete: boolean;
};

export type MerchantSeoReadiness = {
  required: MerchantSeoReadinessItem[];
  recommended: MerchantSeoReadinessItem[];
  requiredCompleteCount: number;
  requiredTotal: number;
  recommendedCompleteCount: number;
  recommendedTotal: number;
  ready: boolean;
};

const DEFAULT_PUBLIC_ORIGIN = "https://www.faolla.com";

function trimText(value: unknown) {
  return String(value ?? "").trim();
}

function hasText(value: unknown) {
  return trimText(value).length > 0;
}

function normalizeOrigin(value: unknown) {
  const text = trimText(value);
  if (!text) return DEFAULT_PUBLIC_ORIGIN;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.origin.replace(/\/+$/g, "");
  } catch {
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

function isFutureDate(value: unknown, nowMs = Date.now()) {
  const text = trimText(value);
  if (!text) return true;
  const timestamp = new Date(text).getTime();
  return Number.isFinite(timestamp) ? timestamp > nowMs : true;
}

function merchantDisplayName(profile: MerchantSeoProfile) {
  return trimText(profile.merchantName) || trimText(profile.name) || trimText(profile.domain) || trimText(profile.id);
}

export function buildMerchantSeoCanonicalUrl(profile: MerchantSeoProfile, publicOrigin?: string | null) {
  const id = trimText(profile.id);
  const origin = normalizeOrigin(publicOrigin ?? process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
  const domainPrefix = trimText(profile.domainPrefix || profile.domainSuffix);
  if (id) {
    const href = buildMerchantFrontendHref(id, domainPrefix, origin);
    return /^https?:\/\//i.test(href) ? href : `${origin}${href.startsWith("/") ? href : `/${href}`}`;
  }
  const domain = trimText(profile.domain);
  const fallbackPrefix = domain.includes(".") ? domain.split(".")[0] : domain;
  return fallbackPrefix ? `${origin}/${encodeURIComponent(fallbackPrefix)}` : origin;
}

export function getMerchantSeoReadiness(profile: MerchantSeoProfile): MerchantSeoReadiness {
  const location = profile.location ?? {};
  const hasPublicPage = hasText(profile.id) || hasText(profile.domainPrefix) || hasText(profile.domainSuffix);
  const required: MerchantSeoReadinessItem[] = [
    { key: "merchantName", label: "商户名称", complete: hasText(merchantDisplayName(profile)) },
    { key: "industry", label: "行业分类", complete: hasText(profile.industry || profile.category) },
    { key: "country", label: "国家", complete: hasText(location.country || location.countryCode) },
    { key: "city", label: "城市", complete: hasText(location.city) },
    { key: "address", label: "详细地址", complete: hasText(profile.contactAddress) },
    { key: "phone", label: "联系电话", complete: hasText(profile.contactPhone) },
    { key: "publicPage", label: "公开页面", complete: hasPublicPage },
  ];
  const recommended: MerchantSeoReadinessItem[] = [
    { key: "province", label: "省份/地区", complete: hasText(location.province || location.provinceCode) },
    { key: "email", label: "联系邮箱", complete: hasText(profile.contactEmail) },
    { key: "image", label: "展示图片", complete: Boolean(resolveMerchantSeoImageUrl(profile)) },
    { key: "description", label: "商户简介", complete: hasText(profile.signature) },
  ];
  const requiredCompleteCount = required.filter((item) => item.complete).length;
  const recommendedCompleteCount = recommended.filter((item) => item.complete).length;
  return {
    required,
    recommended,
    requiredCompleteCount,
    requiredTotal: required.length,
    recommendedCompleteCount,
    recommendedTotal: recommended.length,
    ready: requiredCompleteCount === required.length,
  };
}

export function isMerchantSeoIndexable(profile: MerchantSeoProfile, nowMs = Date.now()) {
  const status = trimText(profile.status || "online");
  return status === "online" && isFutureDate(profile.serviceExpiresAt, nowMs) && getMerchantSeoReadiness(profile).ready;
}

export function buildMerchantSeoTitle(profile: MerchantSeoProfile) {
  const name = merchantDisplayName(profile) || "Faolla 商户";
  const city = trimText(profile.location?.city);
  const industry = trimText(profile.industry || profile.category);
  const suffix = [city, industry].filter(Boolean).join(" - ");
  return suffix ? `${name} - ${suffix}` : name;
}

export function buildMerchantSeoDescription(profile: MerchantSeoProfile) {
  const name = merchantDisplayName(profile) || "Faolla 商户";
  const industry = trimText(profile.industry || profile.category);
  const location = [profile.location?.country, profile.location?.province, profile.location?.city]
    .map(trimText)
    .filter(Boolean)
    .join(" / ");
  const signature = trimText(profile.signature);
  if (signature) return signature;
  const parts = [industry, location].filter(Boolean).join("，");
  return parts
    ? `${name}，${parts}。通过 Faolla 查看商户信息、联系方式和服务。`
    : `${name} 的 Faolla 商户页面。`;
}

export function resolveMerchantSeoImageUrl(profile: MerchantSeoProfile, publicOrigin?: string | null) {
  const direct =
    trimText(profile.merchantCardImageUrl) ||
    trimText(profile.chatAvatarImageUrl) ||
    trimText(profile.businessCards?.find((card) => trimText(card.shareImageUrl))?.shareImageUrl) ||
    trimText(profile.businessCards?.find((card) => trimText(card.contactPagePublicImageUrl))?.contactPagePublicImageUrl) ||
    trimText(profile.businessCards?.find((card) => trimText(card.imageUrl))?.imageUrl);
  return direct ? normalizePublicAssetUrl(direct, publicOrigin ?? undefined) : "";
}

function resolveMerchantLocalBusinessType(profile: MerchantSeoProfile) {
  const value = `${trimText(profile.industry)} ${trimText(profile.category)}`.toLowerCase();
  if (/餐|饭|饮|restaurant|cafe|coffee|food|bar|bakery/.test(value)) return "Restaurant";
  if (/零售|商店|店铺|retail|shop|store|market/.test(value)) return "Store";
  if (/娱乐|ktv|cinema|game|club|entertainment/.test(value)) return "EntertainmentBusiness";
  if (/服务|service|salon|spa|beauty|repair|consult/.test(value)) return "ProfessionalService";
  return "LocalBusiness";
}

function normalizeUrl(value: unknown) {
  const text = trimText(value);
  if (!/^https?:\/\//i.test(text)) return "";
  try {
    return new URL(text).toString();
  } catch {
    return "";
  }
}

function normalizeSameAs(value: unknown) {
  const urls = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return urls
    .map((item) => normalizeUrl(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizeGeoNumber(value: unknown, min: number, max: number) {
  const numberValue =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value ?? "").trim().replace(",", "."));
  if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) return null;
  return Number(numberValue.toFixed(6));
}

function resolveMerchantGeo(profile: MerchantSeoProfile) {
  const latitude = normalizeGeoNumber(profile.latitude ?? profile.geo?.latitude, -90, 90);
  const longitude = normalizeGeoNumber(profile.longitude ?? profile.geo?.longitude, -180, 180);
  if (latitude == null || longitude == null) return null;
  return {
    "@type": "GeoCoordinates",
    latitude,
    longitude,
  };
}

function buildMerchantMapUrl(profile: MerchantSeoProfile, geo: ReturnType<typeof resolveMerchantGeo>) {
  if (geo) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${geo.latitude},${geo.longitude}`)}`;
  }
  const location = profile.location ?? {};
  const query = [
    trimText(profile.contactAddress),
    trimText(location.city),
    trimText(location.province),
    trimText(location.countryCode || location.country),
  ]
    .filter(Boolean)
    .join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : "";
}

const DAY_OF_WEEK_ALIASES: Record<string, string> = {
  monday: "Monday",
  mon: "Monday",
  tuesday: "Tuesday",
  tue: "Tuesday",
  tues: "Tuesday",
  wednesday: "Wednesday",
  wed: "Wednesday",
  thursday: "Thursday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  friday: "Friday",
  fri: "Friday",
  saturday: "Saturday",
  sat: "Saturday",
  sunday: "Sunday",
  sun: "Sunday",
};

function normalizeDayOfWeek(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  const days = values
    .map((item) => {
      const text = trimText(item).replace(/^https:\/\/schema\.org\//i, "").toLowerCase();
      return DAY_OF_WEEK_ALIASES[text] ?? "";
    })
    .filter(Boolean);
  return days.length > 1 ? days : days[0] ?? "";
}

function normalizeBusinessTime(value: unknown) {
  const match = trimText(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return "";
  const hour = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "", 10);
  const second = match[3] == null ? null : Number.parseInt(match[3], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || (second != null && (second < 0 || second > 59))) return "";
  const base = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return second == null ? base : `${base}:${String(second).padStart(2, "0")}`;
}

function normalizeIsoDate(value: unknown) {
  const text = trimText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeOpeningHoursSpecification(value: unknown) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as MerchantSeoOpeningHoursInput;
      const dayOfWeek = normalizeDayOfWeek(record.dayOfWeek);
      const opens = normalizeBusinessTime(record.opens);
      const closes = normalizeBusinessTime(record.closes);
      if (!dayOfWeek || !opens || !closes) return null;
      return compactRecord({
        "@type": "OpeningHoursSpecification",
        dayOfWeek,
        opens,
        closes,
        validFrom: normalizeIsoDate(record.validFrom),
        validThrough: normalizeIsoDate(record.validThrough),
      });
    })
    .filter((entry): entry is JsonRecord => Boolean(entry));
}

function compactRecord(record: JsonRecord) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") return Object.keys(value as JsonRecord).length > 0;
      return true;
    }),
  );
}

export function buildMerchantLocalBusinessJsonLd(profile: MerchantSeoProfile, publicOrigin?: string | null) {
  const name = merchantDisplayName(profile);
  if (!name) return null;
  const canonicalUrl = buildMerchantSeoCanonicalUrl(profile, publicOrigin);
  const location = profile.location ?? {};
  const visibility = profile.contactVisibility ?? {};
  const geo = resolveMerchantGeo(profile);
  const openingHoursSpecification = normalizeOpeningHoursSpecification(
    profile.openingHoursSpecification ?? profile.businessHours,
  );
  const sameAs = normalizeSameAs(profile.sameAs);
  const address = compactRecord({
    "@type": "PostalAddress",
    streetAddress: trimText(profile.contactAddress),
    addressLocality: trimText(location.city),
    addressRegion: trimText(location.province),
    addressCountry: trimText(location.countryCode || location.country),
  });
  const image = resolveMerchantSeoImageUrl(profile, publicOrigin);

  return compactRecord({
    "@context": "https://schema.org",
    "@type": resolveMerchantLocalBusinessType(profile),
    "@id": `${canonicalUrl}#localbusiness`,
    name,
    url: canonicalUrl,
    image,
    description: buildMerchantSeoDescription(profile),
    priceRange: trimText(profile.priceRange).slice(0, 99),
    telephone: visibility.phoneHidden ? "" : trimText(profile.contactPhone),
    email: visibility.emailHidden ? "" : trimText(profile.contactEmail),
    address,
    geo,
    hasMap: buildMerchantMapUrl(profile, geo),
    openingHoursSpecification,
    sameAs,
    areaServed: [trimText(location.country), trimText(location.province), trimText(location.city)].filter(Boolean),
    contactPoint: compactRecord({
      "@type": "ContactPoint",
      name: trimText(profile.contactName),
      telephone: visibility.phoneHidden ? "" : trimText(profile.contactPhone),
      email: visibility.emailHidden ? "" : trimText(profile.contactEmail),
      contactType: "customer support",
    }),
  });
}

function resolveLastModified(value: unknown) {
  const timestamp = new Date(String(value ?? "")).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
}

export function buildMerchantSitemapEntry(
  site: MerchantListPublishedSite,
  publicOrigin?: string | null,
): MetadataRoute.Sitemap[number] | null {
  if (!isMerchantSeoIndexable(site)) return null;
  return {
    url: buildMerchantSeoCanonicalUrl(site, publicOrigin),
    lastModified: resolveLastModified(site.createdAt),
    changeFrequency: "weekly",
    priority: 0.7,
  };
}
