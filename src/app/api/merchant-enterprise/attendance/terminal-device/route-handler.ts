import { requireMerchantEnterpriseEntitlement, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { createTerminalDeviceSecret, executeTerminalDevice, terminalCookieValue } from "@/lib/merchantAttendanceTerminal.server";
import { TERMINAL_COOKIE, parseTerminalToken, terminalObject } from "@/lib/merchantAttendanceTerminal";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { terminalReply, terminalError } from "../terminals/route-handler";

export const terminalDeviceDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED === "1",
  entitlement: requireMerchantEnterpriseEntitlement, execute: executeTerminalDevice,
  secret: createTerminalDeviceSecret, allow: createAttendanceSelfLimiter(),
};
const cookieOptions = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/" };
function readCookie(request: Request) {
  const values = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(TERMINAL_COOKIE + "="));
  if (values.length > 1) throw new MerchantAttendanceError("attendance_terminal_denied");
  return values[0]?.slice(TERMINAL_COOKIE.length + 1) ?? null;
}
export async function handleTerminalDevice(request: Request, overrides: Partial<typeof terminalDeviceDependencies> = {}) {
  const deps = { ...terminalDeviceDependencies, ...overrides };
  if (!deps.enabled()) return terminalReply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return terminalReply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return terminalReply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    if (new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const body = request.method === "POST" ? await readAttendanceSelfJson(request) : null;
    if (body && typeof body === "object" && (body as { action?: unknown }).action === "clear") {
      terminalObject(body, ["action"]);
      const response = terminalReply({ ok: true, cleared: true, moduleEnabled: false });
      response.cookies.set(TERMINAL_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      return response;
    }
    const cookie = readCookie(request);
    let credential: ReturnType<typeof parseTerminalToken>;
    if (request.method === "POST") {
      const b = terminalObject(body, ["action", "token"]);
      if (b.action !== "pair") throw new MerchantAttendanceError("attendance_invalid_request");
      if (cookie !== null) throw new MerchantAttendanceError("attendance_terminal_already_paired");
      try { credential = parseTerminalToken(b.token); } catch { throw new MerchantAttendanceError("attendance_terminal_denied"); }
    } else {
      if (cookie === null) return terminalReply({ ok: true, paired: false, moduleEnabled: false });
      try { credential = parseTerminalToken(cookie); } catch { throw new MerchantAttendanceError("attendance_terminal_denied"); }
    }
    // Bounded per-process abuse protection only. 256-bit secrets, SQL one-use
    // transition and owner creation quotas are independent correctness controls.
    if (!deps.allow(`${credential.siteId}:${credential.terminalId}`)) throw new MerchantAttendanceError("attendance_rate_limited");
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(credential.siteId));
    const input = { ...credential, deviceSecret: request.method === "POST" ? deps.secret() : null, allowPair: moduleEnabled };
    const result = await deps.execute(input);
    const response = terminalReply({ ok: true, paired: true, ...result, moduleEnabled });
    if (input.deviceSecret) response.cookies.set(TERMINAL_COOKIE, terminalCookieValue(input), { ...cookieOptions, maxAge: 30 * 86400 });
    return response;
  } catch (error) {
    return terminalError(error instanceof MerchantEnterpriseAccessError && error.status === 403
      ? new MerchantAttendanceError("attendance_terminal_denied") : error);
  }
}
