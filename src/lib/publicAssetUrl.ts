function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, "");
}

function normalizeOrigin(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.includes("\\")) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimTrailingSlash(trimmed);
  if (typeof window !== "undefined" && window.location?.protocol) {
    return `${window.location.protocol}//${trimTrailingSlash(trimmed)}`;
  }
  return `https://${trimTrailingSlash(trimmed)}`;
}

function toRootOrigin(value: string) {
  const normalized = normalizeOrigin(value);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    const hostParts = url.hostname.split(".").filter(Boolean);
    if (hostParts.length >= 3) {
      url.hostname = hostParts.slice(1).join(".");
    }
    return trimTrailingSlash(url.origin);
  } catch {
    return "";
  }
}

function resolvePreferredAssetOrigin(preferredOrigin?: string) {
  const direct = normalizeOrigin(preferredOrigin ?? "");
  if (direct) return direct;

  if (typeof window !== "undefined" && window.location?.origin) {
    const runtimeRoot = toRootOrigin(window.location.origin);
    return runtimeRoot || trimTrailingSlash(window.location.origin);
  }

  const fromEnv = toRootOrigin(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "");
  if (fromEnv) return fromEnv;

  return "";
}

function readPublicStoragePath(value: string) {
  const storagePathMatch =
    value.match(/^https?:\/\/[^?]+?(\/storage\/v1\/object\/public\/.+)$/i) ??
    value.match(/^(\/storage\/v1\/object\/public\/.+)$/i);
  return storagePathMatch ? storagePathMatch[1] ?? storagePathMatch[0] : "";
}

export function normalizePublicAssetUrl(value: string, preferredOrigin?: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("\\")) return "";
  if (/^data:/i.test(trimmed)) {
    return /^data:(?:image\/(?:png|jpe?g|gif|webp|avif)|audio\/(?:mpeg|mp3|wav|ogg|webm));base64,/i.test(trimmed)
      ? trimmed
      : "";
  }
  if (/^blob:/i.test(trimmed)) {
    if (typeof window === "undefined" || !window.location?.origin) return "";
    return trimmed.startsWith(`blob:${window.location.origin}/`) ? trimmed : "";
  }

  const storagePath = readPublicStoragePath(trimmed);
  if (!storagePath) {
    if (trimmed.startsWith("/")) return trimmed.startsWith("//") ? "" : trimmed;
    try {
      const url = new URL(trimmed);
      return url.protocol === "https:" ? url.toString() : "";
    } catch {
      return "";
    }
  }
  const runtimeOrigin = resolvePreferredAssetOrigin(preferredOrigin);

  if (!runtimeOrigin) return trimmed;
  return `${trimTrailingSlash(runtimeOrigin)}${storagePath}`;
}

export function normalizePublicAssetResponseUrl(value: string, preferredOrigin?: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const normalized = normalizePublicAssetUrl(trimmed, preferredOrigin);
  if (normalized !== trimmed) return normalized;
  return readPublicStoragePath(trimmed) || normalized;
}
