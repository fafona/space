import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import {
  MERCHANT_BUSINESS_CARD_PHONE_LIMIT,
  normalizeMerchantBusinessCardContactFieldOrder,
  type MerchantBusinessCardContactDisplayKey,
} from "./merchantBusinessCards";

export const MERCHANT_BUSINESS_CARD_SHARE_PATH = "/share/business-card";
export const MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM = "card";
export const MERCHANT_BUSINESS_CARD_SHARE_FOLDER = "merchant-shares";
export const MERCHANT_BUSINESS_CARD_SHARE_CARD_PATH = "/card";
export const MERCHANT_BUSINESS_CARD_SHARE_REVOCATION_FOLDER = "merchant-share-revocations";

const PUBLIC_STORAGE_BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"] as const;
const MERCHANT_BUSINESS_CARD_SHARE_REVOCATION_KEY_FOLDER = `${MERCHANT_BUSINESS_CARD_SHARE_REVOCATION_FOLDER}/key`;
const MERCHANT_BUSINESS_CARD_SHARE_REVOCATION_LEGACY_FOLDER = `${MERCHANT_BUSINESS_CARD_SHARE_REVOCATION_FOLDER}/legacy`;

type SearchParamValue = string | string[] | undefined;
type SearchParamsLike = URLSearchParams | Record<string, SearchParamValue>;

export type MerchantBusinessCardSharePayload = {
  name: string;
  imageUrl?: string;
  detailImageUrl?: string;
  detailImageHeight?: number;
  targetUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  contact?: MerchantBusinessCardShareContact;
};

export type MerchantBusinessCardShareContact = {
  displayName?: string;
  organization?: string;
  title?: string;
  phone?: string;
  phones?: string[];
  contactFieldOrder?: MerchantBusinessCardContactDisplayKey[];
  email?: string;
  address?: string;
  wechat?: string;
  whatsapp?: string;
  twitter?: string;
  weibo?: string;
  telegram?: string;
  linkedin?: string;
  discord?: string;
  facebook?: string;
  instagram?: string;
  tiktok?: string;
  douyin?: string;
  xiaohongshu?: string;
  websiteUrl?: string;
  note?: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampImageDimension(value: unknown) {
  const normalized = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return normalized >= 120 && normalized <= 4096 ? normalized : 0;
}

function clampContactText(value: unknown, maxLength: number) {
  return normalizeText(value).slice(0, maxLength);
}

function normalizeContactPhoneList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => clampContactText(item, 80)).filter(Boolean).slice(0, MERCHANT_BUSINESS_CARD_PHONE_LIMIT)
    : [];
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

function rewriteStorageUrlToOrigin(value: string, preferredOrigin: string) {
  const normalizedOrigin = normalizeOrigin(preferredOrigin);
  if (!normalizedOrigin) return "";
  const trimmed = normalizeText(value);
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (!parsed.pathname.startsWith("/storage/v1/object/public/")) return "";
    return new URL(parsed.pathname, `${normalizedOrigin}/`).toString();
  } catch {
    if (!trimmed.startsWith("/storage/v1/object/public/")) return "";
    return new URL(trimmed, `${normalizedOrigin}/`).toString();
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
  const forcedPublicUrl = rewriteStorageUrlToOrigin(normalizeText(value), preferredOrigin ?? "");
  const rewritten = forcedPublicUrl || normalizePublicAssetUrl(normalizeText(value), preferredOrigin ?? undefined);
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
    detailImageUrl?: string | null;
    detailImageHeight?: number | null;
    targetUrl?: string | null;
    imageWidth?: number | null;
    imageHeight?: number | null;
    contact?: MerchantBusinessCardShareContact | null;
  },
  preferredOrigin?: string | null,
): MerchantBusinessCardSharePayload | null {
  const targetUrl = normalizeMerchantBusinessCardShareTargetUrl(input.targetUrl);
  const imageUrl = normalizeMerchantBusinessCardShareImageUrl(input.imageUrl, preferredOrigin);
  const detailImageUrl = normalizeMerchantBusinessCardShareImageUrl(input.detailImageUrl, preferredOrigin);
  const detailImageHeight = clampImageDimension(input.detailImageHeight);
  if (!targetUrl) return null;
  const imageWidth = clampImageDimension(input.imageWidth);
  const imageHeight = clampImageDimension(input.imageHeight);
  return {
    name: normalizeText(input.name).slice(0, 80),
    ...(imageUrl ? { imageUrl } : {}),
    ...(detailImageUrl ? { detailImageUrl } : {}),
    ...(detailImageUrl && detailImageHeight ? { detailImageHeight } : {}),
    targetUrl,
    ...(imageUrl && imageWidth ? { imageWidth } : {}),
    ...(imageUrl && imageHeight ? { imageHeight } : {}),
    ...(normalizeMerchantBusinessCardShareContact(input.contact, targetUrl)
      ? { contact: normalizeMerchantBusinessCardShareContact(input.contact, targetUrl) }
      : {}),
  };
}

export function normalizeMerchantBusinessCardSharePayload(
  input: {
    name?: string | null;
    imageUrl?: string | null;
    detailImageUrl?: string | null;
    detailImageHeight?: number | null;
    targetUrl?: string | null;
    imageWidth?: number | null;
    imageHeight?: number | null;
    contact?: MerchantBusinessCardShareContact | null;
  },
  preferredOrigin?: string | null,
) {
  return normalizeSharePayload(input, preferredOrigin);
}

export function normalizeMerchantBusinessCardShareContact(
  input: MerchantBusinessCardShareContact | null | undefined,
  targetUrl?: string | null,
) {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const source = input;
  const websiteUrl =
    normalizeMerchantBusinessCardShareTargetUrl(source.websiteUrl) ||
    normalizeMerchantBusinessCardShareTargetUrl(targetUrl);
  const hasExplicitContactFieldOrder = Array.isArray(source.contactFieldOrder) && source.contactFieldOrder.length > 0;
  const contactFieldOrder = hasExplicitContactFieldOrder
    ? normalizeMerchantBusinessCardContactFieldOrder(source.contactFieldOrder)
    : undefined;
  const contact = {
    ...(clampContactText(source.displayName, 120)
      ? { displayName: clampContactText(source.displayName, 120) }
      : {}),
    ...(clampContactText(source.organization, 120)
      ? { organization: clampContactText(source.organization, 120) }
      : {}),
    ...(clampContactText(source.title, 120)
      ? { title: clampContactText(source.title, 120) }
      : {}),
    ...(clampContactText(source.phone, 80)
      ? { phone: clampContactText(source.phone, 80) }
      : {}),
    ...(normalizeContactPhoneList(source.phones).length > 0
      ? { phones: normalizeContactPhoneList(source.phones) }
      : {}),
    ...(clampContactText(source.email, 160)
      ? { email: clampContactText(source.email, 160) }
      : {}),
    ...(clampContactText(source.address, 240)
      ? { address: clampContactText(source.address, 240) }
      : {}),
    ...(clampContactText(source.wechat, 120)
      ? { wechat: clampContactText(source.wechat, 120) }
      : {}),
    ...(clampContactText(source.whatsapp, 120)
      ? { whatsapp: clampContactText(source.whatsapp, 120) }
      : {}),
    ...(clampContactText(source.twitter, 120)
      ? { twitter: clampContactText(source.twitter, 120) }
      : {}),
    ...(clampContactText(source.weibo, 120)
      ? { weibo: clampContactText(source.weibo, 120) }
      : {}),
    ...(clampContactText(source.telegram, 120)
      ? { telegram: clampContactText(source.telegram, 120) }
      : {}),
    ...(clampContactText(source.linkedin, 120)
      ? { linkedin: clampContactText(source.linkedin, 120) }
      : {}),
    ...(clampContactText(source.discord, 120)
      ? { discord: clampContactText(source.discord, 120) }
      : {}),
    ...(clampContactText(source.facebook, 120)
      ? { facebook: clampContactText(source.facebook, 120) }
      : {}),
    ...(clampContactText(source.instagram, 120)
      ? { instagram: clampContactText(source.instagram, 120) }
      : {}),
    ...(clampContactText(source.tiktok, 120)
      ? { tiktok: clampContactText(source.tiktok, 120) }
      : {}),
    ...(clampContactText(source.douyin, 120)
      ? { douyin: clampContactText(source.douyin, 120) }
      : {}),
    ...(clampContactText(source.xiaohongshu, 120)
      ? { xiaohongshu: clampContactText(source.xiaohongshu, 120) }
      : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
    ...(clampContactText(source.note, 600)
      ? { note: clampContactText(source.note, 600) }
      : {}),
  } satisfies MerchantBusinessCardShareContact;
  if (!Object.values(contact).some(Boolean)) {
    return undefined;
  }
  return contactFieldOrder ? { ...contact, contactFieldOrder } : contact;
}

export function buildMerchantBusinessCardShareManifestObjectPath(key: string) {
  const normalizedKey = normalizeMerchantBusinessCardShareKey(key);
  if (!normalizedKey) return "";
  return `${MERCHANT_BUSINESS_CARD_SHARE_FOLDER}/${normalizedKey}.json`;
}

function buildPublicStorageObjectUrls(objectPath: string, preferredOrigin?: string | null) {
  const origin = resolveMerchantBusinessCardShareOrigin(preferredOrigin);
  const normalizedPath = normalizeText(objectPath).replace(/^\/+/g, "");
  if (!origin || !normalizedPath) return [];
  return PUBLIC_STORAGE_BUCKET_CANDIDATES.map((bucket) =>
    new URL(`/storage/v1/object/public/${bucket}/${normalizedPath}`, `${origin}/`).toString(),
  );
}

export function buildMerchantBusinessCardShareManifestPublicUrls(key: string, preferredOrigin?: string | null) {
  const objectPath = buildMerchantBusinessCardShareManifestObjectPath(key);
  return buildPublicStorageObjectUrls(objectPath, preferredOrigin);
}

function buildFnv1a32(value: string, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function buildStableHexHash(value: string) {
  const forward = buildFnv1a32(value, 0x811c9dc5);
  const backward = buildFnv1a32(Array.from(value).reverse().join(""), 0x9e3779b1);
  return `${forward.toString(16).padStart(8, "0")}${backward.toString(16).padStart(8, "0")}`;
}

export function buildMerchantBusinessCardShareLegacyFingerprint(
  input:
    | {
        name?: string | null;
        imageUrl?: string | null;
        detailImageUrl?: string | null;
        detailImageHeight?: number | null;
        targetUrl?: string | null;
        imageWidth?: number | null;
        imageHeight?: number | null;
        contact?: MerchantBusinessCardShareContact | null;
      }
    | MerchantBusinessCardSharePayload
    | null
    | undefined,
  preferredOrigin?: string | null,
) {
  const payload = normalizeSharePayload(input ?? {}, preferredOrigin);
  if (!payload) return "";
  const contact = payload.contact ?? {};
  const fingerprintSource = [
    payload.name,
    payload.imageUrl ?? "",
    payload.detailImageUrl ?? "",
    String(payload.detailImageHeight ?? 0),
    payload.targetUrl,
    String(payload.imageWidth ?? 0),
    String(payload.imageHeight ?? 0),
    contact.displayName ?? "",
    contact.organization ?? "",
    contact.title ?? "",
    contact.phone ?? "",
    (contact.phones ?? []).join("|"),
    (contact.contactFieldOrder ?? []).join("|"),
    contact.email ?? "",
    contact.address ?? "",
    contact.wechat ?? "",
    contact.whatsapp ?? "",
    contact.twitter ?? "",
    contact.weibo ?? "",
    contact.telegram ?? "",
    contact.linkedin ?? "",
    contact.discord ?? "",
    contact.facebook ?? "",
    contact.instagram ?? "",
    contact.tiktok ?? "",
    contact.douyin ?? "",
    contact.xiaohongshu ?? "",
    contact.websiteUrl ?? "",
    contact.note ?? "",
  ].join("\u001f");
  return `legacy-${buildStableHexHash(fingerprintSource)}`;
}

export function buildMerchantBusinessCardShareRevocationByKeyObjectPath(key: string) {
  const normalizedKey = normalizeMerchantBusinessCardShareKey(key);
  if (!normalizedKey) return "";
  return `${MERCHANT_BUSINESS_CARD_SHARE_REVOCATION_KEY_FOLDER}/${normalizedKey}.json`;
}

export function buildMerchantBusinessCardShareRevocationByLegacyPayloadObjectPath(
  input:
    | {
        name?: string | null;
        imageUrl?: string | null;
        detailImageUrl?: string | null;
        detailImageHeight?: number | null;
        targetUrl?: string | null;
        imageWidth?: number | null;
        imageHeight?: number | null;
        contact?: MerchantBusinessCardShareContact | null;
      }
    | MerchantBusinessCardSharePayload
    | null
    | undefined,
  preferredOrigin?: string | null,
) {
  const fingerprint = buildMerchantBusinessCardShareLegacyFingerprint(input, preferredOrigin);
  if (!fingerprint) return "";
  return `${MERCHANT_BUSINESS_CARD_SHARE_REVOCATION_LEGACY_FOLDER}/${fingerprint}.json`;
}

export async function isMerchantBusinessCardShareRevoked(input: {
  shareKey?: string | null;
  payload?: MerchantBusinessCardSharePayload | null;
  preferredOrigin?: string | null;
}) {
  const objectPaths = [
    buildMerchantBusinessCardShareRevocationByKeyObjectPath(normalizeText(input.shareKey)),
    buildMerchantBusinessCardShareRevocationByLegacyPayloadObjectPath(input.payload ?? null, input.preferredOrigin),
  ].filter(Boolean);

  for (const objectPath of Array.from(new Set(objectPaths))) {
    for (const url of buildPublicStorageObjectUrls(objectPath, input.preferredOrigin)) {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          next: { revalidate: 0 },
        });
        if (response.ok) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  return false;
}

export function buildMerchantBusinessCardShareUrl(input: {
  origin?: string | null;
  shareKey?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  detailImageUrl?: string | null;
  detailImageHeight?: number | null;
  targetUrl: string;
  contact?: MerchantBusinessCardShareContact | null;
}) {
  const origin = resolveMerchantBusinessCardShareOrigin(input.origin, input.targetUrl);
  if (!origin) return "";

  const shareUrl = new URL(MERCHANT_BUSINESS_CARD_SHARE_PATH, `${origin}/`);
  const shareKey = normalizeMerchantBusinessCardShareKey(input.shareKey);
  if (shareKey) {
    shareUrl.pathname = `${MERCHANT_BUSINESS_CARD_SHARE_CARD_PATH}/${shareKey}`;
    shareUrl.search = "";
    return shareUrl.toString();
  }

  const payload = normalizeSharePayload(
    {
      name: input.name,
      imageUrl: input.imageUrl,
      detailImageUrl: input.detailImageUrl,
      detailImageHeight: input.detailImageHeight,
      targetUrl: input.targetUrl,
      contact: input.contact,
    },
    origin,
  );
  if (!payload) return "";

  if (payload.imageUrl) {
    shareUrl.searchParams.set("image", payload.imageUrl);
  }
  if (payload.detailImageUrl) {
    shareUrl.searchParams.set("detailImage", payload.detailImageUrl);
  }
  if (payload.detailImageHeight) {
    shareUrl.searchParams.set("detailImageHeight", String(payload.detailImageHeight));
  }
  shareUrl.searchParams.set("target", payload.targetUrl);
  if (payload.name) {
    shareUrl.searchParams.set("name", payload.name);
  }
  if (payload.contact?.displayName) {
    shareUrl.searchParams.set("contactName", payload.contact.displayName);
  }
  if (payload.contact?.organization) {
    shareUrl.searchParams.set("organization", payload.contact.organization);
  }
  if (payload.contact?.title) {
    shareUrl.searchParams.set("title", payload.contact.title);
  }
  if (payload.contact?.phone) {
    shareUrl.searchParams.set("phone", payload.contact.phone);
  }
  if (payload.contact?.phones?.length) {
    shareUrl.searchParams.set("phones", payload.contact.phones.join(","));
  }
  if (payload.contact?.contactFieldOrder?.length) {
    shareUrl.searchParams.set("contactOrder", payload.contact.contactFieldOrder.join(","));
  }
  if (payload.contact?.email) {
    shareUrl.searchParams.set("email", payload.contact.email);
  }
  if (payload.contact?.address) {
    shareUrl.searchParams.set("address", payload.contact.address);
  }
  if (payload.contact?.wechat) {
    shareUrl.searchParams.set("wechat", payload.contact.wechat);
  }
  if (payload.contact?.whatsapp) {
    shareUrl.searchParams.set("whatsapp", payload.contact.whatsapp);
  }
  if (payload.contact?.twitter) {
    shareUrl.searchParams.set("twitter", payload.contact.twitter);
  }
  if (payload.contact?.weibo) {
    shareUrl.searchParams.set("weibo", payload.contact.weibo);
  }
  if (payload.contact?.telegram) {
    shareUrl.searchParams.set("telegram", payload.contact.telegram);
  }
  if (payload.contact?.linkedin) {
    shareUrl.searchParams.set("linkedin", payload.contact.linkedin);
  }
  if (payload.contact?.discord) {
    shareUrl.searchParams.set("discord", payload.contact.discord);
  }
  if (payload.contact?.facebook) {
    shareUrl.searchParams.set("facebook", payload.contact.facebook);
  }
  if (payload.contact?.instagram) {
    shareUrl.searchParams.set("instagram", payload.contact.instagram);
  }
  if (payload.contact?.tiktok) {
    shareUrl.searchParams.set("tiktok", payload.contact.tiktok);
  }
  if (payload.contact?.douyin) {
    shareUrl.searchParams.set("douyin", payload.contact.douyin);
  }
  if (payload.contact?.xiaohongshu) {
    shareUrl.searchParams.set("xiaohongshu", payload.contact.xiaohongshu);
  }
  if (payload.contact?.websiteUrl) {
    shareUrl.searchParams.set("website", payload.contact.websiteUrl);
  }
  if (payload.contact?.note) {
    shareUrl.searchParams.set("note", payload.contact.note);
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
      detailImageUrl: readSearchParam(searchParams, "detailImage"),
      detailImageHeight: Number(readSearchParam(searchParams, "detailImageHeight")),
      targetUrl: readSearchParam(searchParams, "target"),
      imageWidth: Number(readSearchParam(searchParams, "imageWidth")),
      imageHeight: Number(readSearchParam(searchParams, "imageHeight")),
      contact: {
        displayName: readSearchParam(searchParams, "contactName"),
        organization: readSearchParam(searchParams, "organization"),
        title: readSearchParam(searchParams, "title"),
        phone: readSearchParam(searchParams, "phone"),
        phones: readSearchParam(searchParams, "phones")
          ?.split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        contactFieldOrder: readSearchParam(searchParams, "contactOrder")
          ?.split(",")
          .map((item) => item.trim())
          .filter(Boolean) as MerchantBusinessCardContactDisplayKey[] | undefined,
        email: readSearchParam(searchParams, "email"),
        address: readSearchParam(searchParams, "address"),
        wechat: readSearchParam(searchParams, "wechat"),
        whatsapp: readSearchParam(searchParams, "whatsapp"),
        twitter: readSearchParam(searchParams, "twitter"),
        weibo: readSearchParam(searchParams, "weibo"),
        telegram: readSearchParam(searchParams, "telegram"),
        linkedin: readSearchParam(searchParams, "linkedin"),
        discord: readSearchParam(searchParams, "discord"),
        facebook: readSearchParam(searchParams, "facebook"),
        instagram: readSearchParam(searchParams, "instagram"),
        tiktok: readSearchParam(searchParams, "tiktok"),
        douyin: readSearchParam(searchParams, "douyin"),
        xiaohongshu: readSearchParam(searchParams, "xiaohongshu"),
        websiteUrl: readSearchParam(searchParams, "website"),
        note: readSearchParam(searchParams, "note"),
      },
    },
    preferredOrigin,
  );
}

function escapeVCardValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function parseStructuredAddress(address: string) {
  const normalized = normalizeText(address);
  if (!normalized) {
    return {
      street: "",
      city: "",
      region: "",
      postalCode: "",
      country: "",
    };
  }

  const segments = normalized
    .split(/\s*\/\s*|\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      street: "",
      city: "",
      region: "",
      postalCode: "",
      country: "",
    };
  }

  let postalCode = "";
  const cleanedSegments = segments.map((segment) => {
    const match = segment.match(/\b\d{4,10}\b/);
    if (!postalCode && match?.[0]) {
      postalCode = match[0];
      return segment.replace(match[0], "").replace(/\s{2,}/g, " ").replace(/[,\-\/]\s*$/, "").trim();
    }
    return segment;
  });

  const street = cleanedSegments[0] || "";
  const tailSegments = cleanedSegments.slice(1).filter(Boolean);
  const country = tailSegments.length >= 3 ? tailSegments.at(-1) || "" : "";
  const middleSegments = country ? tailSegments.slice(0, -1) : tailSegments;
  const city = middleSegments[0] || "";
  const region = middleSegments[1] || "";

  return {
    street,
    city,
    region,
    postalCode,
    country,
  };
}

function buildStableContactCode(payload: MerchantBusinessCardSharePayload) {
  const contact = normalizeMerchantBusinessCardShareContact(payload.contact, payload.targetUrl);
  const seed = [
    contact?.displayName || "",
    contact?.organization || "",
    contact?.phone || "",
    contact?.email || "",
    payload.targetUrl || "",
  ].join("|");
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 131 + char.charCodeAt(0)) % 100000;
  }
  const value = ((hash % 99999) + 1).toString().padStart(5, "0");
  return value;
}

export function buildMerchantBusinessCardContactDownloadPath(key: string) {
  const normalizedKey = normalizeMerchantBusinessCardShareKey(key);
  if (!normalizedKey) return "";
  return `${MERCHANT_BUSINESS_CARD_SHARE_CARD_PATH}/${normalizedKey}/contact`;
}

export function buildMerchantBusinessCardContactDownloadUrl(input: {
  origin?: string | null;
  shareKey?: string | null;
  targetUrl?: string | null;
}) {
  const shareKey = normalizeMerchantBusinessCardShareKey(input.shareKey);
  if (!shareKey) return "";
  const origin = resolveMerchantBusinessCardShareOrigin(input.origin, input.targetUrl);
  if (!origin) return "";
  return new URL(buildMerchantBusinessCardContactDownloadPath(shareKey), `${origin}/`).toString();
}

export function buildMerchantBusinessCardLegacyContactDownloadUrl(input: {
  origin?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  detailImageUrl?: string | null;
  detailImageHeight?: number | null;
  targetUrl: string;
  contact?: MerchantBusinessCardShareContact | null;
}) {
  const origin = resolveMerchantBusinessCardShareOrigin(input.origin, input.targetUrl);
  if (!origin) return "";
  const url = new URL(`${MERCHANT_BUSINESS_CARD_SHARE_PATH}/contact`, `${origin}/`);
  const payload = normalizeSharePayload(
    {
      name: input.name,
      imageUrl: input.imageUrl,
      detailImageUrl: input.detailImageUrl,
      detailImageHeight: input.detailImageHeight,
      targetUrl: input.targetUrl,
      contact: input.contact,
    },
    origin,
  );
  if (!payload) return "";
  if (payload.imageUrl) {
    url.searchParams.set("image", payload.imageUrl);
  }
  if (payload.detailImageUrl) {
    url.searchParams.set("detailImage", payload.detailImageUrl);
  }
  if (payload.detailImageHeight) {
    url.searchParams.set("detailImageHeight", String(payload.detailImageHeight));
  }
  url.searchParams.set("target", payload.targetUrl);
  if (payload.name) url.searchParams.set("name", payload.name);
  if (payload.contact?.displayName) url.searchParams.set("contactName", payload.contact.displayName);
  if (payload.contact?.organization) url.searchParams.set("organization", payload.contact.organization);
  if (payload.contact?.title) url.searchParams.set("title", payload.contact.title);
  if (payload.contact?.phone) url.searchParams.set("phone", payload.contact.phone);
  if (payload.contact?.phones?.length) url.searchParams.set("phones", payload.contact.phones.join(","));
  if (payload.contact?.contactFieldOrder?.length) {
    url.searchParams.set("contactOrder", payload.contact.contactFieldOrder.join(","));
  }
  if (payload.contact?.email) url.searchParams.set("email", payload.contact.email);
  if (payload.contact?.address) url.searchParams.set("address", payload.contact.address);
  if (payload.contact?.wechat) url.searchParams.set("wechat", payload.contact.wechat);
  if (payload.contact?.whatsapp) url.searchParams.set("whatsapp", payload.contact.whatsapp);
  if (payload.contact?.twitter) url.searchParams.set("twitter", payload.contact.twitter);
  if (payload.contact?.weibo) url.searchParams.set("weibo", payload.contact.weibo);
  if (payload.contact?.telegram) url.searchParams.set("telegram", payload.contact.telegram);
  if (payload.contact?.linkedin) url.searchParams.set("linkedin", payload.contact.linkedin);
  if (payload.contact?.discord) url.searchParams.set("discord", payload.contact.discord);
  if (payload.contact?.facebook) url.searchParams.set("facebook", payload.contact.facebook);
  if (payload.contact?.instagram) url.searchParams.set("instagram", payload.contact.instagram);
  if (payload.contact?.tiktok) url.searchParams.set("tiktok", payload.contact.tiktok);
  if (payload.contact?.douyin) url.searchParams.set("douyin", payload.contact.douyin);
  if (payload.contact?.xiaohongshu) url.searchParams.set("xiaohongshu", payload.contact.xiaohongshu);
  if (payload.contact?.websiteUrl) url.searchParams.set("website", payload.contact.websiteUrl);
  if (payload.contact?.note) url.searchParams.set("note", payload.contact.note);
  return url.toString();
}

export function buildMerchantBusinessCardVCard(payload: MerchantBusinessCardSharePayload) {
  const contact = normalizeMerchantBusinessCardShareContact(payload.contact, payload.targetUrl);
  const displayName = contact?.displayName || normalizeText(payload.name) || "Business Card";
  const organization = contact?.organization || normalizeText(payload.name);
  const structuredAddress = parseStructuredAddress(contact?.address || "");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCardValue(displayName)}`,
    `N:;${escapeVCardValue(displayName)};;;`,
  ];

  if (organization) {
    lines.push(`ORG:${escapeVCardValue(organization)}`);
  }
  if (contact?.title) {
    lines.push(`TITLE:${escapeVCardValue(contact.title)}`);
  }
  if (contact?.phone) {
    lines.push(`TEL;TYPE=CELL:${escapeVCardValue(contact.phone)}`);
  }
  if (contact?.phones?.length) {
    contact.phones
      .filter((value) => value && value !== contact.phone)
      .forEach((value) => {
        lines.push(`TEL;TYPE=WORK:${escapeVCardValue(value)}`);
      });
  }
  if (contact?.email) {
    lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardValue(contact.email)}`);
  }
  if (contact?.address) {
    lines.push(
      `ADR;TYPE=WORK:;;${escapeVCardValue(structuredAddress.street)};${escapeVCardValue(structuredAddress.city)};${escapeVCardValue(structuredAddress.region)};${escapeVCardValue(structuredAddress.postalCode)};${escapeVCardValue(structuredAddress.country)}`,
    );
  }
  if (contact?.websiteUrl) {
    lines.push(`URL:${escapeVCardValue(contact.websiteUrl)}`);
  }
  if (contact?.note) {
    lines.push(`NOTE:${escapeVCardValue(contact.note)}`);
  }

  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function buildMerchantBusinessCardVCardFileName(payload: MerchantBusinessCardSharePayload) {
  const contact = normalizeMerchantBusinessCardShareContact(payload.contact, payload.targetUrl);
  const baseName = contact?.displayName || contact?.organization || normalizeText(payload.name) || "business-card";
  const sanitized = baseName
    .replace(/[\\/:*?"<>|]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${sanitized || "business-card"}-card${buildStableContactCode(payload)}.vcf`;
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
    if (
      await isMerchantBusinessCardShareRevoked({
        shareKey,
        preferredOrigin,
      })
    ) {
      return null;
    }
    return loadMerchantBusinessCardSharePayloadByKey(shareKey, preferredOrigin);
  }
  const payload = parseMerchantBusinessCardShareParams(searchParams, preferredOrigin);
  if (!payload) return null;
  if (
    await isMerchantBusinessCardShareRevoked({
      payload,
      preferredOrigin,
    })
  ) {
    return null;
  }
  return payload;
}

export function buildMerchantBusinessCardShareTitle(name: string) {
  const normalized = normalizeText(name);
  return normalized || "FAOLLA CARD";
}

export function buildMerchantBusinessCardShareDescription(name: string, targetUrl: string) {
  const normalizedName = normalizeText(name);
  const hostLabel = buildTargetHostLabel(targetUrl);
  if (normalizedName) return `${normalizedName} | FAOLLA CARD`;
  if (hostLabel) return `${hostLabel} | FAOLLA CARD`;
  return "FAOLLA CARD";
}
