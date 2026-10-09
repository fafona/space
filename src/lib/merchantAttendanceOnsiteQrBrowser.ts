import { ONSITE_QR_MAX_TOKEN_BYTES, parseOnsiteClaims, type OnsiteClaims } from "./merchantAttendanceOnsiteQr";
import { attendanceSelfSite } from "./merchantAttendanceSelf";

export const ONSITE_SCAN_PATH = "/enterprise/attendance-scan";
function fail(): never { throw Error("attendance_qr_invalid"); }
export function onsiteScanOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return fail();
  try { const url = new URL(value);
    return url.protocol === "https:" && value === url.origin && !url.username && !url.password ? url.origin : fail();
  } catch { return fail(); }
}
/** CLIENT DISPLAY ONLY, NOT authentication: the API verifies the HMAC and SQL
 * checks current permissions/time. Nothing decoded here authorizes a punch. */
export function decodeOnsiteToken(token: string): OnsiteClaims {
  try {
    if (typeof token !== "string" || token.length > ONSITE_QR_MAX_TOKEN_BYTES) return fail();
    const parts = /^aq1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token); if (!parts) return fail();
    const decode = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const encode = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const json = decode(parts[1]), signature = decode(parts[2]);
    if (encode(json) !== parts[1] || signature.length !== 32 || encode(signature) !== parts[2]) return fail();
    const claims = parseOnsiteClaims(JSON.parse(json));
    if (JSON.stringify(claims) !== json) return fail();
    return claims;
  } catch { return fail(); }
}
export function buildOnsiteScanUrl(origin: string, token: string): string {
  const trusted = onsiteScanOrigin(origin), claims = decodeOnsiteToken(token);
  // Fragment is deliberately excluded from HTTP requests and Referer headers.
  return `${trusted}${ONSITE_SCAN_PATH}?siteId=${claims.siteId}#qr=${token}`;
}
export function parseOnsiteScanUrl(input: string, expectedOrigin: string): { siteId: string; token: string; claims: OnsiteClaims } {
  try {
    if (typeof input !== "string" || input.length > 2100) return fail();
    const url = new URL(input), origin = onsiteScanOrigin(expectedOrigin);
    if (url.origin !== origin || url.username || url.password || url.pathname !== ONSITE_SCAN_PATH) return fail();
    if ([...url.searchParams.keys()].join() !== "siteId" || !/^#qr=aq1\./.test(url.hash)) return fail();
    const token = url.hash.slice(4), claims = decodeOnsiteToken(token), siteId = attendanceSelfSite(url.searchParams.get("siteId"));
    if (siteId !== claims.siteId || input !== buildOnsiteScanUrl(origin, token)) return fail();
    return { siteId, token, claims };
  } catch { return fail(); }
}
export function parseOnsiteRecoveryLocation(input: string, expectedOrigin: string): string | null {
  try {
    const url = new URL(input);
    if (url.origin !== onsiteScanOrigin(expectedOrigin) || url.pathname !== ONSITE_SCAN_PATH || url.hash || url.username || url.password) return fail();
    if (!url.search) return null;
    if ([...url.searchParams.keys()].join() !== "siteId") return fail();
    return attendanceSelfSite(url.searchParams.get("siteId"));
  } catch { return fail(); }
}
