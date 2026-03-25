import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

export const MERCHANT_BUSINESS_CARD_SHARE_PATH = "/share/business-card";
export const MERCHANT_BUSINESS_CARD_SHARE_KEY_PARAM = "card";
export const MERCHANT_BUSINESS_CARD_SHARE_FOLDER = "merchant-shares";
export const MERCHANT_BUSINESS_CARD_SHARE_CARD_PATH = "/card";

const PUBLIC_STORAGE_BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"] as const;

type SearchParamValue = string | string[] | undefined;
type SearchParamsLike = URLSearchParams | Record<string, SearchParamValue>;

export type MerchantBusinessCardSharePayload = {
  name: string;
  imageUrl?: string;
  detailImageUrl?: string;
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
  email?: string;
  address?: string;
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
    ? value.map((item) => clampContactText(item, 80)).filter(Boolean)
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
  if (!targetUrl) return null;
  const imageWidth = clampImageDimension(input.imageWidth);
  const imageHeight = clampImageDimension(input.imageHeight);
  return {
    name: normalizeText(input.name).slice(0, 80),
    ...(imageUrl ? { imageUrl } : {}),
    ...(detailImageUrl ? { detailImageUrl } : {}),
    targetUrl,
    ...(imageUrl && imageWidth ? { imageWidth } : {}),
    ...(imageUrl && imageHeight ? { imageHeight } : {}),
    ...(normalizeMerchantBusinessCardShareContact(input.contact, targetUrl)
      ? { contact: normalizeMerchantBusinessCardShareContact(input.contact, targetUrl) }
      : {}),
  };
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
    ...(websiteUrl ? { websiteUrl } : {}),
    ...(clampContactText(source.note, 600)
      ? { note: clampContactText(source.note, 600) }
      : {}),
  } satisfies MerchantBusinessCardShareContact;
  if (!Object.values(contact).some(Boolean)) {
    return undefined;
  }
  return contact;
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
  imageUrl?: string | null;
  detailImageUrl?: string | null;
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
  if (payload.contact?.email) {
    shareUrl.searchParams.set("email", payload.contact.email);
  }
  if (payload.contact?.address) {
    shareUrl.searchParams.set("address", payload.contact.address);
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
      targetUrl: readSearchParam(searchParams, "target"),
      imageWidth: Number(readSearchParam(searchParams, "imageWidth")),
      imageHeight: Number(readSearchParam(searchParams, "imageHeight")),
      contact: {
        displayName: readSearchParam(searchParams, "contactName"),
        organization: readSearchParam(searchParams, "organization"),
        title: readSearchParam(searchParams, "title"),
        phone: readSearchParam(searchParams, "phone"),
        email: readSearchParam(searchParams, "email"),
        address: readSearchParam(searchParams, "address"),
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
  url.searchParams.set("target", payload.targetUrl);
  if (payload.name) url.searchParams.set("name", payload.name);
  if (payload.contact?.displayName) url.searchParams.set("contactName", payload.contact.displayName);
  if (payload.contact?.organization) url.searchParams.set("organization", payload.contact.organization);
  if (payload.contact?.title) url.searchParams.set("title", payload.contact.title);
  if (payload.contact?.phone) url.searchParams.set("phone", payload.contact.phone);
  if (payload.contact?.email) url.searchParams.set("email", payload.contact.email);
  if (payload.contact?.address) url.searchParams.set("address", payload.contact.address);
  if (payload.contact?.websiteUrl) url.searchParams.set("website", payload.contact.websiteUrl);
  if (payload.contact?.note) url.searchParams.set("note", payload.contact.note);
  return url.toString();
}

export function buildMerchantBusinessCardVCard(payload: MerchantBusinessCardSharePayload) {
  const contact = normalizeMerchantBusinessCardShareContact(payload.contact, payload.targetUrl);
  const displayName = contact?.displayName || normalizeText(payload.name) || "Business Card";
  const organization = contact?.organization || normalizeText(payload.name);
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
    lines.push(`ADR;TYPE=WORK:;;${escapeVCardValue(contact.address)};;;;`);
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
