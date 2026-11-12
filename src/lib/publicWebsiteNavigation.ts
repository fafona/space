import { buildBackendFaollaHref, isFaollaBackendShellUrl, normalizeFaollaEntryUrl } from "./faollaEntry";
import { buildMerchantFrontendHref } from "./siteRouting";

export const PUBLIC_WEBSITE_WORKSPACE_SECTIONS = ["self", "conversations", "consumption", "memberships", "favorites"] as const;
export type PublicWebsiteWorkspaceSection = (typeof PUBLIC_WEBSITE_WORKSPACE_SECTIONS)[number];

export function readPublicWebsiteWorkspaceSection(search: string): PublicWebsiteWorkspaceSection | null {
  const value = new URLSearchParams(search).get("personalSection");
  return PUBLIC_WEBSITE_WORKSPACE_SECTIONS.find(section => section === value) ?? null;
}

/** Preserve existing tenant URLs/storage boundaries; only omit the wrapper. */
export function buildDirectMerchantWebsiteHref(siteId: string, locale?: string, domainPrefix?: string | null) {
  const href = buildMerchantFrontendHref(siteId, domainPrefix);
  const params = new URLSearchParams();
  if (locale?.trim()) params.set("uiLocale", locale.trim());
  return href + (params.size ? "?" + params.toString() : "");
}

export function cleanPublicWebsiteReturnUrl(value: unknown, origin?: string) {
  const normalized = normalizeFaollaEntryUrl(value, origin, { allowFaollaCrossOrigin: true });
  if (!normalized || isFaollaBackendShellUrl(normalized, origin)) return "";
  const url = new URL(normalized);
  if (url.username || url.password) return "";
  for (const key of ["appShell", "entry", "__faollaInlineBuild", "__faollaWebBuild", "__faollaRecovered", "nativeBuild"]) url.searchParams.delete(key);
  return url.toString();
}

export function buildPublicWebsiteWorkspaceHref(section: PublicWebsiteWorkspaceSection, sourceUrl: string, origin?: string, merchantId?: string) {
  const params = new URLSearchParams({ personalSection: section });
  const safeReturn = cleanPublicWebsiteReturnUrl(sourceUrl, origin);
  if (safeReturn) {
    params.set("returnTo", safeReturn);
    const locale = new URL(safeReturn).searchParams.get("uiLocale");
    if (locale) params.set("uiLocale", locale);
  }
  if (section === "conversations" && /^\d{8}$/.test(merchantId ?? "")) params.set("peerMerchantId", merchantId!);
  return "/me?" + params.toString();
}

/** Explicit on-demand path to the existing, unchanged favorite/star workflow. */
export function buildWebsitePlatformModeHref(sourceUrl: string, origin?: string) {
  const safeReturn = cleanPublicWebsiteReturnUrl(sourceUrl, origin);
  if (!safeReturn) return "/me";
  const params = new URLSearchParams({ returnTo: safeReturn });
  const locale = new URL(safeReturn).searchParams.get("uiLocale");
  if (locale) params.set("uiLocale", locale);
  return buildBackendFaollaHref("/me?" + params.toString(), safeReturn, origin);
}
