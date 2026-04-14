import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import type { MerchantBookingRecord } from "@/lib/merchantBookings";
import { buildMerchantDomain, buildSiteHref } from "@/lib/siteRouting";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePublicUrl(value: string) {
  const normalized = trimText(value).replace(/\/+$/, "");
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(normalized)) {
    return `https://${normalized}`;
  }
  return "";
}

function buildBookingTokenHash(input: {
  bookingId: string;
  editToken: string;
  bookingBlockId?: string | null | undefined;
  bookingViewport?: string | null | undefined;
  download?: boolean;
}) {
  const params = new URLSearchParams();
  params.set("bookingId", trimText(input.bookingId));
  params.set("editToken", trimText(input.editToken));
  const bookingBlockId = trimText(input.bookingBlockId);
  const bookingViewport = trimText(input.bookingViewport);
  if (bookingBlockId) params.set("bookingBlockId", bookingBlockId);
  if (bookingViewport) params.set("bookingViewport", bookingViewport);
  if (input.download) params.set("download", "1");
  return params.toString();
}

export function buildMerchantBookingPublicSiteUrl(
  site: Partial<MerchantListPublishedSite> | null | undefined,
  siteId: string,
) {
  const domain = normalizePublicUrl(trimText(site?.domain));
  if (domain) return domain;

  const prefix = trimText(site?.domainPrefix ?? site?.domainSuffix);
  const baseDomain = trimText(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
  const subdomainUrl = prefix ? normalizePublicUrl(buildMerchantDomain(baseDomain, prefix)) : "";
  if (subdomainUrl) return subdomainUrl;

  const baseUrl = normalizePublicUrl(baseDomain);
  if (!baseUrl) return "";
  return `${baseUrl}${buildSiteHref(siteId)}`;
}

export function buildMerchantBookingSelfServiceUrl(
  siteUrl: string,
  booking: Pick<MerchantBookingRecord, "id" | "bookingBlockId" | "bookingViewport">,
  editToken: string,
) {
  const normalizedSiteUrl = normalizePublicUrl(siteUrl);
  const normalizedEditToken = trimText(editToken);
  if (!normalizedSiteUrl || !booking.id || !normalizedEditToken) return "";
  const url = new URL(normalizedSiteUrl);
  url.hash = buildBookingTokenHash({
    bookingId: booking.id,
    editToken: normalizedEditToken,
    bookingBlockId: booking.bookingBlockId,
    bookingViewport: booking.bookingViewport,
  });
  return url.toString();
}

export function buildMerchantBookingCustomerCalendarUrl(
  siteUrl: string,
  bookingId: string,
  editToken: string,
) {
  const normalizedSiteUrl = normalizePublicUrl(siteUrl);
  const normalizedBookingId = trimText(bookingId);
  const normalizedEditToken = trimText(editToken);
  if (!normalizedSiteUrl || !normalizedBookingId || !normalizedEditToken) return "";
  const site = new URL(normalizedSiteUrl);
  const url = new URL("/booking-calendar", site.origin);
  url.hash = buildBookingTokenHash({
    bookingId: normalizedBookingId,
    editToken: normalizedEditToken,
    download: true,
  });
  return url.toString();
}
