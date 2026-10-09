import { NextResponse } from "next/server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { requireMerchantEnterpriseEntitlement, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { parseTerminalToken, TERMINAL_COOKIE, terminalObject } from "@/lib/merchantAttendanceTerminal";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { ONSITE_QR_ERRORS } from "@/lib/merchantAttendanceOnsiteQr";
import { executeOnsiteIssue } from "@/lib/merchantAttendanceOnsiteQr.server";

export const onsiteQrEnabled = () => process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1"
  && process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED === "1";
export function onsiteReply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}
export const onsiteCodeDependencies = { enabled: onsiteQrEnabled, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executeOnsiteIssue };
export async function handleOnsiteCode(request: Request, overrides: Partial<typeof onsiteCodeDependencies> = {}) {
  const d = { ...onsiteCodeDependencies, ...overrides };
  if (!d.enabled()) return onsiteReply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "POST") return onsiteReply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return onsiteReply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    if (new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(TERMINAL_COOKIE + "="));
    if (cookies.length !== 1) throw new MerchantAttendanceError("attendance_terminal_denied");
    let credential;
    try { credential = parseTerminalToken(cookies[0].slice(TERMINAL_COOKIE.length + 1)); }
    catch { throw new MerchantAttendanceError("attendance_terminal_denied"); }
    if (!d.allow(credential.siteId + ":" + credential.terminalId)) throw new MerchantAttendanceError("attendance_rate_limited");
    terminalObject(await readAttendanceSelfJson(request), []);
    const moduleEnabled = attendanceModuleEnabled(await d.entitlement(credential.siteId));
    // Paused admission can still issue evidence for an authorized shift finish.
    // Pair secrets are not device credentials: the issue RPC checks device_hash.
    return onsiteReply({ ok: true, ...await d.execute(credential), moduleEnabled });
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return onsiteReply({ ok: false, error: "attendance_terminal_denied" }, 403);
    const code = error instanceof MerchantAttendanceError && Object.hasOwn(ONSITE_QR_ERRORS, error.code) ? error.code : "attendance_unavailable";
    return onsiteReply({ ok: false, error: code }, ONSITE_QR_ERRORS[code] ?? 503);
  }
}
