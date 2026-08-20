import type { NextResponse } from "next/server";

type LegacyCookieExpirationOptions = {
  domain?: string;
  httpOnly?: boolean;
};

export function appendLegacyCookieExpiration(
  response: NextResponse,
  name: string,
  options: LegacyCookieExpirationOptions = {},
) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(name)) return;
  const attributes = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
    "Secure",
  ];
  if (options.httpOnly) attributes.push("HttpOnly");
  const domain = String(options.domain ?? "").trim().toLowerCase();
  if (/^[a-z0-9.-]+$/.test(domain)) attributes.push(`Domain=${domain}`);
  response.headers.append("Set-Cookie", attributes.join("; "));
}
