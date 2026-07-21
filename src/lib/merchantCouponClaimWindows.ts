function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function splitClaimWindow(value: string) {
  const parts = trimText(value)
    .split(/\s*(?:~|至|\|)\s*/)
    .map((part) => part.trim());
  return parts.length === 2 && parts.every(Boolean) ? (parts as [string, string]) : null;
}

export function parseMerchantCouponDateTimeWindow(value: string) {
  const parts = splitClaimWindow(value);
  if (!parts) return null;
  const start = Date.parse(parts[0].replace(" ", "T"));
  const end = Date.parse(parts[1].replace(" ", "T"));
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

export function parseMerchantCouponDailyTimeWindow(value: string) {
  const parts = splitClaimWindow(value);
  if (!parts) return null;
  const startMatch = parts[0].match(/^(\d{1,2}):(\d{2})$/);
  const endMatch = parts[1].match(/^(\d{1,2}):(\d{2})$/);
  if (!startMatch || !endMatch) return null;
  const start = Number(startMatch[1]) * 60 + Number(startMatch[2]);
  const end = Number(endMatch[1]) * 60 + Number(endMatch[2]);
  if (start < 0 || start >= 1440 || end < 0 || end >= 1440) return null;
  return { start, end };
}
