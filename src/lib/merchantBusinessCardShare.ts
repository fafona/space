import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

export const MERCHANT_BUSINESS_CARD_SHARE_PATH = "/share/business-card";

type SearchParamValue = string | string[] | undefined;
type SearchParamsLike = URLSearchParams | Record<string, SearchParamValue>;

export type MerchantBusinessCardSharePayload = {
  name: string;
  imageUrl: string;
  targetUrl: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = normalizeText(value);
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/g, "");
  }
  return `https://${trimmed.replace(/\/+$/g, "")}`;
}

function normalizeHttpUrl(value: string | null | undefined) {
  const trimmed = normalizeText(value);
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function readSearchParam(searchParams: SearchParamsLike, key: string) {
  if (searchParams instanceof URLSearchParams) {
    return normalizeText(searchParams.get(key));
  }
  const value = searchParams[key];
  if (Array.isArray(value)) return normalizeText(value[0]);
  return normalizeText(value);
}

function buildTargetHostLabel(targetUrl: string) {
  const normalized = normalizeHttpUrl(targetUrl);
  if (!normalized) return "";
  try {
    return new URL(normalized).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function resolveMerchantBusinessCardShareOrigin(preferredOrigin?: string | null) {
  const fromPreferred = normalizeOrigin(preferredOrigin);
  if (fromPreferred) return fromPreferred;
  if (typeof window !== "undefined" && window.location?.origin) {
    return normalizeOrigin(window.location.origin);
  }
  const fromEnv = normalizeOrigin(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
  if (fromEnv) return fromEnv;
  return "";
}

export function normalizeMerchantBusinessCardShareImageUrl(value: string | null | undefined, preferredOrigin?: string | null) {
  const rewritten = normalizePublicAssetUrl(normalizeText(value), preferredOrigin ?? undefined);
  return normalizeHttpUrl(rewritten);
}

export function buildMerchantBusinessCardShareUrl(input: {
  origin?: string | null;
  name?: string | null;
  imageUrl: string;
  targetUrl: string;
}) {
  const origin = resolveMerchantBusinessCardShareOrigin(input.origin);
  const imageUrl = normalizeMerchantBusinessCardShareImageUrl(input.imageUrl, origin);
  const targetUrl = normalizeHttpUrl(input.targetUrl);
  if (!origin || !imageUrl || !targetUrl) return "";

  const shareUrl = new URL(MERCHANT_BUSINESS_CARD_SHARE_PATH, `${origin}/`);
  shareUrl.searchParams.set("image", imageUrl);
  shareUrl.searchParams.set("target", targetUrl);
  const name = normalizeText(input.name).slice(0, 80);
  if (name) {
    shareUrl.searchParams.set("name", name);
  }
  return shareUrl.toString();
}

export function parseMerchantBusinessCardShareParams(
  searchParams: SearchParamsLike,
  preferredOrigin?: string | null,
): MerchantBusinessCardSharePayload | null {
  const targetUrl = normalizeHttpUrl(readSearchParam(searchParams, "target"));
  const imageUrl = normalizeMerchantBusinessCardShareImageUrl(readSearchParam(searchParams, "image"), preferredOrigin);
  if (!targetUrl || !imageUrl) return null;

  const name = readSearchParam(searchParams, "name").slice(0, 80);
  return {
    name,
    imageUrl,
    targetUrl,
  };
}

export function buildMerchantBusinessCardShareTitle(name: string) {
  const normalized = normalizeText(name);
  return normalized ? `${normalized} 名片` : "商户名片";
}

export function buildMerchantBusinessCardShareDescription(name: string, targetUrl: string) {
  const normalizedName = normalizeText(name);
  const hostLabel = buildTargetHostLabel(targetUrl);
  if (normalizedName && hostLabel) return `点击打开 ${normalizedName} 的网站 ${hostLabel}`;
  if (normalizedName) return `点击打开 ${normalizedName} 的网站`;
  if (hostLabel) return `点击打开网站 ${hostLabel}`;
  return "点击打开商户网站";
}
