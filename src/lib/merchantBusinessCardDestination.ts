export type BusinessCardDestinationSettings = {
  mode?: "image" | "link";
  websiteAddress?: string;
};

// A browser navigation target, never a server-side fetch or merchant identity.
export function normalizeBusinessCardWebsiteAddress(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw || raw.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(raw)) return "";
  const hostWithPort = /^[^/:]+\.[^/:]+:\d{1,5}(?:[/?#]|$)/u.test(raw);
  const candidate = raw.startsWith("//") ? `https:${raw}` : !hostWithPort && /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) return "";
    // A missing suffix is usually unfinished typing, not a public website.
    if (!url.hostname.includes(".") && !url.hostname.startsWith("[")) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function businessCardUsesContactPage(settings: BusinessCardDestinationSettings): boolean {
  return settings.mode === "link";
}

export function resolveBusinessCardWebsiteAddress(settings: BusinessCardDestinationSettings, assignedWebsite: string): string {
  if (!settings.websiteAddress?.trim()) return assignedWebsite;
  // Invalid explicit URLs must never silently fall back to another destination.
  return normalizeBusinessCardWebsiteAddress(settings.websiteAddress);
}

export function resolveBusinessCardScanTarget(settings: BusinessCardDestinationSettings, assignedWebsite: string, contactPageUrl: string): string {
  return businessCardUsesContactPage(settings) ? contactPageUrl : resolveBusinessCardWebsiteAddress(settings, assignedWebsite);
}

// Keep the existing fast merchant route only for the assigned website. A custom
// website (including a different path on the same host) must open as entered.
export function resolveBusinessCardWebsiteNavigation(websiteUrl: string | undefined, assignedWebsite: string, defaultOpenTarget = assignedWebsite): string {
  const assigned = normalizeBusinessCardWebsiteAddress(assignedWebsite);
  const website = websiteUrl?.trim() ? normalizeBusinessCardWebsiteAddress(websiteUrl) : assigned;
  if (!website) return "";
  return website === assigned ? normalizeBusinessCardWebsiteAddress(defaultOpenTarget) || assigned : website;
}
