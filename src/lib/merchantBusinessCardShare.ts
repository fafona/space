import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

export const MERCHANT_BUSINESS_CARD_SHARE_PATH = "/share/business-card";
export const MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM = "card";
export const MERCHANT_BUSINESS_CARD_SHARE_FOLDER = "merchant-shares";

const PUBLIC_STORAGE_BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"] as const;

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

function isLocalHost(hostname: string) {
  const normalized = normalizeText(hostname).toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized.endsWith(".localhost");
}

function isIpv4Host(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizeText(hostname));
}

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = normalizeText(value);
  if (!trimmed) return "";
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/\/+$/g, "")}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.protocol === "http:" && !isLocalHost(parsed.hostname)) {
      parsed.protocol = "https:";
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

export function normalizeMerchantBusinessCardShareTargetUrl(value: string | null | undefined) {
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

function isPublicOrigin(origin: string) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return !isLocalHost(parsed.hostname) && !isIpv4Host(parsed.hostname);
  } catch {
    return false;
  }
}

function deriveShareOriginFromTargetUrl(targetUrl: string | null | undefined) {
  const normalizedTargetUrl = normalizeMerchantBusinessCardShareTargetUrl(targetUrl);
  if (!normalizedTargetUrl) return "";
  try {
    const parsed = new URL(normalizedTargetUrl);
    const hostname = normalizeText(parsed.hostname).toLowerCase();
    if (!hostname || isLocalHost(hostname) || isIpv4Host(hostname)) return "";
    const labels = hostname.split(".").filter(Boolean);
    if (labels.length < 2) return "";
    const rootHostname = labels.length > 2 ? labels.slice(1).join(".") : labels.join(".");
    const port = parsed.port ? `:${parsed.port}` : "";
    return normalizeOrigin(`https://${rootHostname}${port}`);
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
  const normalized = normalizeMerchantBusinessCardShareTargetUrl(targetUrl);
  if (!normalized) return "";
  try {
    return new URL(normalized).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function resolveMerchantBusinessCardShareOrigin(preferredOrigin?: string | null, targetUrl?: string | null) {
  const fromPreferred = normalizeOrigin(preferredOrigin);
  if (fromPreferred && isPublicOrigin(fromPreferred)) return fromPreferred;
  const fromTarget = deriveShareOriginFromTargetUrl(targetUrl);
  if (fromTarget) return fromTarget;
  const fromEnv = normalizeOrigin(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
  if (fromEnv && isPublicOrigin(fromEnv)) return fromEnv;
  if (typeof window !== "undefined" && window.location?.origin) {
    const fromWindow = normalizeOrigin(window.location.origin);
    if (fromWindow && isPublicOrigin(fromWindow)) return fromWindow;
  }
  if (fromPreferred) return fromPreferred;
  if (typeof window !== "undefined" && window.location?.origin) {
    return normalizeOrigin(window.location.origin);
  }
  return "";
}

export function normalizeMerchantBusinessCardShareImageUrl(value: string | null | undefined, preferredOrigin?: string | null) {
  const rewritten = normalizePublicAssetUrl(normalizeText(value), preferredOrigin ?? undefined);
  return normalizeMerchantBusinessCardShareTargetUrl(rewritten);
}

export function normalizeMerchantBusinessCardShareKey(value: string | null | undefined) {
  const normalized = normalizeText(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{5,63}$/i.test(normalized)) return "";
  return normalized;
}

export function readMerchantBusinessCardShareKey(searchParams: SearchParamsLike) {
  return normalizeMerchantBusinessCardShareKey(
    readSearchParam(searchParams, MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM),
  );
}

function normalizeSharePayload(
  input: {
    name?: string | null;
    imageUrl?: string | null;
    targetUrl?: string | null;
  },
  preferredOrigin?: string | null,
): MerchantBusinessCardSharePayload | null {
  const targetUrl = normalizeMerchantBusinessCardShareTargetUrl(input.targetUrl);
  const imageUrl = normalizeMerchantBusinessCardShareImageUrl(input.imageUrl, preferredOrigin);
  if (!targetUrl || !imageUrl) return null;
  return {
    name: normalizeText(input.name).slice(0, 80),
    imageUrl,
    targetUrl,
  };
}

export function buildMerchantBusinessCardShareManifestObjectPath(key: string) {
  const normalizedKey = normalizeMerchantBusinessCardShareKey(key);
  if (!normalizedKey) return "";
  return `${MERCHANT_BUSINESS_CARD_SHARE_FOLDER}/${normalizedKey}.json`;
}

export function buildMerchantBusinessCardShareManifestPublicUrls(key: string, preferredOrigin?: string | null) {
  const origin = resolveMerchantBusinessCardShareOrigin(preferredOrigin);
  const objectPath = buildMerchantBusinessCardShareManifestObjectPath(key);
  if (!origin || !objectPath) return [];
  return PUBLIC_STORAGE_BUCKET_CANDIDATES.map((bucket) =>
    new URL(`/storage/v1/object/public/${bucket}/${objectPath}`, `${origin}/`).toString(),
  );
}

export function buildMerchantBusinessCardShareUrl(input: {
  origin?: string | null;
  shareKey?: string | null;
  name?: string | null;
  imageUrl: string;
  targetUrl: string;
}) {
  const origin = resolveMerchantBusinessCardShareOrigin(input.origin, input.targetUrl);
  if (!origin) return "";

  const shareUrl = new URL(MERCHANT_BUSINESS_CARD_SHARE_PATH, `${origin}/`);
  const shareKey = normalizeMerchantBusinessCardShareKey(input.shareKey);
  if (shareKey) {
    shareUrl.searchParams.set(MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM, shareKey);
    return shareUrl.toString();
  }

  const payload = normalizeSharePayload(
    {
      name: input.name,
      imageUrl: input.imageUrl,
      targetUrl: input.targetUrl,
    },
    origin,
  );
  if (!payload) return "";

  shareUrl.searchParams.set("image", payload.imageUrl);
  shareUrl.searchParams.set("target", payload.targetUrl);
  if (payload.name) {
    shareUrl.searchParams.set("name", payload.name);
  }
  return shareUrl.toString();
}

export function parseMerchantBusinessCardShareParams(
  searchParams: SearchParamsLike,
  preferredOrigin?: string | null,
): MerchantBusinessCardSharePayload | null {
  return normalizeSharePayload(
    {
      name: readSearchParam(searchParams, "name"),
      imageUrl: readSearchParam(searchParams, "image"),
      targetUrl: readSearchParam(searchParams, "target"),
    },
    preferredOrigin,
  );
}

export async function loadMerchantBusinessCardSharePayloadByKey(
  key: string | null | undefined,
  preferredOrigin?: string | null,
) {
  const normalizedKey = normalizeMerchantBusinessCardShareKey(key);
  if (!normalizedKey) return null;

  for (const url of buildMerchantBusinessCardShareManifestPublicUrls(normalizedKey, preferredOrigin)) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        next: { revalidate: 0 },
      });
      if (!response.ok) continue;
      const json = (await response.json().catch(() => null)) as MerchantBusinessCardSharePayload | null;
      const payload = normalizeSharePayload(json ?? {}, preferredOrigin);
      if (payload) return payload;
    } catch {
      continue;
    }
  }

  return null;
}

export async function resolveMerchantBusinessCardSharePayload(
  searchParams: SearchParamsLike,
  preferredOrigin?: string | null,
) {
  const shareKey = readMerchantBusinessCardShareKey(searchParams);
  if (shareKey) {
    const payload = await loadMerchantBusinessCardSharePayloadByKey(shareKey, preferredOrigin);
    if (payload) return payload;
  }
  return parseMerchantBusinessCardShareParams(searchParams, preferredOrigin);
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
