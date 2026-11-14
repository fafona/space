export function serviceQrLink(value: string, origin: string) {
  const raw = value.trim();
  try {
    const candidate = /^[\w.-]+\.[a-z]{2,}(?:[/?#]|$)/i.test(raw) ? `https://${raw}` : raw;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !candidate.startsWith("/")) return "";
    const url = new URL(candidate, origin);
    return /^(https?:|mailto:|tel:)$/.test(url.protocol) ? url.href : "";
  } catch { return ""; }
}
