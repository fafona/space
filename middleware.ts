import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractMerchantPrefixFromHost } from "@/lib/siteRouting";

const RESERVED_SUBDOMAIN_PREFIXES = new Set(["www", "main", "portal"]);

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

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname !== "/") return NextResponse.next();

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const baseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "";
  const domainPrefix = extractMerchantPrefixFromHost(host, baseDomain) || getFallbackPrefixFromHost(host);
  if (!domainPrefix) return NextResponse.next();

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/${encodeURIComponent(domainPrefix)}`;
  return NextResponse.rewrite(rewriteUrl);
}

export const config = {
  matcher: ["/"],
};
