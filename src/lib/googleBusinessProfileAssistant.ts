import type { MerchantSeoProfile } from "@/lib/merchantSeo";
import { buildMerchantSeoCanonicalUrl } from "@/lib/merchantSeo";

export type GoogleBusinessProfileReadinessItem = {
  key: string;
  label: string;
  complete: boolean;
};

export type GoogleBusinessProfileReadiness = {
  required: GoogleBusinessProfileReadinessItem[];
  recommended: GoogleBusinessProfileReadinessItem[];
  requiredCompleteCount: number;
  requiredTotal: number;
  recommendedCompleteCount: number;
  recommendedTotal: number;
  ready: boolean;
};

function trimText(value: unknown) {
  return String(value ?? "").trim();
}

function hasText(value: unknown) {
  return trimText(value).length > 0;
}

function merchantDisplayName(profile: MerchantSeoProfile) {
  return trimText(profile.merchantName) || trimText(profile.name) || trimText(profile.domain) || trimText(profile.id);
}

export function buildGoogleBusinessProfileWebsiteUrl(profile: MerchantSeoProfile, publicOrigin?: string | null) {
  return buildMerchantSeoCanonicalUrl(profile, publicOrigin);
}

export function buildGoogleBusinessProfileReadiness(
  profile: MerchantSeoProfile,
  websiteUrl?: string | null,
): GoogleBusinessProfileReadiness {
  const location = profile.location ?? {};
  const resolvedWebsiteUrl = trimText(websiteUrl) || buildGoogleBusinessProfileWebsiteUrl(profile);
  const required: GoogleBusinessProfileReadinessItem[] = [
    { key: "merchantName", label: "商户名称", complete: hasText(merchantDisplayName(profile)) },
    { key: "industry", label: "行业分类", complete: hasText(profile.industry || profile.category) },
    { key: "country", label: "国家", complete: hasText(location.country || location.countryCode) },
    { key: "city", label: "城市", complete: hasText(location.city) },
    { key: "address", label: "详细地址", complete: hasText(profile.contactAddress) },
    { key: "phone", label: "联系电话", complete: hasText(profile.contactPhone) },
    { key: "website", label: "商户网站", complete: hasText(resolvedWebsiteUrl) },
  ];
  const recommended: GoogleBusinessProfileReadinessItem[] = [
    { key: "province", label: "省份/地区", complete: hasText(location.province || location.provinceCode) },
    { key: "contactName", label: "联系人", complete: hasText(profile.contactName) },
    { key: "email", label: "联系邮箱", complete: hasText(profile.contactEmail) },
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

export function buildGoogleBusinessProfileSearchUrl(profile: MerchantSeoProfile) {
  const location = profile.location ?? {};
  const query = [merchantDisplayName(profile), trimText(location.city), trimText(location.country)]
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query || "Google Business Profile")}`;
}

export function buildGoogleBusinessProfileOpenUrl() {
  return "https://www.google.com/business/";
}

export function buildGoogleBusinessProfileWorksheet(profile: MerchantSeoProfile, publicOrigin?: string | null) {
  const location = profile.location ?? {};
  const address = [
    trimText(profile.contactAddress),
    trimText(location.city),
    trimText(location.province),
    trimText(location.country || location.countryCode),
  ]
    .filter(Boolean)
    .join(", ");
  const websiteUrl = buildGoogleBusinessProfileWebsiteUrl(profile, publicOrigin);
  const lines = [
    ["商户名称", merchantDisplayName(profile)],
    ["行业分类", trimText(profile.industry || profile.category)],
    ["详细地址", address],
    ["联系电话", trimText(profile.contactPhone)],
    ["联系邮箱", trimText(profile.contactEmail)],
    ["联系人", trimText(profile.contactName)],
    ["商户网站", websiteUrl],
    ["Faolla 商户ID", trimText(profile.id)],
  ];
  return lines
    .filter(([, value]) => hasText(value))
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}
