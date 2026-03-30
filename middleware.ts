import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractMerchantPrefixFromHost } from "@/lib/siteRouting";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";

const RESERVED_SUBDOMAIN_PREFIXES = new Set(["www", "main", "portal"]);
const RESERVED_PATH_SEGMENTS = new Set([
  "admin",
  "api",
  "auth",
  "card",
  "icon.svg",
  "industry",
  "login",
  "portal",
  "reset-password",
  "share",
  "site",
  "super-admin",
]);
const INTERNAL_MERCHANT_REWRITE_PARAM = "__merchantInternalRewrite";

type SiteResolveRow = {
  merchant_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

function getFallbackPrefixFromHost(host: string) {
  const hostname = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    ?.split(":")[0]
    ?.trim() ?? "";
  if (!hostname) return "";
  if (hostname === "localhost" || hostname === "127.0.0.1") return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return "";
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 3) return "";
  const candidate = labels[0] ?? "";
  if (!candidate || RESERVED_SUBDOMAIN_PREFIXES.has(candidate)) return "";
  return candidate;
}

function readEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

function toTimestamp(value: string | null | undefined) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function choosePreferredSiteResolveRow(current: SiteResolveRow | null, candidate: SiteResolveRow) {
  if (!current) return candidate;
  const currentMerchantId = String(current.merchant_id ?? "").trim();
  const candidateMerchantId = String(candidate.merchant_id ?? "").trim();
  const currentNumeric = isMerchantNumericId(currentMerchantId);
  const candidateNumeric = isMerchantNumericId(candidateMerchantId);
  if (candidateNumeric && !currentNumeric) return candidate;
  if (currentNumeric && !candidateNumeric) return current;

  const currentUpdatedAt = Math.max(toTimestamp(current.updated_at), toTimestamp(current.created_at));
  const candidateUpdatedAt = Math.max(toTimestamp(candidate.updated_at), toTimestamp(candidate.created_at));
  return candidateUpdatedAt >= currentUpdatedAt ? candidate : current;
}

function pickResolvedSiteRow(rows: SiteResolveRow[]) {
  return rows
    .filter((item) => String(item.merchant_id ?? "").trim().length > 0)
    .reduce<SiteResolveRow | null>((best, item) => choosePreferredSiteResolveRow(best, item), null);
}

async function resolveSiteIdByPrefix(prefix: string, request: NextRequest) {
  const normalizedPrefix = normalizeDomainPrefix(prefix);
  if (!normalizedPrefix) return "";

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);

  try {
    const query = new URLSearchParams({
      select: "merchant_id,updated_at,created_at",
      slug: `eq.${normalizedPrefix}`,
      limit: "20",
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/pages?${query.toString()}`, {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
        "x-forwarded-host": request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return "";

    const rows = (await response.json().catch(() => null)) as SiteResolveRow[] | null;
    if (!Array.isArray(rows) || rows.length === 0) return "";

    const chosen = pickResolvedSiteRow(rows);
    const siteId = String(chosen?.merchant_id ?? "").trim();
    return isMerchantNumericId(siteId) ? siteId : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 1 && isMerchantNumericId(segments[0] ?? "")) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = "/admin";
    rewriteUrl.searchParams.set("scope", `site-${segments[0]}`);
    rewriteUrl.searchParams.set(INTERNAL_MERCHANT_REWRITE_PARAM, "1");
    return NextResponse.rewrite(rewriteUrl);
  }

  if (pathname !== "/" && segments.length !== 1) return NextResponse.next();

  const rewriteToPublishedSite = async (prefix: string) => {
    const resolvedSiteId = await resolveSiteIdByPrefix(prefix, request);
    if (!resolvedSiteId) return null;
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/site/${encodeURIComponent(resolvedSiteId)}`;
    return NextResponse.rewrite(rewriteUrl);
  };

  if (segments.length === 1) {
    const firstSegment = normalizeDomainPrefix(segments[0] ?? "");
    if (!firstSegment || RESERVED_PATH_SEGMENTS.has(firstSegment)) return NextResponse.next();
    return (await rewriteToPublishedSite(firstSegment)) ?? NextResponse.next();
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const baseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "";
  const domainPrefix = extractMerchantPrefixFromHost(host, baseDomain) || getFallbackPrefixFromHost(host);
  if (!domainPrefix) return NextResponse.next();

  const resolvedPrefixRewrite = await rewriteToPublishedSite(domainPrefix);
  if (resolvedPrefixRewrite) return resolvedPrefixRewrite;

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/${encodeURIComponent(domainPrefix)}`;
  return NextResponse.rewrite(rewriteUrl);
}

export const config = {
  matcher: ["/", "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\..*).*)"],
};
