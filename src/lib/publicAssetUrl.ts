function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, "");
}

function normalizeOrigin(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
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

  const fromEnv = toRootOrigin(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "");
  if (fromEnv) return fromEnv;

  if (typeof window !== "undefined" && window.location?.origin) {
    const runtimeRoot = toRootOrigin(window.location.origin);
    return runtimeRoot || trimTrailingSlash(window.location.origin);
  }

  return "";
}

export function normalizePublicAssetUrl(value: string, preferredOrigin?: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^(data|blob):/i.test(trimmed)) return trimmed;

  const storagePathMatch =
    trimmed.match(/^https?:\/\/[^/]+(\/storage\/v1\/object\/public\/.+)$/i) ??
    trimmed.match(/^(\/storage\/v1\/object\/public\/.+)$/i);

  if (!storagePathMatch) return trimmed;

  const storagePath = storagePathMatch[1] ?? storagePathMatch[0];
  const runtimeOrigin = resolvePreferredAssetOrigin(preferredOrigin);

  if (!runtimeOrigin) return trimmed;
  return `${trimTrailingSlash(runtimeOrigin)}${storagePath}`;
}
