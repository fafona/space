function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, "");
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
  const runtimeOrigin =
    String(preferredOrigin ?? "").trim() ||
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : "");

  if (!runtimeOrigin) return trimmed;
  return `${trimTrailingSlash(runtimeOrigin)}${storagePath}`;
}
